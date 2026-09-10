/* Shared Tuning dashboard state — fetched server-side for first paint,
   re-fetched client-side while jobs run (each fetch also nudges the
   background pump). */
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { knowledgeBases, knowledgeDocuments, subjects, tuningErrorLessons, tuningPrefs } from "@/lib/db/schema";
import { getEmbeddingsConfig } from "@/lib/ai/provider";
import { parseProfile } from "./patterns";

export type LearnedImprovement = {
  id: string;
  kbId: string | null;
  topic: string | null;
  errorType: string;
  preventionRule: string;
  confidence: string;
  status: string;
  occurrenceCount: number;
};

export type TuningDashboardState = {
  bases: {
    id: string;
    name: string;
    subjectId: string | null;
    status: string;
    docCount: number;
    readyDocCount: number;
    conceptCount: number;
    embeddingSource: string;
    lastProcessedAt: string | null;
    profile: ReturnType<typeof parseProfile>;
    docs: {
      id: string;
      kbId: string;
      fileName: string;
      sizeBytes: number;
      charCount: number;
      chunkCount: number;
      status: "uploaded" | "queued" | "reading" | "chunking" | "indexing" | "patterns" | "ready" | "failed";
      progress: number;
      error: string | null;
      createdAt: string | null;
    }[];
  }[];
  subjects: { id: string; name: string }[];
  detailLevel: "short" | "medium" | "detailed";
  embeddingAvailable: boolean;
  /** §18 — suggested-stage learned preferences (visible + resettable). */
  learned: { visual: string | null; detail: string | null };
  /** Dynamic Error Learning — active prevention rules for the "Learned Improvements" section. */
  improvements: LearnedImprovement[];
};

export async function fetchTuningState(userId: string): Promise<TuningDashboardState> {
  const bases = await db
    .select()
    .from(knowledgeBases)
    .where(eq(knowledgeBases.userId, userId))
    .orderBy(desc(knowledgeBases.updatedAt))
    .all();
  const docs = await db
    .select({
      id: knowledgeDocuments.id,
      kbId: knowledgeDocuments.kbId,
      fileName: knowledgeDocuments.fileName,
      sizeBytes: knowledgeDocuments.sizeBytes,
      charCount: knowledgeDocuments.charCount,
      chunkCount: knowledgeDocuments.chunkCount,
      status: knowledgeDocuments.status,
      progress: knowledgeDocuments.progress,
      error: knowledgeDocuments.error,
      createdAt: knowledgeDocuments.createdAt,
    })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.userId, userId))
    .orderBy(desc(knowledgeDocuments.createdAt))
    .limit(200)
    .all();
  const subjectRows = await db
    .select({ id: subjects.id, name: subjects.name })
    .from(subjects)
    .where(eq(subjects.userId, userId))
    .orderBy(subjects.name)
    .all();
  const prefs = (await db.select().from(tuningPrefs).where(eq(tuningPrefs.userId, userId)).limit(1).all())[0];
  const { parseSignals, preferredVisualFrom } = await import("./intelligence/profile");
  const { signalStage } = await import("./intelligence/types");
  const signals = parseSignals((prefs as { signalsJson?: string | null } | undefined)?.signalsJson ?? null);
  const learnedVisual = preferredVisualFrom(signals);
  let learnedDetail: string | null = null;
  {
    let best: { key: string; count: number } | null = null;
    for (const [key, count] of Object.entries(signals.detailRequests)) {
      if (signalStage(count) === "suggested" && (!best || count > best.count)) best = { key, count };
    }
    learnedDetail = best?.key ?? null;
  }
  let improvements: LearnedImprovement[] = [];
  try {
    improvements = await db
      .select({
        id: tuningErrorLessons.id,
        kbId: tuningErrorLessons.kbId,
        topic: tuningErrorLessons.topic,
        errorType: tuningErrorLessons.errorType,
        preventionRule: tuningErrorLessons.preventionRule,
        confidence: tuningErrorLessons.confidence,
        status: tuningErrorLessons.status,
        occurrenceCount: tuningErrorLessons.occurrenceCount,
      })
      .from(tuningErrorLessons)
      .where(eq(tuningErrorLessons.userId, userId))
      .orderBy(desc(tuningErrorLessons.updatedAt))
      .limit(30)
      .all();
  } catch {
    improvements = []; // brand-new DBs without the migration still render
  }
  return {
    bases: bases.map((b) => ({
      id: b.id,
      name: b.name,
      subjectId: b.subjectId,
      status: b.status,
      docCount: b.docCount,
      readyDocCount: b.readyDocCount,
      conceptCount: b.conceptCount,
      embeddingSource: b.embeddingSource,
      lastProcessedAt: b.lastProcessedAt,
      profile: parseProfile(b.profileJson),
      docs: docs.filter((d) => d.kbId === b.id),
    })),
    subjects: subjectRows,
    detailLevel: (prefs?.detailLevel ?? "medium") as TuningDashboardState["detailLevel"],
    embeddingAvailable: Boolean(getEmbeddingsConfig()),
    learned: { visual: learnedVisual, detail: learnedDetail },
    improvements,
  };
}
