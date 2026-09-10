"use server";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, uid } from "@/lib/db";
import {
  knowledgeBases,
  knowledgeDocuments,
  subjects,
  tuningJobs,
  tuningPrefs,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/actions";
import { rateLimit } from "@/lib/security/rate-limit";
import { sanitizeUserText, wrapUntrusted, UNTRUSTED_DIRECTIVE } from "@/lib/security/guard";
import { verifyUpload } from "@/lib/security/uploads";
import { logSecurityEvent } from "@/lib/security/events";
import { enqueueDocumentJob, pumpTuningJobs, rebuildKbProfile } from "@/lib/tuning/jobs";
import { parseProfile } from "@/lib/tuning/patterns";
import { fetchTuningState } from "@/lib/tuning/state";
import {
  composeTuningAnswer,
  getTuningPersonalization,
  retrieveTuningChunks,
} from "@/lib/tuning/retrieve";
import { decideAfterRetrieval, decideBeforeRetrieval } from "@/lib/tuning/intelligence/pipeline";
import { buildSubjectMap, renderSubjectMap } from "@/lib/tuning/intelligence/subject-map";
import { buildContext, dedupeAndRank, renderContextBlock } from "@/lib/tuning/intelligence/context-builder";
import { buildLearningProfile, parseSignals, personalNoteFor, recordInteraction } from "@/lib/tuning/intelligence/profile";
import { validateResponse } from "@/lib/tuning/intelligence/validator";
import type { QueryLabel } from "@/lib/tuning/intelligence/types";
import { getAiProvider } from "@/lib/ai/provider";
import {
  buildPreventionRule,
  classifyErrorType,
  detectCorrectionIntent,
  formatLessonsForPrompt,
  inferRootCause,
  retrieveRelevantLessons,
  saveOrUpdateLesson,
  verifyCorrection,
  type RankedLesson,
} from "@/lib/tuning/error-lessons";
import { keywordTermsOf } from "@/lib/tuning/query";
import {
  errorLessonStatuses,
  tuningErrorLessons,
  type ErrorLessonStatus,
} from "@/lib/db/schema";

const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 10;

async function ownKb(userId: string, kbId: string) {
  const rows = await db
    .select()
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.userId, userId)))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

/** Dashboard state. Poll this while jobs run — each poll also nudges the pump. */
export async function getTuningStateAction() {
  const user = await requireUser();
  void pumpTuningJobs();
  return fetchTuningState(user.id);
}

const CreateKbSchema = z.object({
  name: z.string().trim().min(1).max(80),
  subjectId: z.string().min(1).max(64).optional(),
});

export async function createKnowledgeBaseAction(input: { name: string; subjectId?: string }) {
  const user = await requireUser();
  const parsed = CreateKbSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Give the knowledge base a name (up to 80 characters)." };
  let subjectId: string | null = null;
  if (parsed.data.subjectId) {
    const own = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.id, parsed.data.subjectId), eq(subjects.userId, user.id)))
      .limit(1)
      .all();
    if (!own.length) return { ok: false as const, error: "Subject not found." };
    subjectId = parsed.data.subjectId;
  }
  const id = uid();
  const now = new Date().toISOString();
  await db.insert(knowledgeBases).values({
    id,
    userId: user.id,
    subjectId,
    name: parsed.data.name,
    status: "empty",
    createdAt: now,
    updatedAt: now,
  });
  revalidatePath("/app/tuning");
  return { ok: true as const, id };
}

export async function deleteKnowledgeBaseAction(kbId: string) {
  const user = await requireUser();
  const kb = await ownKb(user.id, kbId);
  if (!kb) return { ok: false as const, error: "Knowledge base not found." };
  const docs = await db
    .select({ id: knowledgeDocuments.id })
    .from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.kbId, kbId), eq(knowledgeDocuments.userId, user.id)))
    .all();
  for (const d of docs) {
    await db.delete(tuningJobs).where(and(eq(tuningJobs.userId, user.id), eq(tuningJobs.idemKey, `doc:${d.id}`))).run();
  }
  await db.delete(knowledgeBases).where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.userId, user.id))).run();
  revalidatePath("/app/tuning");
  return { ok: true as const };
}

export type TuningUploadResult = {
  ok: boolean;
  accepted: { id: string; fileName: string }[];
  skipped: { fileName: string; reason: string }[];
  error?: string;
};

export async function uploadTuningPdfsAction(input: {
  kbId: string;
  files: { fileName: string; mimeType: string; sizeBytes: number; dataBase64: string }[];
}): Promise<TuningUploadResult> {
  const user = await requireUser();
  const kb = await ownKb(user.id, input.kbId);
  if (!kb) return { ok: false, accepted: [], skipped: [], error: "Knowledge base not found." };
  if (!input.files.length) return { ok: false, accepted: [], skipped: [], error: "No files received." };
  if (input.files.length > MAX_FILES_PER_REQUEST) {
    return { ok: false, accepted: [], skipped: [], error: `Upload up to ${MAX_FILES_PER_REQUEST} PDFs at a time.` };
  }
  const accepted: TuningUploadResult["accepted"] = [];
  const skipped: TuningUploadResult["skipped"] = [];
  for (const f of input.files.slice(0, MAX_FILES_PER_REQUEST)) {
    const name = f.fileName.slice(0, 200);
    const buffer = Buffer.from(f.dataBase64, "base64");
    if (!buffer.length) {
      skipped.push({ fileName: name, reason: "Empty file." });
      continue;
    }
    if (buffer.length > MAX_PDF_BYTES || f.sizeBytes > MAX_PDF_BYTES) {
        skipped.push({ fileName: name, reason: "Over the 100 MB limit." });
      continue;
    }
    // Content check: only genuine PDFs reach the queue — renamed
    // executables and mismatched files are refused with a safe reason.
    const verified = verifyUpload(name, f.mimeType, buffer);
    if (!verified.ok || verified.kind !== "pdf") {
      if (!verified.ok) {
        logSecurityEvent({ type: "upload_rejected", userId: user.id, detail: `tuning:${name.slice(0, 80)}: ${verified.error}` });
      }
      skipped.push({
        fileName: name,
        reason: !verified.ok ? verified.error : "Tuning accepts text PDFs (other formats stay in Syllabus materials).",
      });
      continue;
    }
    const dedupeKey = `${name.toLowerCase()}::${buffer.length}`;
    const dup = await db
      .select({ id: knowledgeDocuments.id })
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.userId, user.id),
          eq(knowledgeDocuments.kbId, kb.id),
          eq(knowledgeDocuments.dedupeKey, dedupeKey),
        ),
      )
      .limit(1)
      .all();
    if (dup.length) {
      skipped.push({ fileName: name, reason: "Already in this knowledge base." });
      continue;
    }
    const id = uid();
    const now = new Date().toISOString();
    try {
      await db.insert(knowledgeDocuments).values({
        id,
        kbId: kb.id,
        userId: user.id,
        fileName: name,
        mimeType: "application/pdf",
        sizeBytes: buffer.length,
        status: "queued",
        progress: 2,
        dedupeKey,
        rawBlob: buffer,
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      skipped.push({ fileName: name, reason: "Already in this knowledge base." });
      continue;
    }
    await enqueueDocumentJob(user.id, id);
    accepted.push({ id, fileName: name });
  }
  await db
    .update(knowledgeBases)
    .set({ status: "processing", updatedAt: new Date().toISOString() })
    .where(eq(knowledgeBases.id, kb.id))
    .run();
  // Hand off to the background pump — the response returns now, work continues server-side.
  void pumpTuningJobs();
  revalidatePath("/app/tuning");
  return { ok: accepted.length > 0, accepted, skipped };
}

export async function retryTuningDocAction(docId: string) {
  const user = await requireUser();
  const doc = (
    await db
      .select()
      .from(knowledgeDocuments)
      .where(and(eq(knowledgeDocuments.id, docId), eq(knowledgeDocuments.userId, user.id)))
      .limit(1)
      .all()
  )[0];
  if (!doc) return { ok: false as const, error: "Document not found." };
  if (!doc.rawBlob?.length) {
    return { ok: false as const, error: "The stored file is gone — please upload this PDF again." };
  }
  await db.delete(tuningJobs).where(and(eq(tuningJobs.userId, user.id), eq(tuningJobs.idemKey, `doc:${doc.id}`))).run();
  await db
    .update(knowledgeDocuments)
    .set({ status: "queued", progress: 2, error: null, updatedAt: new Date().toISOString() })
    .where(eq(knowledgeDocuments.id, doc.id))
    .run();
  await enqueueDocumentJob(user.id, doc.id);
  void pumpTuningJobs();
  revalidatePath("/app/tuning");
  return { ok: true as const };
}

export async function deleteTuningDocAction(docId: string) {
  const user = await requireUser();
  const doc = (
    await db
      .select()
      .from(knowledgeDocuments)
      .where(and(eq(knowledgeDocuments.id, docId), eq(knowledgeDocuments.userId, user.id)))
      .limit(1)
      .all()
  )[0];
  if (!doc) return { ok: false as const, error: "Document not found." };
  await db.delete(tuningJobs).where(and(eq(tuningJobs.userId, user.id), eq(tuningJobs.idemKey, `doc:${doc.id}`))).run();
  await db.delete(knowledgeDocuments).where(and(eq(knowledgeDocuments.id, doc.id), eq(knowledgeDocuments.userId, user.id))).run();
  await rebuildKbProfile(doc.kbId);
  revalidatePath("/app/tuning");
  return { ok: true as const };
}

const ASK_LIMIT = { limit: 10, windowMs: 5 * 60 * 1000 };

/**
 * Map the intelligence decision onto the legacy composer plan.
 * Strategy-aware but behavior-preserving: the deterministic composer
 * keeps its grounded quote-first rendering; the strategy picks which
 * rendering branch fits best.
 */
function toLegacyPlan(
  labels: QueryLabel[],
  visual: "none" | "flowchart" | "concept_map" | "table" | "graph" | "image",
  complexity: "short" | "medium" | "detailed",
  keywords: string[],
): Parameters<typeof composeTuningAnswer>[0]["plan"] {
  const has = (...ls: QueryLabel[]) => ls.some((l) => labels.includes(l));
  let type: Parameters<typeof composeTuningAnswer>[0]["plan"]["type"] = "explanation";
  if (has("flowchart")) type = "explanation"; // visual branch via `visual` below
  else if (has("comparison")) type = "comparison";
  else if (has("revision", "summary")) type = has("revision") ? "revision" : "summary";
  else if (has("definition")) type = "definition";
  else if (has("graph")) type = "explanation";
  const legacyVisual = visual === "image" ? "concept_map" : visual;
  return { type, complexity, visual: legacyVisual, wantsVisual: visual !== "none", keywordTerms: keywords };
}

/** §18 — reset learned preference signals (counts only; explicit prefs untouched). */
export async function resetTuningSignalsAction() {
  const user = await requireUser();
  const existing = await db.select().from(tuningPrefs).where(eq(tuningPrefs.userId, user.id)).limit(1).all();
  const empty = JSON.stringify({
    visualRequests: {},
    detailRequests: {},
    styleRequests: {},
    updatedAt: new Date().toISOString(),
  });
  if (existing.length) {
    await db.update(tuningPrefs).set({ signalsJson: empty, updatedAt: new Date().toISOString() }).where(eq(tuningPrefs.userId, user.id)).run();
  } else {
    await db.insert(tuningPrefs).values({ userId: user.id, detailLevel: "medium", signalsJson: empty, updatedAt: new Date().toISOString() });
  }
  revalidatePath("/app/tuning");
  return { ok: true as const };
}

export async function askTuningAction(input: { kbId?: string | null; query: string }) {
  const user = await requireUser();
  const parsed = z.string().trim().min(1).max(1000).safeParse(input.query ?? "");
  if (!parsed.success) return { ok: false as const, error: "Ask something first — a concept, a comparison, or a process." };
  const rl = rateLimit(`tuning:${user.id}`, ASK_LIMIT);
  if (!rl.allowed) {
    const secs = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
    return { ok: false as const, error: `Easy — Tuning answers are rate-limited. Try again in ${secs}s.` };
  }
  const clean = sanitizeUserText(parsed.data);

  const bases = await db
    .select({ id: knowledgeBases.id, name: knowledgeBases.name })
    .from(knowledgeBases)
    .where(eq(knowledgeBases.userId, user.id))
    .all();
  if (!bases.length) {
    return { ok: false as const, error: "Create a knowledge base and upload a PDF first — then Tuning can answer from your materials." };
  }
  // Explicit KB choice: ownership-checked, never overridden downstream.
  let explicitKbId: string | null = null;
  if (input.kbId) {
    const kb = await ownKb(user.id, input.kbId);
    if (!kb) return { ok: false as const, error: "Knowledge base not found." };
    explicitKbId = kb.id;
  }

  const me = await getTuningPersonalization(user.id);
  const prefRow = (await db.select().from(tuningPrefs).where(eq(tuningPrefs.userId, user.id)).limit(1).all())[0];
  const signals = parseSignals(prefRow?.signalsJson ?? null);

  // ── §14 pipeline, stages 1–5: decide BEFORE retrieval ──
  const pre = decideBeforeRetrieval({
    question: clean,
    detection: { explicitKbId, workspaceKbId: null, recentQueries: [], bases },
    weakTopics: me.weakAreas.map((w) => w.topic.toLowerCase()),
    detailPref: me.detailLevel,
    imageAvailable: getAiProvider().available(),
    hasRealData: me.weekMinutes > 0,
  });

  let kbId: string | null = pre.subject.kbId;
  if (!kbId) {
    // Fallback (openly the most-recent ready base — never claimed as detection).
    const withDocs = await db
      .select({ id: knowledgeBases.id, ready: knowledgeBases.readyDocCount, updated: knowledgeBases.updatedAt })
      .from(knowledgeBases)
      .where(eq(knowledgeBases.userId, user.id))
      .orderBy(desc(knowledgeBases.updatedAt))
      .limit(10)
      .all();
    kbId = withDocs.find((b) => (b.ready ?? 0) > 0)?.id ?? withDocs[0]?.id ?? bases[0]!.id;
  }

  const { chunks: rawChunks, scope } = await retrieveTuningChunks(user.id, kbId, clean, 6);
  const kbRow = (await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId!)).limit(1).all())[0];
  const profile = parseProfile(kbRow?.profileJson ?? null);

  // ── Layer 1 (subject map) + Layer 2 (learning profile) ──
  const mapText = profile.topicTree.length ? renderSubjectMap(buildSubjectMap(profile)) : null;
  const learningProfile = buildLearningProfile({ me, signals });

  // ── §14 stages 6–7: strategy, now that knowledge availability is known ──
  const decision = decideAfterRetrieval(pre, rawChunks.length > 0);
  const scoped = dedupeAndRank(rawChunks, kbId);
  // ── Dynamic Error Learning: retrieve only relevant verified lessons
  // (user + KB scoped, max 3, never throws — failure falls back to plain tuning).
  let lessons: RankedLesson[] = [];
  let lessonBlock = "";
  try {
    lessons = await retrieveRelevantLessons({ userId: user.id, kbId, query: clean, chunks: scoped });
    lessonBlock = formatLessonsForPrompt(lessons);
  } catch {
    lessons = [];
    lessonBlock = "";
  }
  const pack = buildContext({
    userId: user.id,
    question: clean,
    chunks: scoped,
    scopedKbId: kbId,
    subjectSummary: profile.summary,
    subjectMapText: mapText,
    personalNote: decision.needsPersonalization ? personalNoteFor(pre.keywords, learningProfile) : null,
  });

  // Legacy composer plan: strategy-aware mapping, behavior-preserving.
  const plan = toLegacyPlan(decision.labels, decision.visual, decision.complexity, pre.keywords);
  const base = await composeTuningAnswer({
    query: clean,
    plan,
    chunks: scoped,
    profile,
    scope: { ...scope, kbName: kbRow?.name ?? scope.kbName },
    me,
    userName: user.name,
    userId: user.id,
  });

  // §15: validate the deterministic answer; thin coverage stays honest.
  const validation = validateResponse({
    decision,
    pack,
    answer: { markdown: base.markdown, mermaid: base.mermaid },
    sourcesClaimed: base.sourcesUsed,
  });
  if (!pack.thinCoverage && !validation.ok && validation.issues.includes("visual_mismatch")) {
    // Non-destructive: the visual simply didn't materialize — say so
    // instead of shipping a section that promises a missing diagram.
    base.markdown += "\n\n_I planned a visual for this, but your documents don't carry the structure for one — the explanation above is complete without it._";
  }

  // §17/§18: record this interaction's signals (counts only — one
  // interaction never locks a preference).
  const styles: string[] = [];
  if (pre.labels.includes("example")) styles.push("example");
  if (decision.intent === "exam_prep") styles.push("exam");
  if (pre.labels.includes("step_by_step") || pre.labels.includes("problem_solving")) styles.push("steps");
  const nextSignals = recordInteraction(signals, {
    visual: decision.visual,
    complexity: decision.complexity,
    styles,
  });
  const signalsJson = JSON.stringify(nextSignals);
  if (prefRow) {
    await db.update(tuningPrefs).set({ signalsJson, updatedAt: new Date().toISOString() }).where(eq(tuningPrefs.userId, user.id)).run();
  } else {
    await db.insert(tuningPrefs).values({ userId: user.id, detailLevel: me.detailLevel, signalsJson, updatedAt: new Date().toISOString() });
  }

  // LLM polish: budgeted context + strategy-aware instruction — deterministic answer stands on any failure.
  let llm = false;
  const provider = getAiProvider();
  if (provider.available() && base.tunedCoverage) {
    try {
      const context = renderContextBlock(pack, mapText);
      const strategyLine: Record<string, string> = {
        quick_answer: "Quick answer: answer + one short example. Keep it tight.",
        learning_explanation: "Learning explanation: definition → concept → example → key points.",
        step_by_step: "Step-by-step: problem → numbered steps → result.",
        visual_explanation: "Visual explanation: concise prose that the attached structured diagram complements (do not duplicate the diagram in words).",
        exam_mode: "Exam mode: answer → key points → important terms → common mistakes → one exam tip.",
        comparison: "Comparison: concept A vs concept B with a markdown comparison table + examples.",
      };
      const system = [
        "You are Pilot, the StudyPilot tutor, answering from the student's TUNED materials below.",
        "Rules: prefer the tuned passages over your own knowledge; quote briefly; never invent definitions the passages don't support;",
        "if the passages are thin, say what is missing instead of filling gaps silently.",
        "Priority: current tuned passages outrank older learned lessons on any conflict — follow the passages.",
        `Response strategy: ${strategyLine[decision.strategy] ?? decision.strategy} (question intent: ${decision.intent}, depth: ${decision.complexity}). Use short markdown with **bold** key terms.`,
        decision.needsPersonalization && pack.personalNote ? `Relevant learning context: ${pack.personalNote}` : "",
        lessonBlock ? `${lessonBlock}` : "",
        UNTRUSTED_DIRECTIVE,
        `Tuned context (ranked, deduplicated, scoped to this subject):\n${context}`,
      ].join("\n\n");
      const text = await provider.complete(system, wrapUntrusted(clean), { temperature: 0.4, maxTokens: 900 });
      if (text.trim()) {
        llm = true;
        const lessonNote = lessons.length ? ` · ${lessons.length} learned improvement${lessons.length === 1 ? "" : "s"} applied` : "";
        const note = `\n\n_Answering from your tuned ${kbRow?.name ?? "materials"} (${scoped.length} passages)${scope.source === "provider" ? " · provider embeddings" : " · on-device index"}${lessonNote}._`;
        return {
          ok: true as const,
          markdown: `${text.trim().slice(0, 5000)}${note}`,
          mermaid: base.mermaid,
          conceptMap: base.conceptMap,
          activityGraph: base.activityGraph,
          tunedCoverage: true,
          sourcesUsed: base.sourcesUsed,
          kbName: kbRow?.name ?? null,
          kbId,
          llm,
          lessonsApplied: lessons.length,
        };
      }
    } catch {
      /* deterministic answer below */
    }
  }

  // On-device path also applies verified lessons (short, honest, non-overriding).
  if (base.tunedCoverage && lessons.length) {
    const first = lessons[0]!;
    base.markdown += `\n\n_Applied learned improvement: ${first.preventionRule.slice(0, 200)}_`;
  }
  const note = base.tunedCoverage
    ? `\n\n_Answering from your tuned ${kbRow?.name ?? "materials"} (${scoped.length} passages, on-device index). No AI provider connected — connect one in Settings for richer prose._`
    : "";
  return {
    ok: true as const,
    markdown: `${base.markdown}${note}`,
    mermaid: base.mermaid,
    conceptMap: base.conceptMap,
    activityGraph: base.activityGraph,
    tunedCoverage: base.tunedCoverage,
    sourcesUsed: base.sourcesUsed,
    kbName: kbRow?.name ?? null,
    kbId,
    llm,
    lessonsApplied: lessons.length,
  };
}

export async function setTuningPrefsAction(input: { detailLevel: "short" | "medium" | "detailed" }) {
  const user = await requireUser();
  const parsed = z.enum(["short", "medium", "detailed"]).safeParse(input.detailLevel);
  if (!parsed.success) return { ok: false as const, error: "Unknown detail level." };
  const existing = await db.select().from(tuningPrefs).where(eq(tuningPrefs.userId, user.id)).limit(1).all();
  if (existing.length) {
    await db.update(tuningPrefs).set({ detailLevel: parsed.data, updatedAt: new Date().toISOString() }).where(eq(tuningPrefs.userId, user.id)).run();
  } else {
    await db.insert(tuningPrefs).values({ userId: user.id, detailLevel: parsed.data, updatedAt: new Date().toISOString() });
  }
  revalidatePath("/app/tuning");
  return { ok: true as const };
}

/** Illustrative image via the provider abstraction — honest when unavailable. */
export async function generateTuningImageAction(input: { prompt: string; kbId?: string | null }) {
  const user = await requireUser();
  const parsed = z.string().trim().min(3).max(300).safeParse(input.prompt ?? "");
  if (!parsed.success) return { ok: false as const, error: "Describe the illustration in a few words first." };
  const rl = rateLimit(`tuning-img:${user.id}`, { limit: 5, windowMs: 10 * 60 * 1000 });
  if (!rl.allowed) return { ok: false as const, error: "Image generation is rate-limited — try again in a few minutes." };
  const provider = getAiProvider();
  if (typeof provider.generateImage !== "function" || !provider.available()) {
    return {
      ok: false as const,
      error: "Image generation needs an AI provider with image support (Settings → AI). Flowcharts and concept maps below work without one.",
    };
  }
  try {
    const url = await provider.generateImage(`Educational diagram, clean textbook style: ${sanitizeUserText(parsed.data)}`);
    return { ok: true as const, url };
  } catch (err) {
    return { ok: false as const, error: `Image generation failed: ${err instanceof Error ? err.message.slice(0, 200) : "provider error"}` };
  }
}

/* ──────────────────────────────────────────────────────────────
   Dynamic Error Learning — feedback + lesson management.
   All rows stay scoped to the calling user; KB ownership is checked.
   Storage failure never blocks the current interaction.
   ────────────────────────────────────────────────────────────── */

const FEEDBACK_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 };

const FeedbackSchema = z.object({
  kbId: z.string().min(1).max(64).nullable().optional(),
  query: z.string().trim().min(1).max(1000),
  answer: z.string().trim().min(1).max(4000).optional(),
  rating: z.enum(["correct", "needs_correction"]),
  correction: z.string().trim().max(1000).optional(),
  technicalSignal: z.string().trim().max(300).optional(),
});

/**
 * Lightweight ✓ / ⚠ feedback. "correct" is a no-op acknowledgement;
 * "needs_correction" runs DETECT → VERIFY → EXTRACT → DEDUPE → STORE.
 * Unverified claims are kept as under_review (never steer answers).
 */
export async function submitTuningFeedbackAction(input: z.infer<typeof FeedbackSchema>) {
  const user = await requireUser();
  const parsed = FeedbackSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Feedback needs the original question." };
  const rl = rateLimit(`tuning-feedback:${user.id}`, FEEDBACK_LIMIT);
  if (!rl.allowed) return { ok: false as const, error: "Feedback is rate-limited — try again in a few minutes." };
  if (parsed.data.rating === "correct") return { ok: true as const, learned: false as const };

  const correction = sanitizeUserText(parsed.data.correction ?? "", 1000);
  const query = sanitizeUserText(parsed.data.query, 1000);
  if (!correction && !detectCorrectionIntent(query)) {
    return { ok: false as const, error: "Tell me what should be corrected — e.g. what the uploaded material says." };
  }
  const correctionText = correction || query;

  let kbId: string | null = null;
  let subjectId: string | null = null;
  if (parsed.data.kbId) {
    const kb = await ownKb(user.id, parsed.data.kbId);
    if (!kb) return { ok: false as const, error: "Knowledge base not found." };
    kbId = kb.id;
    subjectId = kb.subjectId;
  }

  try {
    const errorType = classifyErrorType({ query, correction: correctionText, technicalSignal: parsed.data.technicalSignal });
    // Verify against currently retrievable tuned evidence (deterministic, no extra AI call).
    const { chunks } = await retrieveTuningChunks(user.id, kbId, `${query} ${correctionText}`.slice(0, 1000), 6);
    const { confidence, evidence } = verifyCorrection({ correction: correctionText, chunks, errorType });
    const topic = keywordTermsOf(query.toLowerCase()).slice(0, 3).join(" ") || null;
    const mistakeSummary = `For "${query.slice(0, 160)}" the answer missed: ${correctionText.slice(0, 200)}`;
    const rootCause = inferRootCause(errorType, chunks.length > 0);
    const preventionRule = buildPreventionRule(errorType, topic ?? "", correctionText);
    const keywords = keywordTermsOf(`${query} ${correctionText}`.toLowerCase());

    if (confidence === "unverified") {
      // Preserve the signal for review but never let it steer answers.
      const { lesson } = await saveOrUpdateLesson(user.id, {
        kbId,
        subjectId,
        topic,
        errorType,
        mistakeSummary,
        rootCause,
        correctApproach: correctionText.slice(0, 500),
        preventionRule,
        evidence,
        origin: parsed.data.technicalSignal ? "technical" : "feedback",
        confidence,
        keywords,
      });
      await db
        .update(tuningErrorLessons)
        .set({ status: "under_review" as ErrorLessonStatus, updatedAt: new Date().toISOString() })
        .where(and(eq(tuningErrorLessons.id, lesson.id), eq(tuningErrorLessons.userId, user.id)))
        .run();
      return { ok: true as const, learned: false as const, confidence, reason: "Not verified against your tuned material yet — kept for review, not applied." };
    }

    const { updated } = await saveOrUpdateLesson(user.id, {
      kbId,
      subjectId,
      topic,
      errorType,
      mistakeSummary,
      rootCause,
      correctApproach: correctionText.slice(0, 500),
      preventionRule,
      evidence,
      origin: parsed.data.technicalSignal ? "technical" : "feedback",
      confidence,
      keywords,
    });
    return { ok: true as const, learned: true as const, confidence, updated };
  } catch (err) {
    // Lesson storage must never break the chat interaction.
    return { ok: false as const, error: `Could not store that correction: ${err instanceof Error ? err.message.slice(0, 160) : "storage error"}` };
  }
}

export async function listErrorLessonsAction(kbId?: string | null) {
  const user = await requireUser();
  let kb: string | null = null;
  if (kbId) {
    const owned = await ownKb(user.id, kbId);
    if (!owned) return { ok: false as const, error: "Knowledge base not found." };
    kb = owned.id;
  }
  const rows = await db
    .select({
      id: tuningErrorLessons.id,
      kbId: tuningErrorLessons.kbId,
      topic: tuningErrorLessons.topic,
      errorType: tuningErrorLessons.errorType,
      preventionRule: tuningErrorLessons.preventionRule,
      confidence: tuningErrorLessons.confidence,
      status: tuningErrorLessons.status,
      occurrenceCount: tuningErrorLessons.occurrenceCount,
      usageCount: tuningErrorLessons.usageCount,
      updatedAt: tuningErrorLessons.updatedAt,
    })
    .from(tuningErrorLessons)
    .where(kb ? and(eq(tuningErrorLessons.userId, user.id), eq(tuningErrorLessons.kbId, kb)) : eq(tuningErrorLessons.userId, user.id))
    .orderBy(desc(tuningErrorLessons.updatedAt))
    .limit(50)
    .all();
  return { ok: true as const, lessons: rows };
}

export async function updateErrorLessonStatusAction(input: { id: string; status: ErrorLessonStatus }) {
  const user = await requireUser();
  const parsed = z.object({ id: z.string().min(1).max(64), status: z.enum(errorLessonStatuses) }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Unknown lesson or status." };
  await db
    .update(tuningErrorLessons)
    .set({ status: parsed.data.status, updatedAt: new Date().toISOString() })
    .where(and(eq(tuningErrorLessons.id, parsed.data.id), eq(tuningErrorLessons.userId, user.id)))
    .run();
  revalidatePath("/app/tuning");
  return { ok: true as const };
}

export async function deleteErrorLessonAction(id: string) {
  const user = await requireUser();
  await db
    .delete(tuningErrorLessons)
    .where(and(eq(tuningErrorLessons.id, id), eq(tuningErrorLessons.userId, user.id)))
    .run();
  revalidatePath("/app/tuning");
  return { ok: true as const };
}
