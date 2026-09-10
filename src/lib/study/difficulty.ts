/* ──────────────────────────────────────────────────────────────
   Study Intelligence — difficulty that genuinely changes output.

   Each level carries an explicit generation contract injected into
   the model prompt. Hard stays inside the provided material: depth
   comes from reasoning, never from unrelated advanced topics.
   ────────────────────────────────────────────────────────────── */

export type StudyDifficulty = "easy" | "medium" | "hard";

/** UI value → generation value (the engine's "mixed" IS medium). */
export function toEngineDifficulty(input: unknown): "easy" | "mixed" | "hard" {
  if (input === "easy" || input === "hard") return input;
  return "mixed";
}

export const DIFFICULTY_GUIDE: Record<"easy" | "mixed" | "hard", string> = {
  easy: [
    "Difficulty EASY: test basic definitions, fundamental concepts, and direct facts.",
    "One idea per question. Avoid trick options, multi-step reasoning, and edge cases.",
  ].join(" "),
  mixed: [
    "Difficulty MEDIUM: test concept understanding, comparisons, application,",
    "and relationships between concepts. Some questions may combine two ideas,",
    "but every question stays directly answerable from the material.",
  ].join(" "),
  hard: [
    "Difficulty HARD: test deep understanding with complex scenarios, multi-step",
    "reasoning, concept integration, and difficult applications. Distractors must",
    "be plausible misconceptions, not throwaways. Stay strictly inside the",
    "provided material — do NOT introduce unrelated advanced topics to raise",
    "difficulty; raise it through reasoning instead.",
  ].join(" "),
};

/** Prompt block for the requested difficulty (empty for unknown → safe default). */
export function difficultyPromptBlock(difficulty: "easy" | "mixed" | "hard"): string {
  return DIFFICULTY_GUIDE[difficulty] ?? DIFFICULTY_GUIDE.mixed;
}
