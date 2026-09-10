import { NextResponse } from "next/server";
import { db, uid } from "@/lib/db";
import { communityMaterials } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/actions";
import { rateLimit } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/origin";
import { logSecurityEvent } from "@/lib/security/events";
import { verifyUpload } from "@/lib/security/uploads";
import { MAX_COMMUNITY_BYTES, requireMembership } from "@/lib/services/community";

export const runtime = "nodejs";
export const maxDuration = 300;

const ALLOWED = ["pdf", "word", "image"] as const;

/**
 * Community material upload (multipart — the real 200 MB path; server
 * actions cap bodies at 100 MB). Membership is verified before the
 * file is even read; magic bytes decide the type.
 */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ ok: false, error: "Cross-origin requests are not allowed." }, { status: 403 });
  }
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in again to share." }, { status: 401 });
  const rl = rateLimit(`cmat:${user.id}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "Too many uploads — try again later." }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't read the upload." }, { status: 400 });
  }
  const communityId = typeof form.get("communityId") === "string" ? (form.get("communityId") as string) : "";
  const file = form.get("file");
  if (!communityId || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: "Choose a file first." }, { status: 400 });
  }
  const m = await requireMembership(communityId, user.id);
  if (!m) return NextResponse.json({ ok: false, error: "Community not found." }, { status: 404 });
  if (file.size > MAX_COMMUNITY_BYTES) {
    return NextResponse.json({ ok: false, error: "File is too large — the limit is 200 MB." }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.slice(0, 200);
  const verified = verifyUpload(name, file.type, buffer);
  if (!verified.ok) {
    logSecurityEvent({ type: "upload_rejected", userId: user.id, detail: `community:${name.slice(0, 60)}: ${verified.error}` });
    return NextResponse.json({ ok: false, error: verified.error }, { status: 422 });
  }
  if (!(ALLOWED as readonly string[]).includes(verified.kind)) {
    return NextResponse.json({ ok: false, error: "Share PDFs, Word documents or images." }, { status: 422 });
  }

  const id = uid();
  await db.insert(communityMaterials).values({
    id,
    communityId,
    uploadedBy: user.id,
    fileName: name,
    mimeType: file.type.slice(0, 120) || "application/octet-stream",
    sizeBytes: buffer.length,
    rawBlob: buffer,
    status: "active",
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true, id });
}
