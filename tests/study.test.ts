import { describe, expect, it } from "vitest";
import { buildSyllabusMaterialText } from "@/lib/study/sources";
import { difficultyPromptBlock, toEngineDifficulty } from "@/lib/study/difficulty";
import { gradeQuiz, normalizeConfig, validateGeneralPrompt, type QuizQuestion } from "@/lib/assess/quiz";
import { FlashcardSetSchema, validateFlashcardMaterial } from "@/lib/assess/flashcards";
import { MAX_BRANCHES, MAX_CHILDREN, MindMapSchema, validateMindMapMaterial } from "@/lib/assess/mindmaps";
import { nextReviewInterval } from "@/lib/study/scheduling";

const topics = [
  { name: "Trees", description: "Hierarchical structures", status: "completed" },
  { name: "Graphs", description: "Nodes and edges", status: "learning" },
];

describe("syllabus context builder (shared retrieval)", () => {
  it("scopes text to the selected subject/unit/topics", () => {
    const text = buildSyllabusMaterialText({
      subjectName: "Data Structures",
      unitName: "Non-linear",
      topics,
      excerpts: ["BFS visits level by level."],
    });
    expect(text).toContain("Data Structures");
    expect(text).toContain("Non-linear");
    expect(text).toContain("Trees");
    expect(text).toContain("BFS visits level by level");
  });

  it("caps output and carries an optional focus", () => {
    const text = buildSyllabusMaterialText({
      subjectName: "S",
      unitName: null,
      topics: [],
      excerpts: ["x".repeat(20000)],
      focus: "Graphs",
    });
    expect(text.length).toBeLessThanOrEqual(10000 + 200);
    expect(text).toContain("Graphs");
  });

  it("works with structure alone when no notes exist", () => {
    const text = buildSyllabusMaterialText({ subjectName: "OS", unitName: null, topics, excerpts: [] });
    expect(text).toContain("Trees");
    expect(text.length).toBeGreaterThan(20);
  });
});

describe("difficulty genuinely changes generation", () => {
  it("maps UI values to engine values (medium is mixed)", () => {
    expect(toEngineDifficulty("easy")).toBe("easy");
    expect(toEngineDifficulty("hard")).toBe("hard");
    expect(toEngineDifficulty("medium")).toBe("mixed");
    expect(toEngineDifficulty("brutal")).toBe("mixed");
  });

  it("emits a distinct contract per level", () => {
    const easy = difficultyPromptBlock("easy");
    const medium = difficultyPromptBlock("mixed");
    const hard = difficultyPromptBlock("hard");
    expect(new Set([easy, medium, hard]).size).toBe(3);
    expect(easy).toMatch(/basic definitions|direct facts/i);
    expect(medium).toMatch(/comparison|application/i);
    expect(hard).toMatch(/multi-step|integration/i);
    // Hard stays inside the material — never new advanced topics.
    expect(hard).toMatch(/strictly inside|provided material/i);
  });

  it("keeps the existing config contract (medium normalizes to mixed)", () => {
    expect(normalizeConfig({ difficulty: "medium" }).difficulty).toBe("mixed");
    expect(normalizeConfig({ difficulty: "easy" }).difficulty).toBe("easy");
  });
});

describe("general quiz prompts", () => {
  it("accepts words, sentences, and detailed prompts; rejects empties", () => {
    expect(validateGeneralPrompt("  ").ok).toBe(false);
    expect(validateGeneralPrompt("AI").ok).toBe(false);
    expect(validateGeneralPrompt("Python loops").ok).toBe(true);
    const big = validateGeneralPrompt("x".repeat(900));
    expect(big.ok).toBe(true);
    if (big.ok) expect(big.prompt.length).toBeLessThanOrEqual(500);
  });
});

describe("flashcard generation contract", () => {
  const card = (over = {}) => ({ kind: "comparison", front: "BFS vs DFS?", back: "BFS is level by level; DFS goes deep first.", memoryTip: "Breadth = wide", ...over });

  it("accepts varied card kinds with memory tips", () => {
    expect(FlashcardSetSchema.safeParse({ cards: [card(), card({ kind: "cloze", front: "BFS uses a ___", back: "queue" })] }).success).toBe(true);
  });

  it("rejects empty sets and thin material", () => {
    expect(FlashcardSetSchema.safeParse({ cards: [] }).success).toBe(false);
    expect(FlashcardSetSchema.safeParse({ cards: Array.from({ length: 13 }, () => card()) }).success).toBe(false);
    expect(validateFlashcardMaterial("short").ok).toBe(false);
  });
});

describe("mind-map readability contract", () => {
  const branch = (label: string, kids = 2) => ({
    label,
    detail: "",
    children: Array.from({ length: kids }, (_, i) => ({ label: `${label}.${i}`, detail: "" })),
  });

  it("accepts a well-formed map within caps", () => {
    expect(MindMapSchema.safeParse({ central: "Recursion", summary: "", branches: [branch("Base case"), branch("Recursive step")] }).success).toBe(true);
  });

  it("rejects single-branch maps and thin material", () => {
    expect(MindMapSchema.safeParse({ central: "X", branches: [branch("Only")] }).success).toBe(false);
    expect(validateMindMapMaterial("short").ok).toBe(false);
  });

  it("caps branches and children for readability", () => {
    expect(MAX_BRANCHES).toBeLessThanOrEqual(6);
    expect(MAX_CHILDREN).toBeLessThanOrEqual(5);
  });
});

describe("flashcard self-assessment scheduling", () => {
  it("stretches easy recalls, shortens practice, resets hard", () => {
    expect(nextReviewInterval(3, "easy")).toBe(7);
    expect(nextReviewInterval(0, "easy")).toBe(1);
    expect(nextReviewInterval(10, "practice")).toBe(1);
    expect(nextReviewInterval(10, "hard")).toBe(0);
    expect(nextReviewInterval(30, "easy")).toBeLessThanOrEqual(60);
  });
});

describe("strengths need evidence", () => {
  const mk = (id: string, topic: string): QuizQuestion => ({
    id,
    topic,
    question: `Q ${id} about ${topic}?`,
    options: ["a", "b", "c", "d"],
    correctOptionIndex: 0,
    explanation: "Because it is correct.",
    wrongWhy: "",
    difficulty: "medium",
  });
  it("names a strength only with 2+ clean answers on a topic", async () => {
    const { strongTopicsFromGrading } = await import("@/lib/assess/quiz");
    const set = [mk("q1", "Arrays"), mk("q2", "Arrays"), mk("q3", "Graphs")];
    const r = gradeQuiz(set, [0, 0, 0]);
    expect(strongTopicsFromGrading(r.answers)).toEqual([{ topic: "Arrays", correct: 2 }]);
    const thin = gradeQuiz([mk("q1", "Solo")], [0]);
    expect(strongTopicsFromGrading(thin.answers)).toEqual([]);
  });
});

describe("mind-map tree layout (NotebookLM-style)", () => {
  const map = {
    central: "Recursion",
    summary: "",
    branches: [
      { label: "Base case", detail: "", children: [{ label: "Return", detail: "" }] },
      { label: "Recursive step", detail: "", children: [{ label: "Smaller input", detail: "" }, { label: "Combine", detail: "" }] },
    ],
  };
  it("places center, branches on both sides, and connects every node", async () => {
    const { layoutTree } = await import("@/components/app/mindmap-studio");
    const t = layoutTree(map, new Set());
    const kinds = t.nodes.map((n) => n.kind);
    expect(kinds).toContain("central");
    expect(t.nodes.filter((n) => n.kind === "branch").length).toBe(2);
    expect(t.nodes.filter((n) => n.kind === "leaf").length).toBe(3);
    // every non-central node has exactly one incoming connector
    expect(t.links.length).toBe(t.nodes.length - 1);
    expect(t.width).toBeGreaterThan(0);
    expect(t.height).toBeGreaterThan(0);
    // branches sit on both sides of the center node
    const center = t.nodes.find((n) => n.kind === "central")!;
    const xs = t.nodes.filter((n) => n.kind === "branch").map((b) => b.x);
    expect(Math.min(...xs)).toBeLessThan(center.x);
    expect(Math.max(...xs)).toBeGreaterThan(center.x);
  });
  it("collapsing a branch hides its leaves and connectors", async () => {
    const { layoutTree } = await import("@/components/app/mindmap-studio");
    const t = layoutTree(map, new Set(["Base case"]));
    expect(t.nodes.filter((n) => n.kind === "leaf").length).toBe(2);
    expect(t.links.length).toBe(t.nodes.length - 1);
  });
});

describe("Pilot study-aids context", () => {
  const ctx = (over = {}) => ({
    studyAids: { flashcards: [], mindmaps: [] },
    ...over,
  });
  it("renders nothing when the student has no study aids", async () => {
    const { buildStudyAids } = await import("@/lib/study/study-aids");
    expect(buildStudyAids(ctx() as never)).toBe("");
  });
  it("references the student's own cards and map structure", async () => {
    const { buildStudyAids } = await import("@/lib/study/study-aids");
    const block = buildStudyAids(
      ctx({
        studyAids: {
          flashcards: [{ front: "BFS vs DFS?", back: "Breadth vs depth.", subjectName: "DS" }],
          mindmaps: [{ title: "Recursion", branches: [{ label: "Base case", children: ["Stops calls"] }] }],
        },
      }) as never,
    );
    expect(block).toContain("BFS vs DFS?");
    expect(block).toContain("Recursion");
    expect(block).toContain("Base case");
  });
  it("caps cards at ten so the prompt stays budgeted", async () => {
    const { buildStudyAids } = await import("@/lib/study/study-aids");
    const cards = Array.from({ length: 15 }, (_, i) => ({ front: `Q${i}`, back: `A${i}`, subjectName: null }));
    const block = buildStudyAids(ctx({ studyAids: { flashcards: cards, mindmaps: [] } }) as never);
    expect(block).toContain("Q9");
    expect(block).not.toContain("Q10");
  });
});
