/* ──────────────────────────────────────────────────────────────
   §8 — Response strategy selection (A–F).

   Question → Classification → Intent → Subject context →
   Knowledge availability → Learning context → Strategy.
   ────────────────────────────────────────────────────────────── */

import type { QueryLabel, ResponseStrategy, UserIntent } from "./types";
import type { VisualDecisionKind } from "./types";

export type StrategyInput = {
  labels: QueryLabel[];
  intent: UserIntent;
  visual: VisualDecisionKind;
  knowledgeAvailable: boolean;
  complexity: "short" | "medium" | "detailed";
};

export function selectStrategy(input: StrategyInput): ResponseStrategy {
  const { labels, intent, visual, knowledgeAvailable } = input;
  const has = (...ls: QueryLabel[]) => ls.some((l) => labels.includes(l));

  // A visual that earned its place drives a visual explanation.
  if (visual !== "none" && visual !== "table") return "visual_explanation";
  // Explicit comparison (or a requested table) → comparison strategy.
  if (has("comparison") || visual === "table") return "comparison";
  // Exam intent → exam mode (answer + key points + mistakes + tip).
  if (intent === "exam_prep") return "exam_mode";
  // Problem solving / process walkthrough → step-by-step.
  if (intent === "apply" || has("problem_solving", "step_by_step", "algorithm")) return "step_by_step";
  // Thin knowledge → don't pad: quick honest answer + next step.
  if (!knowledgeAvailable) return "quick_answer";
  // Simple question, simple intent → quick answer + short example.
  if (intent === "quick_fact" || (has("definition") && input.complexity === "short")) return "quick_answer";
  // Revision → exam-mode revision sheet reads better than prose.
  if (intent === "revise" || has("revision", "summary")) return "exam_mode";
  // Default: full learning explanation (definition → concept → example).
  return "learning_explanation";
}

/** Section skeleton each strategy must follow (§15 format check reads this). */
export const STRATEGY_SECTIONS: Record<ResponseStrategy, string[]> = {
  quick_answer: ["answer", "example"],
  learning_explanation: ["definition", "concept", "example", "key-points"],
  step_by_step: ["problem", "steps", "result"],
  visual_explanation: ["explanation", "visual"],
  exam_mode: ["answer", "key-points", "terms", "mistakes", "tip"],
  comparison: ["concepts", "table", "examples"],
};
