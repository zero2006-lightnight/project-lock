/* ──────────────────────────────────────────────────────────────
   Tuning Intelligence Engine — shared decision types.

   Principle: understand first, retrieve second, personalize third,
   choose the response strategy fourth, generate last. Every stage
   below is a pure, unit-testable decision over real data — no model
   in the loop, no invented claims.
   ────────────────────────────────────────────────────────────── */

/** §6 — multi-label question categories (never forced into one). */
export type QueryLabel =
  | "definition"
  | "explanation"
  | "summary"
  | "comparison"
  | "step_by_step"
  | "problem_solving"
  | "revision"
  | "example"
  | "diagram"
  | "flowchart"
  | "graph"
  | "image"
  | "code"
  | "analysis"
  | "algorithm";

/** §7 — what the user actually needs (depth + goal). */
export type UserIntent =
  | "quick_fact" // beginner/simple: short definition + example
  | "learn" // deep: detailed explanation with behavior + examples
  | "exam_prep" // definition + key points + likely exam angles
  | "revise" // recap of known material, key points only
  | "apply"; // solve/work through a problem step by step

/** §8 — response strategies A–F. */
export type ResponseStrategy =
  | "quick_answer" // A
  | "learning_explanation" // B
  | "step_by_step" // C
  | "visual_explanation" // D
  | "exam_mode" // E
  | "comparison"; // F

/** §9/§10 — visual kinds, generation priority: structured > chart > image. */
export type VisualDecisionKind = "none" | "flowchart" | "concept_map" | "table" | "graph" | "image";

/** §5 — where the resolved subject came from (priority order). */
export type SubjectResolutionSource =
  | "explicit" // user picked a KB/subject — never overridden
  | "workspace" // current Tuning workspace/KB
  | "conversation" // recent tuning question context
  | "auto" // semantic hint match
  | "fallback"; // most-recent ready base (asked openly, not claimed)

/** §5 — resolved subject context for one question. */
export type ResolvedSubject = {
  kbId: string | null;
  kbName: string | null;
  source: SubjectResolutionSource;
  explicitOverridden: false; // type-level guarantee: explicit is never overridden
};

/** §4 — lightweight learning profile, every field from real data or prefs. */
export type LearningProfile = {
  activeSubjects: string[];
  strongConcepts: { subject: string; topic: string }[];
  needsPractice: { subject: string; topic: string }[];
  recentActivity: string[];
  preferredDetail: "short" | "medium" | "detailed";
  preferredVisual: VisualDecisionKind | null; // suggested preference only (see signals)
  quizAccuracy: number | null;
  streakDays: number;
};

/** §17/§18 — repeated-evidence preference signals with confidence stages. */
export type SignalStage = "temporary" | "confidence" | "suggested";

export type PreferenceSignals = {
  visualRequests: Record<string, number>; // VisualDecisionKind -> count
  detailRequests: Record<string, number>; // short|medium|detailed cues -> count
  styleRequests: Record<string, number>; // e.g. "example" | "exam" | "steps"
  updatedAt: string;
};

export const SIGNAL_SUGGEST_AT = 4; // consistent pattern -> suggested preference
export const SIGNAL_CONFIDENCE_AT = 2; // repeated -> increasing confidence

export function signalStage(count: number): SignalStage {
  if (count >= SIGNAL_SUGGEST_AT) return "suggested";
  if (count >= SIGNAL_CONFIDENCE_AT) return "confidence";
  return "temporary";
}

/** §2 — generated subject knowledge map node (never hard-coded). */
export type SubjectMapNode = {
  title: string;
  chunks: number;
  children: SubjectMapNode[];
};

/** §11/§12 — assembled, budgeted context for generation. */
export type ContextPack = {
  question: string;
  passages: { docName: string; section: string | null; content: string; score: number }[];
  subjectSummary: string;
  personalNote: string | null; // null when personalization adds nothing
  knowledgeAvailable: boolean;
  thinCoverage: boolean;
};

/** §15 — lightweight validation outcome. */
export type ValidationIssue =
  | "off_topic"
  | "ungrounded_claim"
  | "wrong_subject"
  | "strategy_mismatch"
  | "visual_mismatch";

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
  checked: boolean; // false when skipped as trivial (§15: selective)
};

/** §14 — the full per-question decision record. */
export type IntelligenceDecision = {
  subject: ResolvedSubject;
  labels: QueryLabel[];
  intent: UserIntent;
  strategy: ResponseStrategy;
  visual: VisualDecisionKind;
  complexity: "short" | "medium" | "detailed";
  needsRetrieval: boolean;
  needsPersonalization: boolean;
};
