import { describe, expect, it } from "vitest";
import {
  QuizSetSchema,
  gradeQuiz,
  normalizeConfig,
  validateMaterial,
  weakTopicsFromGrading,
  type QuizQuestion,
} from "@/lib/assess/quiz";
import {
  SummaryEvaluationSchema,
  normalizeEvalJson,
  validateAnswer,
  validateImage,
} from "@/lib/assess/summary";
import { extractJsonForEval } from "@/lib/assess/json";

const q = (over: Partial<QuizQuestion> = {}): QuizQuestion => ({
  id: "q1",
  topic: "Photosynthesis",
  question: "Where do the light-dependent reactions occur?",
  options: ["Stroma", "Thylakoid membranes", "Cytoplasm", "Mitochondrial matrix"],
  correctOptionIndex: 1,
  explanation: "Light-dependent reactions run across the thylakoid membranes.",
  wrongWhy: "The stroma hosts the Calvin cycle, not the light reactions.",
  difficulty: "medium",
  ...over,
});

describe("quiz schema validation", () => {
  it("accepts a well-formed set", () => {
    expect(QuizSetSchema.safeParse({ questions: [q()] }).success).toBe(true);
  });

  it("rejects wrong option counts and out-of-range answers", () => {
    expect(QuizSetSchema.safeParse({ questions: [q({ options: ["a", "b"] })] }).success).toBe(false);
    expect(QuizSetSchema.safeParse({ questions: [q({ correctOptionIndex: 7 })] }).success).toBe(false);
    expect(QuizSetSchema.safeParse({ questions: [] }).success).toBe(false);
  });
});

describe("quiz grading (server-side, trusted questions)", () => {
  const set = [q(), q({ id: "q2", topic: "Respiration", correctOptionIndex: 0 })];

  it("marks correct and wrong answers", () => {
    const r = gradeQuiz(set, [1, 2]);
    expect(r.correctCount).toBe(1);
    expect(r.scorePercent).toBe(50);
    expect(r.answers[0]!.correct).toBe(true);
    expect(r.answers[1]!.correct).toBe(false);
    expect(r.answers[1]!.correctOptionIndex).toBe(0);
  });

  it("treats unanswered as incorrect, never as correct", () => {
    const r = gradeQuiz(set, [1]);
    expect(r.answers[1]!.selected).toBeNull();
    expect(r.answers[1]!.correct).toBe(false);
    expect(r.correctCount).toBe(1);
  });

  it("derives weak topics only from missed questions", () => {
    const r = gradeQuiz(set, [1, 2]);
    expect(weakTopicsFromGrading(r.answers)).toEqual([{ topic: "Respiration", missed: 1 }]);
    const clean = gradeQuiz(set, [1, 0]);
    expect(weakTopicsFromGrading(clean.answers)).toEqual([]);
  });
});

describe("material and answer validation", () => {
  it("rejects thin material, caps long material", () => {
    expect(validateMaterial("too short").ok).toBe(false);
    const big = validateMaterial("x".repeat(300) + "y".repeat(20000));
    expect(big.ok).toBe(true);
    if (big.ok) expect(big.material.length).toBeLessThanOrEqual(12000);
  });

  it("rejects empty answers, caps long ones", () => {
    expect(validateAnswer("  ").ok).toBe(false);
    const big = validateAnswer("z".repeat(5000));
    expect(big.ok).toBe(true);
    if (big.ok) expect(big.answer.length).toBeLessThanOrEqual(4000);
  });

  it("validates answer images by type and size", () => {
    expect(validateImage("image/png", 1000).ok).toBe(true);
    expect(validateImage("image/webp", 1000).ok).toBe(true);
    expect(validateImage("image/gif", 1000).ok).toBe(true);
    expect(validateImage("image/svg+xml", 1000).ok).toBe(false);
    expect(validateImage("image/jpeg", 0).ok).toBe(false);
    expect(validateImage("image/jpeg", 9 * 1024 * 1024).ok).toBe(true);
    expect(validateImage("image/jpeg", 11 * 1024 * 1024).ok).toBe(false);
  });

  it("normalizes quiz config into safe bounds", () => {
    expect(normalizeConfig({})).toMatchObject({ count: 5, difficulty: "mixed" });
    expect(normalizeConfig({ count: 99, difficulty: "brutal" }).count).toBe(10);
    expect(normalizeConfig({ count: 1 }).count).toBe(3);
  });
});

describe("summary evaluation schema", () => {
  const good = {
    overallAssessment: "Good answer with a few missing points.",
    score: 78,
    understanding: "Strong",
    completeness: "Needs improvement",
    accuracy: "Good",
    clarity: "Good",
    correctPoints: ["Named the reactants"],
    missingPoints: ["Skipped the Calvin cycle"],
    mistakes: [],
    improvementSuggestions: ["Define the concept first"],
    representationFeedback: ["Logical flow, add headings"],
    suggestedImprovedAnswer: "A stronger answer would start by defining photosynthesis, then walk through the light-dependent reactions and the Calvin cycle in order.",
  };

  it("accepts a complete evaluation with empty mistakes", () => {
    expect(SummaryEvaluationSchema.safeParse(good).success).toBe(true);
  });

  it("rejects out-of-range scores and missing feedback", () => {
    expect(SummaryEvaluationSchema.safeParse({ ...good, score: 140 }).success).toBe(false);
    expect(SummaryEvaluationSchema.safeParse({ ...good, improvementSuggestions: [] }).success).toBe(false);
    expect(SummaryEvaluationSchema.safeParse({ ...good, understanding: "Perfect" }).success).toBe(false);
  });

  it("extracts JSON from fenced vision output", () => {
    const raw = "Here is my analysis:\n```json\n" + JSON.stringify(good) + "\n```";
    expect(SummaryEvaluationSchema.safeParse(extractJsonForEval(raw)).success).toBe(true);
  });

  it("normalizes paraphrased keys and band wording", () => {
    const aliased = {
      overall: "Good answer with a few missing points.",
      score: 78,
      comprehension: "excellent",
      coverage: "average",
      correctness: "good",
      readability: "poor",
      strengths: ["Named the reactants"],
      gaps: ["Skipped the Calvin cycle"],
      errors: [{ quote: "It happens in the nucleus", reason: "Wrong organelle", fix: "It happens in the chloroplast" }],
      suggestions: ["Define the concept first"],
      presentation: ["Logical flow, add headings"],
      model_answer: "A stronger answer would start by defining photosynthesis, then walk through the light-dependent reactions and the Calvin cycle in order.",
    };
    const parsed = SummaryEvaluationSchema.safeParse(normalizeEvalJson(aliased));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.understanding).toBe("Strong");
      expect(parsed.data.completeness).toBe("Good");
      expect(parsed.data.clarity).toBe("Needs improvement");
      expect(parsed.data.mistakes[0]!.statement).toContain("nucleus");
    }
  });
});
