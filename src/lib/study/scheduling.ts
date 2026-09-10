/* ──────────────────────────────────────────────────────────────
   Study Intelligence — pure scheduling helpers (no DB, no I/O).
   Lives outside server actions: Server Actions must be async.
   ────────────────────────────────────────────────────────────── */

import { sanitizeUserText } from "@/lib/security/guard";

/** SM-2-lite intervals: easy stretches, practice goes short, hard resets now. */
export function nextReviewInterval(currentDays: number, rating: "easy" | "practice" | "hard"): number {
  if (rating === "easy") return Math.min(60, currentDays * 2 + 1);
  if (rating === "practice") return 1;
  return 0;
}

/** Compact topic prompt for pre-filling (sanitized, capped). */
export function coercePrompt(raw: unknown, max = 200): string {
  return sanitizeUserText(typeof raw === "string" ? raw : "", max);
}
