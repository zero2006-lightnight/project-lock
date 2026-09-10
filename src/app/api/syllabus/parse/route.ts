import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { subjects } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/actions";
import { mintPreviewToken } from "@/lib/services/import-tokens";
import { rateLimit } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/origin";
import { logSecurityEvent } from "@/lib/security/events";
import { MAX_SYLLABUS_BYTES, runSyllabusPipeline } from "@/lib/services/syllabus-pipeline";

export const runtime = "nodejs";
// Large-document parsing runs long — self-hosted `next start` honors this.
export const maxDuration = 300;

/**
 * Syllabus import parse endpoint (multipart — the real 100 MB path).
 *
 * Server Actions cap request bodies (~1 MB default), so whole-file
 * uploads go through this route instead: the file is read ONCE into a
 * Buffer, parsed by the local Python extractor, structured
 * (heuristic first, AI only when ambiguous), and answered with a
 * single-use preview token. Nothing is persisted until commit.
 *
 * Idempotency: callers send `importId` (uuid per file pick). Concurrent
 * requests with the same importId share one in-flight parse; identical
 * file bytes return the cached structure without re-parsing.
 */
const PARSE_LIMIT = { limit: 10, windowMs: 10 * 60 * 1000 }; // parsing is CPU-heavy: 10 per user / 10 min

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    logSecurityEvent({ type: "csrf_blocked", detail: "POST /api/syllabus/parse" });
    return NextResponse.json({ ok: false, stage: "validate", error: "Cross-origin requests are not allowed." }, { status: 403 });
  }
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ ok: false, stage: "validate", error: "Sign in again to import." }, { status: 401 });
  const rl = rateLimit(`syllabus-parse:${user.id}`, PARSE_LIMIT);
  if (!rl.allowed) {
    logSecurityEvent({ type: "parse_rate_limited", userId: user.id });
    return NextResponse.json({ ok: false, stage: "validate", error: "Too many imports right now — wait a few minutes and try again." }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, stage: "validate", error: "Couldn't read the upload." }, { status: 400 });
  }

  const file = form.get("file");
  const subjectId = typeof form.get("subjectId") === "string" ? (form.get("subjectId") as string) : undefined;
  const importId = typeof form.get("importId") === "string" ? (form.get("importId") as string) : undefined;
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, stage: "validate", error: "Choose a file first." }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ ok: false, stage: "validate", error: "File is too large — the limit is 20 MB." }, { status: 413 });
  }

  if (subjectId) {
    const own = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.id, subjectId), eq(subjects.userId, user.id)))
      .limit(1)
      .all();
    if (!own.length) return NextResponse.json({ ok: false, stage: "validate", error: "Subject not found." }, { status: 404 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const stem = file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
  const hint = stem.length >= 3 && stem.length <= 60 ? stem : undefined;

  const result = await runSyllabusPipeline(buffer, file.name.slice(0, 200), file.type, {
    defaultSubjectName: hint,
    importId,
  });

  if (!result.ok) {
    const status = result.stage === "validate" ? 400 : 422;
    console.log(`[syllabus] import failed stage=${result.stage} file=${file.name.slice(0, 80)} bytes=${file.size} err=${result.error.slice(0, 120)}`);
    return NextResponse.json(result, { status });
  }

  // Lightweight observability — durations only, never document content.
  console.log(
    `[syllabus] parsed file=${file.name.slice(0, 80)} bytes=${file.size} engine=${result.timings.engine} ` +
      `extractMs=${result.timings.extractMs} structureMs=${result.timings.structureMs} ` +
      `totalMs=${result.timings.totalMs} source=${result.source} reused=${result.reused}`,
  );

  const token = mintPreviewToken(user.id, result.syllabus);
  return NextResponse.json({
    ok: true,
    token,
    syllabus: result.syllabus,
    source: result.source,
    warning: result.warning,
    reused: result.reused,
    timings: result.timings,
  });
}
