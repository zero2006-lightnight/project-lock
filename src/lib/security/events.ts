/* ──────────────────────────────────────────────────────────────
   Structured security event logging (detect → investigate).

   Single sink: one log line per event, safe fields only. NEVER log
   passwords, tokens, session IDs, secrets, or full user content —
   userId (internal id, not email) and truncated details are enough
   to investigate. Console sink keeps it dependency-free; a managed
   log aggregator can scrape stdout in production.
   ────────────────────────────────────────────────────────────── */

export type SecurityEventType =
  | "login_success"
  | "login_failure"
  | "login_rate_limited"
  | "signup_rate_limited"
  | "upload_rejected"
  | "parse_rate_limited"
  | "chat_rate_limited"
  | "feedback_rate_limited"
  | "csrf_blocked"
  | "expired_sessions_purged";

export function logSecurityEvent(event: {
  type: SecurityEventType;
  userId?: string | null;
  ip?: string | null;
  detail?: string | null;
}): void {
  const parts = [`[security] ${event.type}`];
  if (event.userId) parts.push(`user=${event.userId.slice(0, 16)}`);
  if (event.ip) parts.push(`ip=${event.ip.slice(0, 45)}`);
  if (event.detail) parts.push(`detail=${event.detail.slice(0, 160)}`);
  console.log(parts.join(" "));
}
