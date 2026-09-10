/* ──────────────────────────────────────────────────────────────
   Same-origin guard for cookie-authenticated POST route handlers.

   Server Actions already get an Origin check from Next.js; plain
   Route Handlers do not. A cross-site form/fetch cannot set a custom
   Origin/Referer header, so requiring one that matches this host
   blocks classic CSRF while same-origin app traffic always passes.
   Missing headers (curl, health checks) are allowed for GET-safe
   flows — call sites apply this to state-changing POSTs only.
   ────────────────────────────────────────────────────────────── */

export function isSameOriginRequest(req: Request): boolean {
  const host = req.headers.get("host") ?? req.headers.get("x-forwarded-host") ?? "";
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const claimed = origin ?? referer;
  if (!claimed) return true; // non-browser client; auth still enforced
  try {
    const url = new URL(claimed);
    const claimedHost = url.host.toLowerCase();
    const want = host.toLowerCase();
    if (!want) return false;
    if (claimedHost === want) return true;
    // Local development aliases (localhost ↔ 127.0.0.1, LAN IPs).
    const stripPort = (h: string) => h.split(":")[0];
    if (stripPort(claimedHost) === stripPort(want)) return true;
    const local = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (local.has(stripPort(claimedHost)) && local.has(stripPort(want))) return true;
    return false;
  } catch {
    return false;
  }
}
