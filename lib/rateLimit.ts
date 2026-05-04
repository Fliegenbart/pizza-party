export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export function createMemoryRateLimiter() {
  const buckets = new Map<string, Bucket>();

  return {
    check(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
      const safeLimit = Math.max(1, Math.floor(limit));
      const existing = buckets.get(key);
      const bucket =
        existing && existing.resetAt > now
          ? existing
          : { count: 0, resetAt: now + windowMs };

      if (bucket.count >= safeLimit) {
        buckets.set(key, bucket);
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
        };
      }

      bucket.count += 1;
      buckets.set(key, bucket);
      return {
        allowed: true,
        remaining: safeLimit - bucket.count,
        retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
      };
    },
  };
}

export const enrichRateLimiter = createMemoryRateLimiter();

export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || "unknown";
  return headers.get("x-real-ip")?.trim() || "unknown";
}
