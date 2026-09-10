/* ──────────────────────────────────────────────────────────────
   Study Intelligence — Pilot study-aids context (pure, DB-free).

   Renders the student's own flashcards + mind maps as capped model
   context. Lives here (not services/chat) so unit tests never pull
   the database migration chain.
   ────────────────────────────────────────────────────────────── */

import type { ChatContext } from "@/lib/ai/types";

export const MAX_AID_CARDS = 10;

/** The student's study aids as model context — referenceable, never dumped whole. */
export function buildStudyAids(ctx: ChatContext): string {
  const parts: string[] = [];
  if (ctx.studyAids.flashcards.length) {
    const cards = ctx.studyAids.flashcards
      .slice(0, MAX_AID_CARDS)
      .map((c) => `- [${c.subjectName ?? "General"}] Q: ${c.front} / A: ${c.back}`)
      .join("\n");
    parts.push(`Student's flashcards (reference these when they ask about the same ideas):\n${cards}`);
  }
  if (ctx.studyAids.mindmaps.length) {
    const maps = ctx.studyAids.mindmaps
      .map((m) => `${m.title}: ${m.branches.map((b) => `${b.label} (${b.children.join(", ") || "…"})`).join(" · ")}`)
      .join("\n");
    parts.push(`Student's mind maps (their own organized knowledge — build on this structure):\n${maps}`);
  }
  if (!parts.length) return "";
  return `\nStudy aids the student made (prefer referencing these over re-explaining from scratch when relevant):\n${parts.join("\n\n")}`;
}
