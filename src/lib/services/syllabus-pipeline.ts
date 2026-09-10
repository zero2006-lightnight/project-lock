import { createHash } from "node:crypto";
import { detectKind, extractText, classifyPdfError, MAX_MATERIAL_CHARS } from "./extract";
import { extractPdfSmart, PdfPasswordError } from "./python-parse";
import {
  heuristicParse,
  parseSyllabusText,
  type ParsedSyllabus,
  type ParsedTopic,
  type SyllabusParseResult,
} from "./syllabus-parse";

/* ──────────────────────────────────────────────────────────────
   Syllabus import pipeline — one coordinator, one lifecycle:

     validate → extract (local) → structure (heuristic first,
     AI only when ambiguous) → validate → done.

   Guarantees:
   - Single processing: concurrent requests sharing an importId
     await the SAME promise; never two parsers for one import.
   - Fingerprint reuse: identical file bytes with a completed parse
     return the stored structure without re-parsing.
   - No auto-retries: one attempt per call; failures surface with
     their stage (parse vs analysis) so the UI can offer the right
     targeted retry.
   ────────────────────────────────────────────────────────────── */

export const MAX_SYLLABUS_BYTES = 20 * 1024 * 1024; // 20 MB
export const AI_CONTEXT_CHARS = 60_000;

export type PipelineStage = "parse" | "analysis";

export type PipelineTimings = {
  extractMs: number;
  structureMs: number;
  totalMs: number;
  engine: "python-pymupdf" | "node-fallback" | "text";
};

export type PipelineResult = SyllabusParseResult & {
  ok: true;
  fingerprint: string;
  reused: boolean;
  timings: PipelineTimings;
};

export type PipelineError = { ok: false; stage: PipelineStage | "validate"; error: string };

type CompletedEntry = {
  syllabus: ParsedSyllabus;
  source: "ai" | "heuristic";
  warning?: string;
  expiresAt: number;
};

/** Completed parses keyed by content hash — same bytes never re-parse. */
const completedByFingerprint = new Map<string, CompletedEntry>();
/** In-flight parses keyed by client importId — one parser per import. */
const inFlightByImportId = new Map<string, Promise<PipelineResult | PipelineError>>();
/**
 * Extracted text keyed by importId — an analysis-stage retry with the
 * same importId resumes from stored extraction instead of re-parsing
 * the file. Never shared across users (importIds are unguessable).
 */
const extractedByImportId = new Map<string, { fingerprint: string; text: string; engine: PipelineTimings["engine"]; expiresAt: number }>();

const COMPLETED_TTL_MS = 60 * 60 * 1000;
const MAX_COMPLETED_ENTRIES = 200;

function sweepCompleted() {
  const now = Date.now();
  for (const [k, v] of completedByFingerprint) if (v.expiresAt < now) completedByFingerprint.delete(k);
  while (completedByFingerprint.size > MAX_COMPLETED_ENTRIES) {
    const first = completedByFingerprint.keys().next();
    if (first.done) break;
    completedByFingerprint.delete(first.value);
  }
}

export function fingerprintBytes(buffer: Buffer, sizeBytes: number): string {
  return `${createHash("sha256").update(buffer).digest("hex")}:${sizeBytes}:v1`;
}

/** Normalize titles for duplicate comparison (case/space/punct-insensitive). */
export function normalizeTitle(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** Drop duplicate topics within each unit (keeps first occurrence). Pure. */
export function dedupeSyllabus(syllabus: ParsedSyllabus): ParsedSyllabus {
  return {
    subjects: syllabus.subjects.map((s) => ({
      ...s,
      units: s.units.map((u) => {
        const seen = new Set<string>();
        const topics: ParsedTopic[] = [];
        for (const t of u.topics) {
          const key = normalizeTitle(t.name);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          topics.push(t);
        }
        return { ...u, topics };
      }),
    })),
  };
}

/**
 * Heuristic confidence gate — mechanical structure the local parser
 * already resolved needs no AI. AI runs only for ambiguous documents.
 */
export function heuristicConfident(syllabus: ParsedSyllabus): boolean {
  const units = syllabus.subjects.flatMap((s) => s.units);
  const topics = units.reduce((a, u) => a + u.topics.length, 0);
  const headed = units.filter((u) => !/^topics$/i.test(u.name.trim()));
  return headed.length >= 2 || topics >= 8;
}

async function runOnce(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  defaultSubjectName?: string,
  importId?: string,
): Promise<PipelineResult | PipelineError> {
  const started = Date.now();
  if (!buffer.length) return { ok: false, stage: "validate", error: "The file is empty." } as PipelineError;
  if (buffer.length > MAX_SYLLABUS_BYTES) {
    return { ok: false, stage: "validate", error: "File is too large — the limit is 20 MB." } as PipelineError;
  }
  const kind = detectKind(fileName, mimeType);
  if (!kind || kind === "image") {
    return { ok: false, stage: "validate", error: "Unsupported syllabus format — upload a PDF, Word, Excel, CSV, JSON, Markdown or text file." } as PipelineError;
  }

  const fingerprint = fingerprintBytes(buffer, buffer.length);
  sweepCompleted();
  const cached = completedByFingerprint.get(fingerprint);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      ok: true as const,
      syllabus: cached.syllabus,
      source: cached.source,
      warning: cached.warning,
      fingerprint,
      reused: true,
      timings: { extractMs: 0, structureMs: 0, totalMs: Date.now() - started, engine: "text" },
    };
  }

  // ── Extract (local only — AI never sees raw files) ──
  // A retry with the same importId resumes from stored extraction.
  const extractStarted = Date.now();
  let text = "";
  let engine: PipelineTimings["engine"] = "text";
  const resumed = importId ? extractedByImportId.get(importId) : undefined;
  if (resumed && resumed.fingerprint === fingerprint && resumed.expiresAt > Date.now()) {
    text = resumed.text;
    engine = resumed.engine;
  } else {
    try {
      if (kind === "pdf") {
        const r = await extractPdfSmart(buffer);
        text = r.text;
        engine = r.engine;
      } else {
        text = await extractText(kind, fileName, buffer);
      }
    } catch (extractErr) {
      // Password protection is reported ONLY for genuinely encrypted
      // PDFs — never for ordinary parsing failures.
      const kind = classifyPdfError(extractErr);
      if (kind === "password") {
        return { ok: false, stage: "parse", error: "This PDF is password protected." } as PipelineError;
      }
      if (process.env.NODE_ENV === "development") {
        console.error("[syllabus] extraction failed:", extractErr);
      }
      return { ok: false, stage: "parse", error: "This file could not be read." } as PipelineError;
    }
  }
  const extractMs = Date.now() - extractStarted;
  if (importId && text) {
    extractedByImportId.set(importId, { fingerprint, text, engine, expiresAt: Date.now() + COMPLETED_TTL_MS });
    if (extractedByImportId.size > MAX_COMPLETED_ENTRIES) {
      const first = extractedByImportId.keys().next();
      if (!first.done) extractedByImportId.delete(first.value);
    }
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, stage: "parse", error: "No readable syllabus content found." } as PipelineError;
  }

  // ── Structure: deterministic first, AI only when ambiguous ──
  const structureStarted = Date.now();
  const heuristic = heuristicParse(trimmed.slice(0, MAX_MATERIAL_CHARS));
  let result: SyllabusParseResult;
  if (heuristic && heuristicConfident(heuristic)) {
    const named =
      defaultSubjectName != null
        ? { subjects: heuristic.subjects.map((s) => ({ ...s, name: defaultSubjectName })) }
        : heuristic;
    result = { syllabus: named, source: "heuristic" as const };
  } else {
    try {
      result = await parseSyllabusText(trimmed.slice(0, AI_CONTEXT_CHARS), { defaultSubjectName });
    } catch {
      return { ok: false, stage: "analysis", error: "Analysis failed — try again without re-uploading." } as PipelineError;
    }
  }
  const structureMs = Date.now() - structureStarted;

  const syllabus = dedupeSyllabus(result.syllabus);
  const topics = syllabus.subjects.flatMap((s) => s.units).reduce((a, u) => a + u.topics.length, 0);
  if (!syllabus.subjects.length || topics === 0) {
    return { ok: false, stage: "analysis", error: result.warning ?? "Couldn't find a syllabus structure in this document." } as PipelineError;
  }

  completedByFingerprint.set(fingerprint, {
    syllabus,
    source: result.source,
    warning: result.warning,
    expiresAt: Date.now() + COMPLETED_TTL_MS,
  });

  return {
    ok: true as const,
    syllabus,
    source: result.source,
    warning: result.warning,
    fingerprint,
    reused: false,
    timings: { extractMs, structureMs, totalMs: Date.now() - started, engine },
  };
}

/**
 * Run the pipeline with a single-processing guarantee: concurrent calls
 * with the same importId share one in-flight promise.
 */
export function runSyllabusPipeline(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  opts?: { defaultSubjectName?: string; importId?: string },
): Promise<PipelineResult | PipelineError> {
  const key = opts?.importId?.trim();
  if (!key) return runOnce(buffer, fileName, mimeType, opts?.defaultSubjectName);
  const live = inFlightByImportId.get(key);
  if (live) return live;
  const p = runOnce(buffer, fileName, mimeType, opts?.defaultSubjectName, key).finally(() => {
    if (inFlightByImportId.get(key) === p) inFlightByImportId.delete(key);
  });
  inFlightByImportId.set(key, p);
  return p;
}
