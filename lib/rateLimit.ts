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
};

const globalForRateLimit = globalThis as typeof globalThis & {
  rateLimitStore?: Map<string, RateLimitBucket>;
};

const store = globalForRateLimit.rateLimitStore ?? new Map<string, RateLimitBucket>();

if (!globalForRateLimit.rateLimitStore) {
  globalForRateLimit.rateLimitStore = store;
}

// Intervalo mínimo entre barridos completos del mapa (evita O(n) en cada request)
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

export function consumeRateLimit(options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  compactExpiredBuckets(now);

  const compositeKey = `${options.keyPrefix}:${options.identifier}`;
  const existingBucket = store.get(compositeKey);

  if (!existingBucket || existingBucket.resetAt <= now) {
    const resetAt = now + options.windowMs;
    store.set(compositeKey, {
      count: 1,
      resetAt
    });

    return {
      limit: options.limit,
      remaining: Math.max(options.limit - 1, 0),
      resetAt,
      success: true
    };
  }

  existingBucket.count += 1;
  store.set(compositeKey, existingBucket);

  return {
    limit: options.limit,
    remaining: Math.max(options.limit - existingBucket.count, 0),
    resetAt: existingBucket.resetAt,
    success: existingBucket.count <= options.limit
  };
}
