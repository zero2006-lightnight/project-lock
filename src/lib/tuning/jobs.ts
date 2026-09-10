/* ──────────────────────────────────────────────────────────────
   Tuning background worker — DB-backed job queue, in-process pump.

   Upload returns immediately after validation + storing the file;
   this pump does the slow work (extract → clean → chunk → embed →
   profile) server-side, so the student can leave the page mid-run.

   Single-instance by design (same constraint as the SQLite deployment
   and the chat rate limiter): one pump runs at a time per process,
   jobs are claimed with a status CAS, retries use backoff, and every
   job carries an idempotency key. The Postgres phase moves this to a
   dedicated worker without changing the job contract.
   ────────────────────────────────────────────────────────────── */

import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { db, uid } from "@/lib/db";
import {
  knowledgeBases,
  knowledgeChunks,
  knowledgeDocuments,
  tuningJobs,
  type TuningDocStatus,
} from "@/lib/db/schema";
import { extractText } from "@/lib/services/extract";
import { buildTuningChunks } from "./chunk";
import { embedTexts, type EmbedSource } from "./embed";
import { analyzePatterns } from "./patterns";

export const MAX_TUNING_ATTEMPTS = 3;
const BACKOFF_MS = [0, 30_000, 120_000];
const EMBED_BATCH = 24;

/** Pure retry schedule — attempts beyond the table use the last backoff. */
export function backoffForAttempt(attempts: number): number {
  return BACKOFF_MS[Math.min(Math.max(0, attempts), BACKOFF_MS.length - 1)]!;
}

/** A job may retry while attempts remain (pure, unit-testable). */
export function jobMayRetry(attempts: number, max = MAX_TUNING_ATTEMPTS): boolean {
  return attempts < max;
}

let pumping = false;

function at(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/** Enqueue (or reuse) the processing job for a document. Idempotent. */
export async function enqueueDocumentJob(userId: string, docId: string): Promise<string> {
  const idemKey = `doc:${docId}`;
  const existing = await db
    .select({ id: tuningJobs.id, status: tuningJobs.status })
    .from(tuningJobs)
    .where(and(eq(tuningJobs.userId, userId), eq(tuningJobs.idemKey, idemKey)))
    .limit(1)
    .all();
  const open = existing.find((j) => j.status === "queued" || j.status === "running");
  if (open) return open.id;
  // A finished job row for the same doc blocks the unique key — clear it first.
  if (existing.length) {
    await db.delete(tuningJobs).where(and(eq(tuningJobs.userId, userId), eq(tuningJobs.idemKey, idemKey))).run();
  }
  const id = uid();
  const now = new Date().toISOString();
  await db.insert(tuningJobs).values({
    id,
    userId,
    type: "process_document",
    status: "queued",
    progress: 0,
    attempts: 0,
    maxAttempts: MAX_TUNING_ATTEMPTS,
    payloadJson: JSON.stringify({ docId }),
    idemKey,
    nextRunAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function setDoc(
  docId: string,
  patch: Partial<{ status: TuningDocStatus; progress: number; error: string | null; charCount: number; chunkCount: number; fullText: string | null }>,
) {
  await db
    .update(knowledgeDocuments)
    .set({ ...patch, error: patch.error ?? undefined, updatedAt: new Date().toISOString() })
    .where(eq(knowledgeDocuments.id, docId))
    .run();
}

async function setJob(id: string, patch: Partial<{ status: "running" | "done" | "failed" | "queued"; progress: number; error: string | null; nextRunAt: string | null; completedAt: string | null }>) {
  await db
    .update(tuningJobs)
    .set({ ...patch, error: patch.error ?? undefined, nextRunAt: patch.nextRunAt ?? undefined, updatedAt: new Date().toISOString() })
    .where(eq(tuningJobs.id, id))
    .run();
}

/** Claim the next due job with a compare-and-swap; null when none open. */
async function claimNext(userScope?: string) {
  const due = or(isNull(tuningJobs.nextRunAt), lte(tuningJobs.nextRunAt, new Date().toISOString()));
  const rows = await db
    .select()
    .from(tuningJobs)
    .where(userScope ? and(eq(tuningJobs.status, "queued"), eq(tuningJobs.userId, userScope), due) : and(eq(tuningJobs.status, "queued"), due))
    .orderBy(asc(tuningJobs.createdAt))
    .limit(1)
    .all();
  const job = rows[0];
  if (!job) return null;
  const claimed = await db
    .update(tuningJobs)
    .set({ status: "running", attempts: job.attempts + 1, updatedAt: new Date().toISOString() })
    .where(and(eq(tuningJobs.id, job.id), eq(tuningJobs.status, "queued")))
    .run();
  // better-sqlite3 sync run returns rowsAffected; 0 means someone else claimed it.
  if ((claimed as unknown as { rowsAffected?: number }).rowsAffected === 0) return null;
  return { ...job, attempts: job.attempts + 1 };
}

async function refreshKbCounts(kbId: string) {
  const docs = await db
    .select({ status: knowledgeDocuments.status })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.kbId, kbId))
    .all();
  const ready = docs.filter((d) => d.status === "ready").length;
  const processing = docs.some((d) => !["ready", "failed"].includes(d.status));
  const failedAll = docs.length > 0 && ready === 0 && !processing;
  await db
    .update(knowledgeBases)
    .set({
      docCount: docs.length,
      readyDocCount: ready,
      status: docs.length === 0 ? "empty" : ready === 0 && processing ? "processing" : ready === docs.length ? "ready" : failedAll ? "ready" : "partial",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(knowledgeBases.id, kbId))
    .run();
}

/** Incrementally rebuild the KB profile from all ready chunks. */
export async function rebuildKbProfile(kbId: string) {
  const kb = (await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId)).limit(1).all())[0];
  if (!kb) return;
  const chunks = await db
    .select({ docId: knowledgeChunks.docId, section: knowledgeChunks.section, content: knowledgeChunks.content })
    .from(knowledgeChunks)
    .where(eq(knowledgeChunks.kbId, kbId))
    .orderBy(asc(knowledgeChunks.ord))
    .limit(5000)
    .all();
  const profile = analyzePatterns(kb.name, chunks);
  await db
    .update(knowledgeBases)
    .set({
      profileJson: JSON.stringify(profile),
      conceptCount: profile.coreConcepts.length,
      lastProcessedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(knowledgeBases.id, kbId))
    .run();
  await refreshKbCounts(kbId);
}

async function failJob(jobId: string, docId: string | null, message: string, attempts: number) {
  const fatal = attempts >= MAX_TUNING_ATTEMPTS;
  if (docId) await setDoc(docId, { status: "failed", progress: 100, error: message.slice(0, 500) });
  await setJob(jobId, {
    status: fatal ? "failed" : "queued",
    error: message.slice(0, 500),
    nextRunAt: fatal ? null : at(BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]!),
  });
  if (docId) {
    const doc = (await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, docId)).limit(1).all())[0];
    if (doc) await refreshKbCounts(doc.kbId);
  }
}

/** Run one claimed job through the real pipeline. */
async function runJob(job: { id: string; userId: string; payloadJson: string; attempts: number }) {
  let docId: string | null = null;
  try {
    const payload = JSON.parse(job.payloadJson) as { docId?: string };
    docId = payload.docId ?? null;
    if (!docId) throw new Error("Job payload missing document.");
    const doc = (await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, docId)).limit(1).all())[0];
    // Doc deleted mid-flight: finish the job, nothing to do.
    if (!doc || doc.userId !== job.userId) {
      await setJob(job.id, { status: "done", progress: 100, completedAt: new Date().toISOString() });
      return;
    }
    // Duplicate-delivery guard: already finished work is not redone.
    if (doc.status === "ready") {
      await setJob(job.id, { status: "done", progress: 100, completedAt: new Date().toISOString() });
      return;
    }
    if (!doc.rawBlob?.length) throw new Error("Upload bytes missing — please re-upload this PDF.");

    await setJob(job.id, { progress: 8 });
    await setDoc(docId, { status: "reading", progress: 10, error: null });
    const text = await extractText("pdf", doc.fileName, Buffer.from(doc.rawBlob));
    if (!text.trim()) {
      throw new Error(
        "No selectable text found — this looks like a scanned PDF. Upload a text-based PDF (OCR support is on the roadmap).",
      );
    }

    await setJob(job.id, { progress: 35 });
    await setDoc(docId, { status: "chunking", progress: 35 });
    const built = buildTuningChunks(text);
    if (!built.length) throw new Error("The document has too little readable text to index.");

    await setJob(job.id, { progress: 55 });
    await setDoc(docId, { status: "indexing", progress: 55 });
    // Replace any previous index for this doc (retry-safe, idempotent).
    await db.delete(knowledgeChunks).where(eq(knowledgeChunks.docId, docId)).run();
    const kb = (await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, doc.kbId)).limit(1).all())[0];
    // Never mix embedding sources inside one KB: once a KB has ready
    // docs, newcomers use the KB's stored source. Local is always
    // available; if a provider-backed KB loses its embeddings endpoint
    // the job retries later instead of poisoning the index.
    const { localEmbed } = await import("./embed");
    const kbSource: EmbedSource | "auto" = kb && kb.readyDocCount > 0 ? (kb.embeddingSource as EmbedSource) : "auto";
    let source: EmbedSource = "local";
    const vectors: number[][] = [];
    for (let i = 0; i < built.length; i += EMBED_BATCH) {
      const batch = built.slice(i, i + EMBED_BATCH).map((b) => `${b.section ?? ""}\n${b.content}`.slice(0, 2000));
      if (kbSource === "local") {
        if (i === 0) source = "local";
        for (const t of batch) vectors.push(localEmbed(t));
      } else {
        const r = await embedTexts(batch);
        if (kbSource === "provider" && r.source !== "provider") {
          throw new Error("Embeddings service unreachable — the document stays queued and will retry automatically.");
        }
        if (i === 0) source = r.source;
        vectors.push(...r.vectors);
      }
    }
    const now = new Date().toISOString();
    for (let i = 0; i < built.length; i++) {
      await db.insert(knowledgeChunks).values({
        id: uid(),
        docId,
        kbId: doc.kbId,
        userId: job.userId,
        subjectId: kb?.subjectId ?? null,
        ord: i,
        section: built[i]!.section,
        content: built[i]!.content,
        embedding: JSON.stringify(vectors[i] ?? []),
        createdAt: now,
      });
    }

    await setJob(job.id, { progress: 80 });
    await setDoc(docId, {
      status: "patterns",
      progress: 82,
      charCount: text.length,
      chunkCount: built.length,
      fullText: text.slice(0, 60_000),
    });
    if (kb && kb.embeddingSource !== source && kb.readyDocCount === 0) {
      await db.update(knowledgeBases).set({ embeddingSource: source }).where(eq(knowledgeBases.id, kb.id)).run();
    }

    // Free the raw bytes — the index + excerpt now carry the knowledge.
    await db
      .update(knowledgeDocuments)
      .set({ rawBlob: null, updatedAt: new Date().toISOString() })
      .where(eq(knowledgeDocuments.id, docId))
      .run();

    // Mark ready BEFORE rebuilding the profile so KB counts include this doc.
    await setDoc(docId, { status: "ready", progress: 100, error: null });
    await rebuildKbProfile(doc.kbId);
    await setJob(job.id, { status: "done", progress: 100, completedAt: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processing failed.";
    await failJob(job.id, docId, message, job.attempts);
  }
}

/** Pump due jobs until the queue is empty. Re-entrant safe. */
export async function pumpTuningJobs(): Promise<{ processed: number }> {
  if (pumping) return { processed: 0 };
  pumping = true;
  let processed = 0;
  try {
    for (let i = 0; i < 25; i++) {
      const job = await claimNext();
      if (!job) break;
      processed++;
      await runJob(job);
    }
  } finally {
    pumping = false;
  }
  return { processed };
}
