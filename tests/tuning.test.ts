import { describe, expect, it } from "vitest";
import { buildTuningChunks, cleanTuningText, splitSections } from "@/lib/tuning/chunk";
import { backoffForAttempt, jobMayRetry } from "@/lib/tuning/jobs";
import { cosine, localEmbed, rankBySimilarity } from "@/lib/tuning/embed";
import { analyzePatterns, emptyProfile, parseProfile } from "@/lib/tuning/patterns";
import { classifyQuery, matchKnowledgeBase } from "@/lib/tuning/query";

describe("tuning text pipeline", () => {
  it("strips repeated headers and lone page numbers, keeps definitions", () => {
    const raw = [
      "Data Structures Notes",
      "1",
      "Data Structures Notes",
      "2",
      "A graph is a non-linear data structure of nodes and edges.",
      "Data Structures Notes",
    ].join("\n");
    const clean = cleanTuningText(raw);
    expect(clean).toContain("A graph is");
    expect(clean.match(/Data Structures Notes/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(clean).not.toMatch(/(^|\n)1(\n|$)/);
  });

  it("splits on section headings and chunks long bodies", () => {
    const body = `${"Paragraph about trees. ".repeat(60)}\n\n${"Paragraph about graphs. ".repeat(60)}`;
    const raw = `CHAPTER 1 Trees\n\n${body}\n\nCHAPTER 2 Graphs\n\n${body}`;
    const sections = splitSections(cleanTuningText(raw));
    expect(sections.length).toBeGreaterThanOrEqual(2);
    const chunks = buildTuningChunks(raw);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]!.content.length).toBeGreaterThanOrEqual(60);
    expect(chunks.every((c) => c.content.length >= 60)).toBe(true);
  });

  it("returns no chunks for near-empty text", () => {
    expect(buildTuningChunks("   \n \n  ")).toEqual([]);
  });
});

describe("tuning embeddings", () => {
  it("is deterministic and self-similar", () => {
    const a = localEmbed("graph traversal uses a queue for breadth first search");
    const b = localEmbed("graph traversal uses a queue for breadth first search");
    expect(a).toEqual(b);
    expect(cosine(a, b)).toBeCloseTo(1, 5);
  });

  it("ranks the related passage above the unrelated one", () => {
    const q = localEmbed("how does breadth first search traverse a graph");
    const related = localEmbed("breadth first search visits graph nodes level by level using a queue");
    const unrelated = localEmbed("photosynthesis converts sunlight into chemical energy in leaves");
    const order = rankBySimilarity(q, [unrelated, related], 2);
    expect(order[0]).toBe(1);
  });

  it("returns zero for empty vectors", () => {
    expect(cosine([], localEmbed("x"))).toBe(0);
  });
});

describe("tuning pattern analysis", () => {
  const docs = [
    {
      docId: "d1",
      section: "Trees",
      content:
        "A binary tree is a hierarchical data structure with nodes. Tree traversal visits nodes in order. The binary tree supports fast search.",
    },
    {
      docId: "d2",
      section: "Graphs",
      content:
        "A graph is a non-linear data structure of nodes and edges. Graph traversal uses breadth first search. What is the time complexity of breadth first search? Exercise: implement depth first search.",
    },
  ];

  it("finds recurring concepts across documents", () => {
    const p = analyzePatterns("Data Structures", docs);
    expect(p.coreConcepts.length).toBeGreaterThan(0);
    expect(p.coreConcepts[0]!.count).toBeGreaterThanOrEqual(2);
  });

  it("captures emphasized definitions", () => {
    const p = analyzePatterns("Data Structures", docs);
    expect(p.definitions.some((d) => /graph|binary tree/i.test(d.term))).toBe(true);
  });

  it("builds topic hierarchy and question patterns", () => {
    const p = analyzePatterns("Data Structures", docs);
    expect(p.topicTree.map((t) => t.title)).toContain("Trees");
    expect(p.questionPatterns.count).toBeGreaterThan(0);
    expect(p.summary).toContain("Data Structures");
  });

  it("parses stored profiles defensively", () => {
    // Pin the clock: emptyProfile() stamps `now`, so compare against the
    // same instant (millisecond-precision toEqual would flake otherwise).
    const parsed = parseProfile(null);
    expect(parsed).toEqual(emptyProfile(parsed.updatedAt));
    expect(parseProfile("not json{{").coreConcepts).toEqual([]);
    const p = parseProfile(JSON.stringify({ coreConcepts: [{ term: "x", count: 1, docs: 1 }] }));
    expect(p.coreConcepts[0]!.term).toBe("x");
  });
});

describe("tuning query understanding", () => {
  it("detects flowcharts, comparisons, definitions, graphs", () => {
    expect(classifyQuery("show me a flowchart of quicksort", "medium").visual).toBe("flowchart");
    expect(classifyQuery("compare BFS vs DFS", "medium").type).toBe("comparison");
    expect(classifyQuery("what is entropy", "medium").type).toBe("definition");
    expect(classifyQuery("graph my study trend", "medium").visual).toBe("graph");
  });

  it("respects explicit brevity and depth cues over prefs", () => {
    expect(classifyQuery("explain tcp briefly", "detailed").complexity).toBe("short");
    expect(classifyQuery("explain tcp in depth", "short").complexity).toBe("detailed");
  });

  it("keeps question words out of content keywords", () => {
    expect(classifyQuery("what is entropy", "medium").keywordTerms).toContain("entropy");
    expect(classifyQuery("what is entropy", "medium").keywordTerms).not.toContain("what");
  });

  it("matches subject hints to knowledge bases without mixing", () => {
    const bases = [
      { id: "ml", name: "Machine Learning" },
      { id: "os", name: "Operating Systems" },
    ];
    expect(matchKnowledgeBase("explain paging in operating systems", bases)).toBe("os");
    expect(matchKnowledgeBase("what is for dinner", bases)).toBeNull();
  });
});

describe("tuning job retry schedule", () => {
  it("backs off then holds, and stops after max attempts", () => {
    expect(backoffForAttempt(0)).toBe(0);
    expect(backoffForAttempt(1)).toBe(30_000);
    expect(backoffForAttempt(2)).toBe(120_000);
    expect(backoffForAttempt(99)).toBe(120_000);
    expect(jobMayRetry(2)).toBe(true);
    expect(jobMayRetry(3)).toBe(false);
  });
});
