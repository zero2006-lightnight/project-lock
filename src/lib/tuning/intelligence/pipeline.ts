/* ──────────────────────────────────────────────────────────────
   §14 — AI response pipeline (decision half, pure + testable):

     Question → Subject Detection → Classification → Intent →
     Visual Decision → (retrieval happens in the action, scoped by
     the resolved subject) → Context → Strategy → Generate →
     Validate.

   This module makes every decision BEFORE generation. The action
   (`askTuningAction`) performs the scoped retrieval + generation
   between `decideBeforeRetrieval` and `decideAfterRetrieval`.
   ────────────────────────────────────────────────────────────── */

import type {
  IntelligenceDecision,
  ResolvedSubject,
  VisualDecisionKind,
} from "./types";
import { resolveSubject, type SubjectDetectionInput } from "./subject-detection";
import { classifyAdvanced } from "./classify";
import { detectIntent } from "./intent";
import { decideVisual } from "./visual-decision";
import { selectStrategy } from "./strategy";
import { keywordTermsOf } from "../query";

export type PipelineInput = {
  question: string; // sanitized
  detection: Omit<SubjectDetectionInput, "question"> & {
    bases: { id: string; name: string }[];
  };
  weakTopics: string[]; // lowercased
  detailPref: "short" | "medium" | "detailed";
  imageAvailable: boolean;
  hasRealData: boolean;
};

export type PreRetrieval = {
  subject: ResolvedSubject;
  labels: ReturnType<typeof classifyAdvanced>;
  intent: ReturnType<typeof detectIntent>;
  visual: VisualDecisionKind;
  complexity: "short" | "medium" | "detailed";
  keywords: string[];
};

/** Stages 1–5: everything decidable before touching the index. */
export function decideBeforeRetrieval(input: PipelineInput): PreRetrieval {
  const subject = resolveSubject({
    explicitKbId: input.detection.explicitKbId,
    workspaceKbId: input.detection.workspaceKbId,
    recentQueries: input.detection.recentQueries,
    question: input.question,
    bases: input.detection.bases,
  });

  const labels = classifyAdvanced(input.question);
  const keywords = keywordTermsOf(input.question.toLowerCase());
  const intent = detectIntent(input.question, {
    labels,
    weakTopics: input.weakTopics,
    detailPref: input.detailPref,
    questionKeywords: keywords,
  });
  const complexity = resolveComplexity(input.question, labels, input.detailPref);
  const visual = decideVisual(input.question, {
    labels,
    intent,
    hasRealData: input.hasRealData,
    imageAvailable: input.imageAvailable,
  });

  return { subject, labels, intent, visual, complexity, keywords };
}

/** Stages 6–7: after scoped retrieval — strategy + full decision record. */
export function decideAfterRetrieval(pre: PreRetrieval, knowledgeAvailable: boolean): IntelligenceDecision {
  const strategy = selectStrategy({
    labels: pre.labels,
    intent: pre.intent,
    visual: pre.visual,
    knowledgeAvailable,
    complexity: pre.complexity,
  });
  return {
    subject: pre.subject,
    labels: pre.labels,
    intent: pre.intent,
    strategy,
    visual: pre.visual,
    complexity: pre.complexity,
    needsRetrieval: true,
    // Personalize only when it helps: learning/exam intents with real context.
    needsPersonalization:
      knowledgeAvailable && (pre.intent === "learn" || pre.intent === "exam_prep" || pre.intent === "revise"),
  };
}

const T = (re: RegExp, q: string) => re.test(q);

/** Explicit length cues beat prefs; definitions default short. */
export function resolveComplexity(
  raw: string,
  labels: ReturnType<typeof classifyAdvanced>,
  pref: "short" | "medium" | "detailed",
): "short" | "medium" | "detailed" {
  const q = raw.toLowerCase();
  if (T(/\b(brief(ly)?|short|quick(ly)?|one ?line|in a sentence)\b/, q)) return "short";
  if (T(/\b(detail|in[- ]depth|thorough|step[- ]by[- ]step|explain fully|elaborate)\b/, q)) return "detailed";
  if (labels.length === 1 && labels[0] === "definition") return "short";
  return pref;
}
