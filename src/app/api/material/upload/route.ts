import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, uid } from "@/lib/db";
import { materials, subjects, topics, units } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/actions";
import { buildExcerpt } from "@/lib/services/extract";
import { verifyUpload } from "@/lib/security/uploads";
import { logSecurityEvent } from "@/lib/security/events";
import { rateLimit } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/origin";

export const runtime = "nodejs";

/**
 * Multipart material upload — the real progress path for images.
 *
 * The server action (base64 JSON) can't report transfer progress, so
 * image uploads post here via XHR: the client gets actual upload
 * percentages, a hard client-side timeout, and cancel. Validation is
 * identical to the action path (magic bytes decide), and the response
 * returns the authorized URL the preview switches to after success.
 */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ ok: false, error: "Cross-origin requests are not allowed." }, { status: 403 });
  }
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in again to upload." }, { status: 401 });
  const rl = rateLimit(`material-upload:${user.id}`, { limit: 30, windowMs: 10 * 60 * 1000 });
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "Too many uploads — wait a few minutes." }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't read the upload." }, { status: 400 });
  }

  const file = form.get("file");
  const subjectId = typeof form.get("subjectId") === "string" ? (form.get("subjectId") as string) : undefined;
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: "Choose a file first." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.slice(0, 200);
  const verified = verifyUpload(name, file.type, buffer);
  if (!verified.ok) {
    logSecurityEvent({ type: "upload_rejected", userId: user.id, detail: `material:${name.slice(0, 80)}: ${verified.error}` });
    return NextResponse.json({ ok: false, error: verified.error }, { status: 422 });
  }

  // Ownership check when attaching to a subject.
  let resolvedSubjectId: string | null = null;
  if (subjectId) {
    const own = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.id, subjectId), eq(subjects.userId, user.id)))
      .limit(1)
      .all();
    if (!own.length) return NextResponse.json({ ok: false, error: "Subject not found." }, { status: 404 });
    resolvedSubjectId = subjectId;
  }

  const id = uid();
  const warning =
    verified.kind === "image"
      ? "Images are stored for reference — text extraction (OCR) is coming soon, so Pilot can't read their contents yet."
      : undefined;
  await db.insert(materials).values({
    id,
    userId: user.id,
    subjectId: resolvedSubjectId,
    topicId: null,
    fileName: name,
    kind: verified.kind,
    mimeType: verified.kind === "image" ? file.type.slice(0, 120) || null : null,
    sizeBytes: buffer.length,
    rawBlob: verified.kind === "image" ? buffer : null,
    excerpt: null,
    fullText: null,
    charCount: 0,
    status: "ready",
  });

  revalidatePath("/app/syllabus");
  return NextResponse.json({
    ok: true,
    id,
    kind: verified.kind,
    charCount: 0,
    warning,
    ...(verified.kind === "image" ? { url: `/api/material/${id}`, mimeType: file.type, sizeBytes: buffer.length } : {}),
  });
}
