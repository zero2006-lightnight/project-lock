import { createHmac, timingSafeEqual } from "node:crypto";
import type { ParsedSyllabus } from "./syllabus-parse";

/* ──────────────────────────────────────────────────────────────
  Import preview tokens (stateless HMAC, user-bound, 15-minute TTL).
   Imports are two-step by design: the user SEES the parsed structure
   before anything touches the DB. The commit step re-validates the
   payload anyway, so a stale/garbage token fails safe.

  Plain module (NOT "use server") so both the server action and the
  multipart route handler can mint/verify the same token across instances.
   ────────────────────────────────────────────────────────────── */

const TOKEN_TTL_MS = 15 * 60 * 1000;
const TOKEN_SECRET = process.env.AUTH_SECRET ?? process.env.SESSION_SECRET ?? "studypilot-preview-token-development-secret";

export function sweepTokens() {
  // Stateless tokens need no process-local sweep.
}

function sign(value: string): string {
  return createHmac("sha256", TOKEN_SECRET).update(value).digest("hex");
}

/** Mint a signed preview token bound to the parsing user and payload. */
export function mintPreviewToken(userId: string, syllabus: ParsedSyllabus): string {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const encoded = Buffer.from(JSON.stringify({ userId, syllabus, expiresAt })).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

/** Verify a token. Returns null when malformed, expired, or foreign. */
export function consumePreviewToken(token: string, userId: string): ParsedSyllabus | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature || signature.length !== 64) return null;
  const expected = sign(encoded);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { userId?: string; syllabus?: ParsedSyllabus; expiresAt?: number };
    if (payload.userId !== userId || !payload.syllabus || !payload.expiresAt || payload.expiresAt < Date.now()) return null;
    return payload.syllabus;
  } catch {
    return null;
  }
}
