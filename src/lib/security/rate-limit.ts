/**
 * In-memory sliding-window rate limiter.
 *
 * Deliberately simple: the app is a single-instance deployment (SQLite
 * file DB), so an in-process Map is exact — no external store needed.
 * If Project-Lock ever scales to multiple instances (Postgres phase),
 * this must be replaced with a shared store; tracked in the backlog.
 */

export type RateLimitOptions = {
  /** Max hits allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  /** Hits recorded inside the current window (including this one). */
  count: number;
  /** Milliseconds until the oldest hit leaves the window (when blocked). */
  retryAfterMs: number;
};

const buckets = new Map<string, number[]>();

/**
 * Record a hit for `key` and decide whether it is inside the limit.
 * Lazy pruning: old entries are dropped on access, no timers.
 *
 * Rejected requests do NOT consume budget: the window recovers based on
 * accepted hits only, so retryAfterMs stays truthful and hammering the
 * limit never extends a block indefinitely.
 */
export function rateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const windowStart = now - options.windowMs;

  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);

  if (hits.length >= options.limit) {
    buckets.set(key, hits); // persist pruned state; no hit recorded
    return {
      allowed: false,
      count: hits.length,
      retryAfterMs: hits[0] + options.windowMs - now,
    };
  }

  hits.push(now);
  buckets.set(key, hits);
  return { allowed: true, count: hits.length, retryAfterMs: 0 };
}

/** Test/maintenance hook: forget all state for a key. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
