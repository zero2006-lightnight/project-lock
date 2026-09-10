/* ──────────────────────────────────────────────────────────────
   §15/§16 — Response quality check + uncertainty.

   Lightweight, selective: trivial answers (short quick facts) skip
   validation; everything else gets relevance/grounding/subject/
   format/visual checks WITHOUT extra model calls. Uncertainty is
   explicit: thin coverage admits what's missing and offers paths
   instead of hallucinating PDF content.
   ────────────────────────────────────────────────────────────── */

import type {
  ContextPack,
  IntelligenceDecision,
  ValidationResult,
} from "./types";
import { STRATEGY_SECTIONS } from "./strategy";

export type ValidatedAnswer = {
  markdown: string;
  mermaid: string | null;
};

/** Trivial answers skip validation (§15: no extra calls for trivial). */
export function needsValidation(decision: IntelligenceDecision): boolean {
  if (decision.strategy === "quick_answer" && decision.complexity === "short") return false;
  return true;
}

export function validateResponse(input: {
  decision: IntelligenceDecision;
  pack: ContextPack;
  answer: ValidatedAnswer;
  sourcesClaimed: string[];
}): ValidationResult {
  const { decision, pack, answer, sourcesClaimed } = input;
  if (!needsValidation(decision)) return { ok: true, issues: [], checked: false };

  const issues: ValidationResult["issues"] = [];
  const text = answer.markdown.toLowerCase();
  const questionTerms = decisionQuestionTerms(pack.question);

  // Relevance: the answer should echo at least one content term.
  if (questionTerms.length > 0 && !questionTerms.some((t) => text.includes(t))) {
    issues.push("off_topic");
  }

  // Grounding: tuned-coverage claims need cited sources actually used.
  if (pack.knowledgeAvailable && sourcesClaimed.length === 0 && answer.markdown.length > 200) {
    issues.push("ungrounded_claim");
  }

  // Subject consistency is enforced upstream by construction: retrieval
  // is scoped to the resolved KB (never cross-user, never cross-subject
  // unless the question itself spans scopes), and an explicit user
  // selection is never overridden. No post-hoc text check can verify
  // this better than the scope invariant, so none is faked here.

  // Format: strategy skeleton — check the answer carries structure
  // appropriate to its strategy (headings/lists/tables, not one blob).
  const sections = STRATEGY_SECTIONS[decision.strategy] ?? [];
  if (answer.markdown.length > 600 && sections.length >= 3) {
    const structured = /#{1,4} |^- |^\d+[.)] |\|.*\|/m.test(answer.markdown);
    if (!structured) issues.push("strategy_mismatch");
  }

  // Visual accuracy: a promised visual must actually be present.
  if (decision.visual !== "none" && decision.visual !== "table" && !answer.mermaid) {
    // Table strategy renders markdown tables, not mermaid — exempt.
    if (decision.strategy === "comparison" && /\|.*\|/.test(answer.markdown)) {
      // table present in prose — fine
    } else {
      issues.push("visual_mismatch");
    }
  }

  return { ok: issues.length === 0, issues, checked: true };
}

function decisionQuestionTerms(question: string): string[] {
  const stop = new Set(
    "what,when,where,which,while,how,why,who,does,is,are,was,were,can,could,should,would,will,explain,describe,define,meaning,tell,about,with,from,that,this,these,those,there,their,have,please,show,give,the,and,for".split(
      ",",
    ),
  );
  return question
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stop.has(w))
    .slice(0, 8);
}

/** §16 — honest uncertainty block for thin coverage (no hallucination). */
export function uncertaintyBlock(kbName: string | null, foundCount: number): string {
  const where = kbName ? `your tuned ${kbName} materials` : "your tuned materials";
  return [
    `I found ${foundCount === 0 ? "nothing relevant" : "only a passing mention"} in ${where} — not enough to answer from your documents.`,
    "",
    "Honest options:",
    "1. Upload the chapter or notes that cover it, then ask again.",
    "2. Ask me to answer from general knowledge — I will mark which parts are not from your materials.",
    "3. Try another subject knowledge base if this spans subjects.",
  ].join("\n");
}
