# Project Lock — Security Blueprint

Defense in depth for a single-instance Next.js + SQLite study app.
No guarantee of "unhackable" — the goal is: harder to attack, smaller
blast radius, faster detection and recovery.

## 1. Architecture & trust boundaries

```text
USER ─▶ FRONTEND (Next.js App Router)
          ─▶ SERVER ACTIONS / ROUTE HANDLERS (auth required)
              ├─ AUTH (scrypt + rate-limited login + HttpOnly session cookie)
              ├─ DATABASE (SQLite file, Drizzle ORM — parameterized only)
              ├─ FILE PROCESSING (magic-byte check → local Python/PDF parse)
              ├─ AI / PILOT (/api/chat, SSE — sanitized, wrapped, validated)
              ├─ TUNING (per-user KBs, scoped retrieval, error lessons)
              └─ EXTERNAL: AI provider APIs (server-side keys only)
```

Every trust boundary re-verifies: authenticated? authorized? owner?

## 2. Controls inventory (implemented)

| Area | Control | Where |
|---|---|---|
| Passwords | scrypt (N=16384, timing-safe compare), never logged | `lib/auth/password.ts` |
| Brute force | 5/email + 30/IP per 15 min (login), 5/IP/hr (signup), uniform error | `lib/auth/actions.ts` |
| Sessions | HttpOnly, SameSite=Lax, protocol-aware Secure, server-side rows, logout revokes, expired purge on login | `lib/auth/session.ts` |
| CSRF | Same-origin Origin/Referer check on cookie-POST route handlers (Actions have Next's built-in check) | `lib/security/origin.ts` |
| Headers | nosniff, same-origin frames, referrer, permissions-policy, HSTS, CSP Report-Only + report sink | `next.config.ts`, `api/security/csp-report` |
| Uploads | Magic-byte verification (PDF/ZIP/PNG/JPEG/GIF/WEBP/text), executables rejected, 100 MB cap, Excel ≤10 MB, CSVs bypass workbook lib | `lib/security/uploads.ts`, `lib/services/extract.ts` |
| Known vuln | xlsx has unpatched PP/ReDoS advisories → mitigated above; migrate to exceljs when feasible | `extract.ts` |
| AI hygiene | Control-char strip, untrusted delimiters + directive, Zod-validated outputs, user-scoped context | `lib/security/guard.ts` |
| Feedback/AI lessons | Sanitize + verify against own tuned passages; unverified never steers; user-scoped retrieval | `lib/services/feedback.ts`, `lib/tuning/error-lessons.ts` |
| Rate limits | chat 20/5min, syllabus-parse 10/10min, feedback 10/10min, login/signup | routes + actions |
| Logging | `[security]` events only (no passwords/tokens/secrets/content) | `lib/security/events.ts` |
| Parser isolation | Fixed argv (no user input in command line), temp files cleaned, 120 s timeout, output cap | `lib/services/python-parse.ts` |
| Secrets | `.env` gitignored, never in bundles/logs; see `.env.example` | repo root |

## 3. Threat model (top risks → control)

1. **Account takeover** (credential stuffing) → rate limits + uniform errors + scrypt + session revocation.
2. **Cross-user data access (IDOR)** → every query scopes `userId` first; code review rule.
3. **Malicious uploads** → magic bytes + parser timeouts + no execution + size caps.
4. **Prompt injection via PDFs/chat** → untrusted delimiters + sanitize + lessons never inject raw text.
5. **Session theft** → HttpOnly + SameSite + Secure-on-HTTPS + 30-day expiry + logout revoke.
6. **AI cost abuse** → per-user rate limits on chat/parse.
7. **Dependency vulns** → `npm audit` gate (see §7), xlsx containment above.
8. **Secret leak** → gitignore + `.env.example` without values; rotate on exposure.

## 4. Edge / infrastructure (operator's job — recommended)

- Terminate TLS at a reverse proxy (Caddy/Nginx/Cloudflare); forward
  `x-forwarded-proto: https` so Secure cookies engage.
- Enable Cloudflare (or equivalent) WAF + DDoS + bot rules in front of
  the app; keep the app's own rate limits as the inner layer.
- Back up `data/studypilot.db` + `.env` (see FAllBACK.md); test restore.
- Restrict inbound ports to 80/443 (+ SSH key-only).

## 5. Security logging — what to watch

`[security]` lines: `login_failure`, `login_rate_limited`,
`upload_rejected`, `csrf_blocked`, `*_rate_limited`. Investigate
bursts from one IP, repeated `upload_rejected` (probing), or
`csrf_blocked` on real user flows (misconfigured proxy stripping
Origin — allowlist, don't disable).

## 6. Incident response

```text
DETECT (logs) → TRIAGE (severity) → CONTAIN → INVESTIGATE → RECOVER → REVIEW
```

- **Low** (single probing): monitor.
- **Medium** (rate-limit storms, repeated upload rejects): block IP at edge, review logs.
- **High** (suspected account/data breach): rotate AI keys, force logout
  (`delete from sessions`), restore DB from backup if tampered, notify users.
- **Critical** (RCE/data exfiltration): take offline, preserve `data/` +
  logs, rotate ALL secrets, fresh deploy, post-mortem.
- If a secret leaks: revoke at provider immediately, remove from `.env`/logs.

## 7. Maintenance checklist

- [ ] `npm audit` on every dependency change (prod deps must show no
      unpatched critical/high without a documented containment).
- [ ] Review `[security]` logs weekly.
- [ ] Backup restore drill monthly.
- [ ] Re-run typecheck + full tests + regression QA after security changes.
- [ ] MFA: supported by design (session table is token-based); roll out
      TOTP/WebAuthn only with UX review — not forced here.

## 8. Production hardening checklist

- [ ] HTTPS + `x-forwarded-proto` forwarding verified (Secure cookies active).
- [ ] `.env` holds real keys, never committed; `DATABASE_URL` points at a
      backed-up volume.
- [ ] `npm run build` clean; no `console.log` of user content in hot paths.
- [ ] CSP report sink quiet (promote to enforcing only after review).
- [ ] Backup exists and was restore-tested.
