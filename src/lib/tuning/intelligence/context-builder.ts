/* ──────────────────────────────────────────────────────────────
   §11/§12 — Context assembly + budget management.

   Priority: directly relevant uploaded material → relevant subject
   knowledge → current learning context → general knowledge.
   Hard rules: never entire PDFs, never whole histories, never whole
   profiles; no unrelated subjects; never another user's data (the
   caller scopes retrieval by userId — this builder re-checks the
   invariant); dedupe + rank before building.
   ────────────────────────────────────────────────────────────── */

import type { ContextPack } from "./types";
import type { RetrievedChunk } from "../retrieve";

export const MAX_PASSAGES = 5;
export const MAX_PASSAGE_CHARS = 900;
export const MAX_QUESTION_CHARS = 1000;

export type ContextInput = {
  userId: string;
  question: string;
  chunks: (RetrievedChunk & { kb?: string })[];
  /** KB this question was scoped to (null = all user KBs). */
  scopedKbId: string | null;
  subjectSummary: string;
  subjectMapText: string | null;
  personalNote: string | null;
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Dedupe near-identical passages (same normalized prefix), keep the
 * higher score, then rank and cap the budget.
 */
export function dedupeAndRank(
  chunks: (RetrievedChunk & { kb?: string })[],
  scopedKbId: string | null,
): RetrievedChunk[] {
  // Isolation: drop any chunk outside the question's scope. Retrieval
  // is already scoped — this is the defense-in-depth re-check.
  const inScope = scopedKbId ? chunks.filter((c) => !c.kb || c.kb === scopedKbId) : chunks;
  const sorted = [...inScope].sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: RetrievedChunk[] = [];
  for (const c of sorted) {
    const key = normalize(c.content).slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= MAX_PASSAGES) break;
  }
  return out;
}

export function buildContext(input: ContextInput): ContextPack {
  const passages = dedupeAndRank(input.chunks, input.scopedKbId).map((c) => ({
    ...c,
    content: c.content.slice(0, MAX_PASSAGE_CHARS),
  }));
  const covered = passages.length >= 2 || (passages.length === 1 && passages[0]!.score > 0.12);
  return {
    question: input.question.slice(0, MAX_QUESTION_CHARS),
    passages,
    subjectSummary: input.subjectSummary,
    personalNote: covered ? input.personalNote : null, // no personalization on an uncovered question
    knowledgeAvailable: passages.length > 0,
    thinCoverage: !covered,
  };
}

/** Prompt block: ranked passages first, subject knowledge, then the person. */
export function renderContextBlock(pack: ContextPack, subjectMapText: string | null): string {
  const parts: string[] = [];
  pack.passages.forEach((c, i) => {
    parts.push(`[${i + 1}] ${c.docName}${c.section ? ` · ${c.section}` : ""}\n${c.content}`);
  });
  const map = subjectMapText ? `\n\nSubject knowledge map:\n${subjectMapText}` : "";
  const note = pack.personalNote ? `\n\nRelevant learning context: ${pack.personalNote}` : "";
  return `Tuned passages (ranked, deduplicated):\n${parts.join("\n\n")}${map}\n\nSubject profile: ${pack.subjectSummary || "—"}${note}`;
}
