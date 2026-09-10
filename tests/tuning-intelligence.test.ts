import { describe, expect, it } from "vitest";
import { resolveSubject } from "@/lib/tuning/intelligence/subject-detection";
import { classifyAdvanced } from "@/lib/tuning/intelligence/classify";
import { detectIntent } from "@/lib/tuning/intelligence/intent";
import { selectStrategy } from "@/lib/tuning/intelligence/strategy";
import { decideVisual } from "@/lib/tuning/intelligence/visual-decision";
import { buildSubjectMap } from "@/lib/tuning/intelligence/subject-map";
import {
  buildLearningProfile,
  emptySignals,
  personalNoteFor,
  preferredVisualFrom,
  recordInteraction,
  stageOf,
} from "@/lib/tuning/intelligence/profile";
import { buildContext, dedupeAndRank } from "@/lib/tuning/intelligence/context-builder";
import { decideAfterRetrieval, decideBeforeRetrieval } from "@/lib/tuning/intelligence/pipeline";
import { needsValidation, uncertaintyBlock, validateResponse } from "@/lib/tuning/intelligence/validator";

const BASES = [
  { id: "ml", name: "Machine Learning" },
  { id: "os", name: "Operating Systems" },
];

describe("subject detection priority (§5)", () => {
  it("never overrides an explicit selection, even when the question names another KB", () => {
    const r = resolveSubject({
      explicitKbId: "ml",
      workspaceKbId: "os",
      recentQueries: ["explain paging in operating systems"],
      question: "explain paging in operating systems",
      bases: BASES,
    });
    expect(r.kbId).toBe("ml");
    expect(r.source).toBe("explicit");
  });

  it("prefers workspace, then conversation, then auto, then fallback", () => {
    expect(
      resolveSubject({ explicitKbId: null, workspaceKbId: "os", recentQueries: [], question: "what is entropy", bases: BASES }).source,
    ).toBe("workspace");
    expect(
      resolveSubject({
        explicitKbId: null,
        workspaceKbId: null,
        recentQueries: ["explain paging in operating systems"],
        question: "what is entropy",
        bases: BASES,
      }).kbId,
    ).toBe("os");
    expect(
      resolveSubject({ explicitKbId: null, workspaceKbId: null, recentQueries: [], question: "explain paging in operating systems", bases: BASES }).source,
    ).toBe("auto");
    const fb = resolveSubject({ explicitKbId: null, workspaceKbId: null, recentQueries: [], question: "what is for dinner", bases: BASES });
    expect(fb.kbId).toBeNull();
    expect(fb.source).toBe("fallback");
  });
});

describe("query classification (§6)", () => {
  it("allows multiple labels on one question", () => {
    const labels = classifyAdvanced("Explain how Dijkstra's algorithm works with a flowchart");
    expect(labels).toContain("explanation");
    expect(labels).toContain("algorithm");
    expect(labels).toContain("flowchart");
  });

  it("gives different questions different strategies", () => {
    const cmp = classifyAdvanced("compare BFS vs DFS");
    const def = classifyAdvanced("what is entropy");
    expect(cmp).toContain("comparison");
    expect(def).toContain("definition");
    expect(selectStrategy({ labels: cmp, intent: "learn", visual: "table", knowledgeAvailable: true, complexity: "medium" })).toBe("comparison");
    expect(selectStrategy({ labels: def, intent: "quick_fact", visual: "none", knowledgeAvailable: true, complexity: "short" })).toBe("quick_answer");
  });
});

describe("intent + strategy (§7/§8)", () => {
  it("detects exam, deep, and quick intents from cues", () => {
    expect(detectIntent("will this be on the exam, important marks question", { labels: ["explanation"], weakTopics: [], detailPref: "medium", questionKeywords: ["exam"] })).toBe("exam_prep");
    expect(detectIntent("explain recursion in depth from first principles", { labels: ["explanation"], weakTopics: [], detailPref: "medium", questionKeywords: ["recursion"] })).toBe("learn");
    expect(detectIntent("recursion briefly", { labels: ["definition"], weakTopics: [], detailPref: "detailed", questionKeywords: ["recursion"] })).toBe("quick_fact");
  });

  it("routes exam intent to exam mode and problem solving to steps", () => {
    expect(selectStrategy({ labels: ["explanation"], intent: "exam_prep", visual: "none", knowledgeAvailable: true, complexity: "medium" })).toBe("exam_mode");
    expect(selectStrategy({ labels: ["problem_solving"], intent: "apply", visual: "none", knowledgeAvailable: true, complexity: "medium" })).toBe("step_by_step");
    expect(selectStrategy({ labels: ["explanation"], intent: "learn", visual: "none", knowledgeAvailable: false, complexity: "medium" })).toBe("quick_answer");
  });
});

describe("visual decision (§9/§10)", () => {
  it("honors explicit flowchart asks", () => {
    expect(decideVisual("show a flowchart of quicksort", { labels: ["flowchart"], intent: "apply", hasRealData: false, imageAvailable: false })).toBe("flowchart");
  });

  it("refuses graphs without real data — never fabricated", () => {
    expect(decideVisual("graph my progress", { labels: ["graph"], intent: "learn", hasRealData: false, imageAvailable: false })).toBe("none");
    expect(decideVisual("graph my progress", { labels: ["graph"], intent: "learn", hasRealData: true, imageAvailable: false })).toBe("graph");
  });

  it("falls back to structured visuals when image generation is unavailable", () => {
    expect(decideVisual("generate an image of a neuron", { labels: ["image"], intent: "learn", hasRealData: false, imageAvailable: false })).toBe("concept_map");
    expect(decideVisual("generate an image of a neuron", { labels: ["image"], intent: "learn", hasRealData: false, imageAvailable: true })).toBe("image");
  });
});

describe("personalization (§3/§4/§13)", () => {
  const me = {
    streakDays: 4,
    weekMinutes: 120,
    weakAreas: [{ subject: "Data Structures", topic: "graph traversal" }],
    strongAreas: [{ subject: "Data Structures", topic: "arrays" }],
    recentSubjects: ["Data Structures"],
    achievementsUnlocked: 2,
    quizAccuracy: 60,
    detailLevel: "medium" as const,
  };

  it("builds the profile from real data only, with no locked visual preference", () => {
    const p = buildLearningProfile({ me, signals: emptySignals() });
    expect(p.activeSubjects).toContain("Data Structures");
    expect(p.needsPractice[0]!.topic).toBe("graph traversal");
    expect(p.preferredVisual).toBeNull();
  });

  it("mentions weak areas only when relevant to the question", () => {
    const p = buildLearningProfile({ me, signals: emptySignals() });
    expect(personalNoteFor(["graph", "traversal"], p)).toContain("graph traversal");
    expect(personalNoteFor(["photosynthesis"], p)).toBeNull();
  });

  it("never makes personality judgments — evidence-based wording only", () => {
    const p = buildLearningProfile({ me, signals: emptySignals() });
    const note = personalNoteFor(["graph"], p)!;
    expect(note).not.toMatch(/lazy|smart|stupid|bad student/i);
    expect(note).toMatch(/recent practice/i);
  });
});

describe("preference learning thresholds (§18)", () => {
  it("one interaction never locks a preference", () => {
    let s = emptySignals();
    s = recordInteraction(s, { visual: "flowchart", complexity: "medium", styles: [] });
    expect(stageOf(s, "visualRequests", "flowchart")).toBe("temporary");
    expect(preferredVisualFrom(s)).toBeNull();
  });

  it("repeated requests build confidence, consistent patterns suggest", () => {
    let s = emptySignals();
    for (let i = 0; i < 2; i++) s = recordInteraction(s, { visual: "flowchart", complexity: "medium", styles: [] });
    expect(stageOf(s, "visualRequests", "flowchart")).toBe("confidence");
    expect(preferredVisualFrom(s)).toBeNull();
    for (let i = 0; i < 2; i++) s = recordInteraction(s, { visual: "flowchart", complexity: "medium", styles: [] });
    expect(stageOf(s, "visualRequests", "flowchart")).toBe("suggested");
    expect(preferredVisualFrom(s)).toBe("flowchart");
  });
});

describe("context budget + isolation (§11/§12)", () => {
  const chunk = (content: string, score: number, kb = "ml", docName = "ml.pdf") => ({ docName, section: null, content, score, kb });

  it("never leaks another subject's chunks into a scoped question", () => {
    const ranked = dedupeAndRank([chunk("os paging content here", 0.9, "os"), chunk("ml entropy content here", 0.5, "ml")], "ml");
    expect(ranked.every((c) => (c as { kb?: string }).kb !== "os")).toBe(true);
    expect(ranked[0]!.content).toContain("entropy");
  });

  it("dedupes, ranks, and caps the context budget", () => {
    const dupes = [chunk("same passage text repeated here", 0.4), chunk("same passage text repeated here", 0.9), chunk("totally different material passage", 0.3)];
    const pack = buildContext({ userId: "u1", question: "what is entropy", chunks: dupes, scopedKbId: "ml", subjectSummary: "s", subjectMapText: null, personalNote: null });
    expect(pack.passages.length).toBeLessThanOrEqual(5);
    expect(pack.passages.length).toBe(2);
    expect(pack.passages[0]!.score).toBeGreaterThanOrEqual(pack.passages[1]!.score);
  });

  it("marks thin coverage instead of pretending", () => {
    const pack = buildContext({ userId: "u1", question: "obscure topic", chunks: [], scopedKbId: "ml", subjectSummary: "", subjectMapText: null, personalNote: "note" });
    expect(pack.thinCoverage).toBe(true);
    expect(pack.personalNote).toBeNull();
  });
});

describe("subject map (§2)", () => {
  it("builds hierarchy from sections, never hard-coded", () => {
    const nodes = buildSubjectMap({
      topicTree: [{ title: "Supervised Learning", chunks: 10 }, { title: "Supervised Learning > Regression", chunks: 4 }],
      relationships: [{ from: "supervised learning", to: "regression", weight: 3 }],
      coreConcepts: [{ term: "regression", count: 9, docs: 2 }],
    });
    expect(nodes.length).toBeGreaterThan(0);
    const root = nodes.find((n) => n.title === "Supervised Learning")!;
    expect(root.children.map((c) => c.title)).toContain("Regression");
  });

  it("returns empty for an empty profile", () => {
    expect(buildSubjectMap({ topicTree: [], relationships: [], coreConcepts: [] })).toEqual([]);
  });
});

describe("validation + uncertainty (§15/§16)", () => {
  const decision = decideAfterRetrieval(
    decideBeforeRetrieval({
      question: "explain entropy in detail",
      detection: { explicitKbId: "ml", workspaceKbId: null, recentQueries: [], bases: BASES },
      weakTopics: [],
      detailPref: "detailed",
      imageAvailable: false,
      hasRealData: false,
    }),
    true,
  );

  it("skips validation for trivial answers, checks the rest", () => {
    expect(needsValidation({ ...decision, strategy: "quick_answer", complexity: "short" })).toBe(false);
    expect(needsValidation(decision)).toBe(true);
  });

  it("flags a promised-but-missing visual", () => {
    const withVisual = { ...decision, visual: "flowchart" as const, strategy: "visual_explanation" as const };
    const r = validateResponse({
      decision: withVisual,
      pack: { question: "explain quicksort process", passages: [], subjectSummary: "", personalNote: null, knowledgeAvailable: true, thinCoverage: false },
      answer: { markdown: "Quicksort picks a pivot and partitions around it.", mermaid: null },
      sourcesClaimed: ["a.pdf"],
    });
    expect(r.checked).toBe(true);
    expect(r.issues).toContain("visual_mismatch");
  });

  it("admits gaps and offers paths instead of hallucinating", () => {
    const block = uncertaintyBlock("Machine Learning", 0);
    expect(block).toMatch(/not enough|nothing relevant/i);
    expect(block).toMatch(/general knowledge/);
  });
});

describe("full pipeline (§14)", () => {
  it("understands before retrieving: explicit subject respected end to end", () => {
    const pre = decideBeforeRetrieval({
      question: "Explain decision trees with a flowchart",
      detection: { explicitKbId: "ml", workspaceKbId: null, recentQueries: [], bases: BASES },
      weakTopics: ["classification"],
      detailPref: "detailed",
      imageAvailable: false,
      hasRealData: false,
    });
    expect(pre.subject.kbId).toBe("ml");
    expect(pre.labels).toContain("flowchart");
    const decision = decideAfterRetrieval(pre, true);
    expect(decision.strategy).toBe("visual_explanation");
    expect(decision.visual).toBe("flowchart");
    expect(decision.needsRetrieval).toBe(true);
  });
});
