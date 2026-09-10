"use server";

import { and, desc, eq } from "drizzle-orm";
import { db, uid } from "@/lib/db";
import { materials, subjects, topics, units } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/actions";
import { revalidatePath } from "next/cache";
import { extractText, buildExcerpt } from "@/lib/services/extract";
import { verifyUpload } from "@/lib/security/uploads";
import { logSecurityEvent } from "@/lib/security/events";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB (framework body cap raised to match in next.config.ts)

export type UploadMaterialResult =
  | {
      ok: true;
      id: string;
      kind: string;
      charCount: number;
      warning?: string;
      /** Present for images: served at this URL (authorized, owner-only). */
      url?: string;
      mimeType?: string;
      sizeBytes?: number;
    }
  | { ok: false; error: string };

export async function uploadMaterialAction(input: {
  fileName: string;
  mimeType: string;
  /** base64-encoded file content (server actions don't stream binary) */
  dataBase64: string;
  subjectId?: string;
  topicId?: string;
}): Promise<UploadMaterialResult> {
  const user = await requireUser();
  const name = input.fileName.slice(0, 200);
  const buffer = Buffer.from(input.dataBase64, "base64");

  if (!buffer.length) return { ok: false, error: "The file is empty." };
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "File is too large — the limit is 100 MB." };
  }

  // Magic-byte check: renamed executables and mismatched content fail here.
  const verified = verifyUpload(name, input.mimeType, buffer);
  if (!verified.ok) {
    logSecurityEvent({ type: "upload_rejected", userId: user.id, detail: `${name.slice(0, 80)}: ${verified.error}` });
    return { ok: false, error: verified.error };
  }
  const kind = verified.kind;

  // Ownership check when attaching to a subject/topic.
  let subjectId: string | null = null;
  let topicId: string | null = null;
  if (input.subjectId) {
    const own = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.id, input.subjectId), eq(subjects.userId, user.id)))
      .limit(1)
      .all();
    if (!own.length) return { ok: false, error: "Subject not found." };
    subjectId = input.subjectId;
  }
  if (input.topicId) {
    const own = await db
      .select({ id: topics.id, unitId: topics.unitId })
      .from(topics)
      .innerJoin(units, eq(topics.unitId, units.id))
      .innerJoin(subjects, eq(units.subjectId, subjects.id))
      .where(and(eq(topics.id, input.topicId), eq(subjects.userId, user.id)))
      .limit(1)
      .all();
    if (!own.length) return { ok: false, error: "Topic not found." };
    topicId = input.topicId;
    if (!subjectId) {
      const sid = await db
        .select({ subjectId: units.subjectId })
        .from(units)
        .where(eq(units.id, own[0].unitId))
        .limit(1)
        .all();
      subjectId = sid[0]?.subjectId ?? null;
    }
  }

  let warning: string | undefined;
  let fullText = "";
  if (kind === "image") {
    warning =
      "Images are stored for reference — text extraction (OCR) for photos is coming soon, so Pilot can't read their contents yet.";
  } else {
    try {
      fullText = await extractText(kind, name, buffer);
      if (!fullText.trim()) {
        warning =
          kind === "pdf"
            ? "No selectable text found — this looks like a scanned PDF. Stored for reference, but Pilot can't read scanned pages yet (OCR coming soon)."
            : "No readable text found — stored for reference.";
      }
    } catch {
      warning = "Text extraction failed — stored for reference, but Pilot can't read its contents yet.";
    }
  }

  const id = uid();
  await db.insert(materials).values({
    id,
    userId: user.id,
    subjectId,
    topicId,
    fileName: name,
    kind,
    // Images are persisted so they can be viewed again at /api/material/[id];
    // documents keep text-only rows (blob stays null).
    mimeType: kind === "image" ? input.mimeType.slice(0, 120) || null : null,
    sizeBytes: buffer.length,
    rawBlob: kind === "image" ? buffer : null,
    excerpt: fullText ? buildExcerpt(fullText) : null,
    fullText: fullText || null,
    charCount: fullText.length,
    status: "ready",
  });

  revalidatePath("/app/syllabus");
  return {
    ok: true,
    id,
    kind,
    charCount: fullText.length,
    warning,
    ...(kind === "image"
      ? { url: `/api/material/${id}`, mimeType: input.mimeType, sizeBytes: buffer.length }
      : {}),
  };
}

export async function listMaterialsAction(subjectId?: string) {
  const user = await requireUser();
  const rows = await db
    .select({
      id: materials.id,
      fileName: materials.fileName,
      kind: materials.kind,
      charCount: materials.charCount,
      excerpt: materials.excerpt,
      createdAt: materials.createdAt,
      subjectName: subjects.name,
    })
    .from(materials)
    .leftJoin(subjects, eq(materials.subjectId, subjects.id))
    .where(
      subjectId
        ? and(eq(materials.userId, user.id), eq(materials.subjectId, subjectId))
        : eq(materials.userId, user.id),
    )
    .orderBy(desc(materials.createdAt))
    .limit(100)
    .all();
  return rows;
}

export async function deleteMaterialAction(id: string) {
  const user = await requireUser();
  await db.delete(materials).where(and(eq(materials.id, id), eq(materials.userId, user.id))).run();
  revalidatePath("/app/syllabus");
  return { ok: true as const };
}
