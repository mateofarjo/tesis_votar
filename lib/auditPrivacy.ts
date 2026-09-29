import { randomUUID } from "node:crypto";

import type { AuditAction } from "@prisma/client";

/**
 * Acciones que participan en el ataque de correlacion temporal: unas conservan
 * el identificador del votante, otras el hash de la transaccion. Un adversario
 * con acceso de lectura a la base puede ordenar ambos conjuntos por tiempo y
 * emparejarlos por proximidad, reconstruyendo votante -> voto sin necesidad de
 * ningun campo que el esquema haya omitido.
 */
const ACCIONES_CORRELACIONABLES: ReadonlySet<string> = new Set<AuditAction>([
  "TOKEN_GENERADO",
  "VOTO_ENVIADO",
  "TOKEN_CONSUMIDO",
  "VOTO_CONFIRMADO"
]);

function minutosDeCubeta(): number {
  const bruto = Number.parseInt(process.env.AUDIT_TIME_BUCKET_MINUTES ?? "", 10);
  if (!Number.isFinite(bruto) || bruto <= 0) {
    return 15;
  }
  return Math.min(bruto, 24 * 60);
}

/**
 * Decide si una entrada debe registrarse con marca temporal cubeteada.
 *
 * No alcanza con cubetear la emision de credenciales. Cualquier entrada que
 * conserve el identificador del votante con hora exacta permite ordenar a las
 * personas entre si, y ese orden, cruzado con el orden de las transacciones en
 * la cadena, reconstruye el emparejamiento igual. El acceso al sistema es el
 * caso mas evidente: precede a la emision por un margen corto y acotado.
 *
 * La regla es por lo tanto doble: se cubetea toda accion del ciclo de voto y,
 * ademas, toda entrada que lleve identificador de votante, sea cual sea la
 * accion.
 */
export function requiereCubeteo(action: AuditAction, tieneVotante: boolean): boolean {
  return tieneVotante || ACCIONES_CORRELACIONABLES.has(action);
}

/**
 * Trunca el instante al inicio de su cubeta. Dentro de una cubeta, todas las
 * entradas comparten marca temporal y el orden relativo deja de ser legible.
 */
export function instanteCubeteado(ahora: Date = new Date()): Date {
  const cubetaMs = minutosDeCubeta() * 60_000;
  return new Date(Math.floor(ahora.getTime() / cubetaMs) * cubetaMs);
}

/**
 * Identificador aleatorio para las entradas cubeteadas.
 *
 * Truncar la marca temporal no alcanza por si solo: el identificador por
 * omision del esquema es un cuid, que es monotono en el tiempo, de modo que el
 * adversario recuperaria el orden ordenando por id en lugar de por fecha. Un
 * UUID v4 no conserva esa informacion.
 */
export function identificadorNoOrdenable(): string {
  return randomUUID();
}

export function descripcionDeCubeta(): string {
  return `${minutosDeCubeta()}min`;
}
