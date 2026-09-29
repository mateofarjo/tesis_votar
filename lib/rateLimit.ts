import prisma from "./prisma";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  identifier: string;
  keyPrefix: string;
  limit: number;
  windowMs: number;
};

type RateLimitResult = {
  limit: number;
  remaining: number;
  resetAt: number;
  success: boolean;
  /** Indica si el conteo provino del almacen compartido o del respaldo local. */
  shared: boolean;
};

/**
 * Limitador de tasa sobre almacenamiento compartido.
 *
 * La version anterior contaba sobre un Map adherido al objeto global del
 * proceso. En un despliegue sin servidor, donde dos peticiones consecutivas
 * pueden ser atendidas por instancias distintas, cada instancia llevaba su
 * propio recuento y el limite efectivo se multiplicaba por la cantidad de
 * instancias activas. El endpoint de voto lo volvia particularmente grave,
 * porque alli el gas lo paga el retransmisor.
 *
 * El conteo se resuelve ahora en una unica sentencia SQL: el INSERT ... ON
 * CONFLICT es atomico, de modo que dos peticiones simultaneas no pueden leer el
 * mismo valor antes de incrementarlo.
 *
 * El respaldo en memoria se conserva como segunda capa: si la base no responde,
 * el limitador degrada a un conteo por instancia en lugar de dejar el endpoint
 * sin proteccion alguna.
 */

const globalForRateLimit = globalThis as typeof globalThis & {
  rateLimitStore?: Map<string, RateLimitBucket>;
};

const store = globalForRateLimit.rateLimitStore ?? new Map<string, RateLimitBucket>();

if (!globalForRateLimit.rateLimitStore) {
  globalForRateLimit.rateLimitStore = store;
}

const COMPACT_INTERVAL_MS = 60_000;
let lastCompactAt = 0;

function compactExpiredBuckets(now: number) {
  if (now - lastCompactAt < COMPACT_INTERVAL_MS) {
    return;
  }
  lastCompactAt = now;
  for (const [key, bucket] of store.entries()) {
    if (bucket.resetAt <= now) {
      store.delete(key);
    }
  }
}

function consumeLocalRateLimit(options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  compactExpiredBuckets(now);

  const compositeKey = `${options.keyPrefix}:${options.identifier}`;
  const existingBucket = store.get(compositeKey);

  if (!existingBucket || existingBucket.resetAt <= now) {
    const resetAt = now + options.windowMs;
    store.set(compositeKey, { count: 1, resetAt });
    return {
      limit: options.limit,
      remaining: Math.max(options.limit - 1, 0),
      resetAt,
      shared: false,
      success: true
    };
  }

  existingBucket.count += 1;
  store.set(compositeKey, existingBucket);

  return {
    limit: options.limit,
    remaining: Math.max(options.limit - existingBucket.count, 0),
    resetAt: existingBucket.resetAt,
    shared: false,
    success: existingBucket.count <= options.limit
  };
}

export async function consumeRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const compositeKey = `${options.keyPrefix}:${options.identifier}`;

  try {
    const filas = await prisma.$queryRaw<Array<{ count: number; reset_at: Date }>>`
      INSERT INTO rate_limits ("key", "count", "reset_at")
      VALUES (${compositeKey}, 1, now() + make_interval(secs => ${options.windowMs / 1000}))
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN rate_limits."reset_at" <= now() THEN 1 ELSE rate_limits."count" + 1 END,
        "reset_at" = CASE
          WHEN rate_limits."reset_at" <= now()
          THEN now() + make_interval(secs => ${options.windowMs / 1000})
          ELSE rate_limits."reset_at"
        END
      RETURNING "count", "reset_at";
    `;

    const fila = filas[0];
    if (!fila) {
      return consumeLocalRateLimit(options);
    }

    const count = Number(fila.count);
    return {
      limit: options.limit,
      remaining: Math.max(options.limit - count, 0),
      resetAt: new Date(fila.reset_at).getTime(),
      shared: true,
      success: count <= options.limit
    };
  } catch (error) {
    console.error("El limitador de tasa compartido no respondio; se degrada a conteo local", error);
    return consumeLocalRateLimit(options);
  }
}

/** Borra las cubetas vencidas del almacen compartido. Pensado para una tarea periodica. */
export async function purgarLimitesVencidos(): Promise<number> {
  try {
    const borradas = await prisma.$executeRaw`DELETE FROM rate_limits WHERE "reset_at" <= now();`;
    return Number(borradas);
  } catch {
    return 0;
  }
}
