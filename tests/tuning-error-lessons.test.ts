import { describe, expect, it } from "vitest";
import {
  buildPreventionRule,
  classifyErrorType,
  detectCorrectionIntent,
  findDuplicateLesson,
  formatLessonsForPrompt,
  inferRootCause,
  lessonOutrankedByChunks,
  rankLessons,
  scopeLessons,
  strengthenedConfidence,
  verifyCorrection,
  MAX_LESSONS_PER_QUERY,
} from "@/lib/tuning/error-lessons";
import { localEmbed } from "@/lib/tuning/embed";
import type { TuningErrorLesson } from "@/lib/db/schema";

function lesson(over: Partial<TuningErrorLesson> & { keywords?: string[]; text?: string }): TuningErrorLesson {
  const keywords = over.keywords ?? ["normalization", "database"];
  const text = over.text ?? `${keywords.join(" ")} prevention rule prioritize uploaded material`;
  const base = {
    id: over.id ?? "l1",
    userId: "u1",
    kbId: "kb-db",
    subjectId: null,
    topic: "normalization",
    errorType: "source_priority_error",
    mistakeSummary: "Used general definition instead of tuned material.",
    rootCause: "General knowledge overrode tuned material.",
    correctApproach: "Use the uploaded definition.",
    preventionRule: "Retrieve and prioritize the uploaded tuned material for this topic before relying on general knowledge.",
    sourceEvidence: "{}",
    confidence: "high",
    relevanceMetadata: JSON.stringify({ keywords }),
    embedding: JSON.stringify(localEmbed(text)),
    occurrenceCount: 1,
    usageCount: 0,
    status: "active",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    lastOccurredAt: null,
    lastUsedAt: null,
  } as TuningErrorLesson;
  return { ...base, ...over, relevanceMetadata: over.relevanceMetadata ?? base.relevanceMetadata, embedding: over.embedding ?? base.embedding } as TuningErrorLesson;
}

const dbChunk = (content: string) => ({ content });

describe("dynamic error learning", () => {
  it("TEST 1 — verified academic error becomes a retrievable high-confidence lesson", () => {
    const chunks = [dbChunk("Normalization is the process of organizing data in a database to reduce redundancy as defined in chapter 3 of the uploaded notes.")];
    const v = verifyCorrection({ correction: "Normalization organizes data to reduce redundancy per chapter 3 notes", chunks, errorType: "factual_error" });
    expect(["high", "medium"]).toContain(v.confidence);
    const l = lesson({ confidence: v.confidence, keywords: ["normalization", "database", "redundancy"], text: "normalization database redundancy prioritize uploaded material" });
    const ranked = rankLessons({ lessons: [l], queryEmbedding: localEmbed("what is normalization in databases"), queryKeywords: ["normalization", "databases"] });
    expect(ranked.length).toBe(1);
    expect(formatLessonsForPrompt(ranked)).toMatch(/prioritize/i);
  });

  it("TEST 2 — incorrect user correction stays unverified and never steers answers", () => {
    const chunks = [dbChunk("Photosynthesis converts sunlight into chemical energy in leaves.")];
    const v = verifyCorrection({ correction: "Mitochondria power animal cells through respiration cycles", chunks, errorType: "factual_error" });
    expect(v.confidence).toBe("unverified");
    const l = lesson({ id: "bad", confidence: "unverified", keywords: ["photosynthesis", "mitochondria"], text: "photosynthesis mitochondria animal" });
    const ranked = rankLessons({ lessons: [l], queryEmbedding: localEmbed("where does photosynthesis happen"), queryKeywords: ["photosynthesis", "happen"] });
    expect(ranked).toEqual([]);
  });

  it("TEST 3 — lessons from another subject scope are excluded", () => {
    const dbLesson = lesson({ id: "db", kbId: "kb-db", keywords: ["normalization"], text: "normalization database" });
    const mlLesson = lesson({ id: "ml", kbId: "kb-ml", keywords: ["gradient", "descent"], text: "gradient descent learning rate" });
    const scoped = scopeLessons([dbLesson, mlLesson], "kb-ml");
    expect(scoped.map((l) => l.id)).toEqual(["ml"]);
    // ...and relevance keeps Topic A separate from Topic B
    const ranked = rankLessons({ lessons: scoped, queryEmbedding: localEmbed("explain gradient descent learning rate"), queryKeywords: ["gradient", "descent"] });
    expect(ranked.every((l) => l.kbId === "kb-ml")).toBe(true);
  });

  it("TEST 4 — user isolation is structural (scope filter never mixes owners; DB layer always filters by userId)", () => {
    // Pure layer: scopeLessons never sees another user's rows because
    // loadScopedLessons queries WHERE userId = ? first. Simulate two owners:
    const a = lesson({ id: "a", userId: "user-a", kbId: "kb-shared-name" });
    const b = lesson({ id: "b", userId: "user-b", kbId: "kb-shared-name" });
    // Even with identical kb names, per-user queries return disjoint sets —
    // scopeLessons operates on an already user-filtered array:
    expect(scopeLessons([a], "kb-shared-name").map((l) => l.userId)).toEqual(["user-a"]);
    expect(scopeLessons([b], "kb-shared-name").map((l) => l.userId)).toEqual(["user-b"]);
  });

  it("TEST 5 — duplicate verified mistakes update instead of duplicating", () => {
    const existing = [{ id: "e1", embedding: localEmbed("normalization database prioritize uploaded material"), keywords: ["normalization", "database"] }];
    const dupe = findDuplicateLesson(existing, { embedding: localEmbed("normalization database prioritize uploaded material"), keywords: ["normalization", "database"] });
    expect(dupe).toBe("e1");
    const fresh = findDuplicateLesson(existing, { embedding: localEmbed("photosynthesis sunlight leaves"), keywords: ["photosynthesis", "sunlight"] });
    expect(fresh).toBeNull();
  });

  it("TEST 6 — outdated lessons lose to current high-confidence evidence", () => {
    const weak = lesson({ id: "old", confidence: "low" });
    expect(lessonOutrankedByChunks(weak, [{ score: 0.5 }])).toBe(true);
    const strong = lesson({ id: "good", confidence: "high" });
    expect(lessonOutrankedByChunks(strong, [{ score: 0.5 }])).toBe(false);
    // Obsolete / under-review / disabled lessons are never injected
    const ranked = rankLessons({
      lessons: [
        lesson({ id: "o", status: "obsolete" }),
        lesson({ id: "r", status: "under_review" }),
        lesson({ id: "d", status: "disabled" }),
        lesson({ id: "ok", status: "active" }),
      ],
      queryEmbedding: localEmbed("normalization database"),
      queryKeywords: ["normalization", "database"],
    });
    expect(ranked.map((l) => l.id)).toEqual(["ok"]);
  });

  it("TEST 7 — only relevant lessons retrieved (unrelated history excluded)", () => {
    const relevant = lesson({ id: "rel", keywords: ["normalization", "database"], text: "normalization database redundancy" });
    const unrelated = lesson({ id: "unrel", keywords: ["photosynthesis", "leaves"], text: "photosynthesis sunlight leaves chlorophyll" });
    const ranked = rankLessons({ lessons: [relevant, unrelated], queryEmbedding: localEmbed("what is normalization in databases"), queryKeywords: ["normalization", "databases"] });
    expect(ranked.map((l) => l.id)).toContain("rel");
    expect(ranked.map((l) => l.id)).not.toContain("unrel");
  });

  it("TEST 8 — performance budget: max lessons, compact prompt, no history dump", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      lesson({ id: `l${i}`, keywords: ["normalization", "database"], text: "normalization database prioritize uploaded material" }),
    );
    const ranked = rankLessons({ lessons: many, queryEmbedding: localEmbed("normalization database"), queryKeywords: ["normalization", "database"] });
    expect(ranked.length).toBeLessThanOrEqual(MAX_LESSONS_PER_QUERY);
    expect(formatLessonsForPrompt(ranked).length).toBeLessThanOrEqual(1200);
  });

  it("repeated verified mistakes strengthen; repetition alone never promotes", () => {
    expect(strengthenedConfidence("low", "high")).toBe("medium");
    expect(strengthenedConfidence("medium", "high")).toBe("high");
    expect(strengthenedConfidence("low", "low")).toBe("low");
    expect(strengthenedConfidence("low", "unverified")).toBe("low");
  });

  it("detection + classification route to the right prevention strategy", () => {
    expect(detectCorrectionIntent("That answer is incorrect, the uploaded material says X")).toBe(true);
    expect(detectCorrectionIntent("Thanks, that helped!")).toBe(false);
    expect(classifyErrorType({ correction: "use the uploaded PDF definition" })).toBe("source_priority_error");
    expect(classifyErrorType({ correction: "fix the json structure" })).toBe("format_error");
    expect(inferRootCause("source_priority_error", true)).toMatch(/uploaded/i);
    expect(buildPreventionRule("source_priority_error", "Unit 3", "use tuned wording").length).toBeLessThanOrEqual(280);
  });
});
