/**
 * Client identification for rate-limit keying (PL-013).
 *
 * Works on a plain `Headers` object so both surfaces can use it:
 * server actions (`await headers()`) and route handlers (`request.headers`).
 *
 * Trust model: behind a proxy, x-forwarded-for's first hop is the client;
 * direct access (dev, LAN) has no proxy headers, so all callers share one
 * "local" key — which is exactly right for a single-instance deployment.
 */

/** Extract the best-known client IP from request headers. */
export function clientIpFromHeaders(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    // First entry in the list is the original client (when a proxy is present).
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "local";
}

/** Round retry milliseconds up to human minutes for user-facing messages. */
export function retryMinutes(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 60_000));
}
