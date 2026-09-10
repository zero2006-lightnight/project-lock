import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { communityMaterials } from "@/lib/db/schema";
import { currentUser } from "@/lib/auth/actions";
import { logSecurityEvent } from "@/lib/security/events";
import { requireMembership } from "@/lib/services/community";

export const runtime = "nodejs";

/**
 * Authorized file download — no direct storage URLs exist. Every
 * request verifies: authenticated → member of the owning community →
 * material still active. Outsiders get a uniform 404 (no existence leak).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;
  const row = (await db.select().from(communityMaterials).where(eq(communityMaterials.id, id)).limit(1).all())[0];
  if (!row || row.status !== "active" || !row.rawBlob) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  const m = await requireMembership(row.communityId, user.id);
  if (!m) {
    logSecurityEvent({ type: "csrf_blocked", userId: user.id, detail: `community file denied:${id.slice(0, 12)}` });
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  const bytes = Buffer.from(row.rawBlob as Buffer);
  const safeName = row.fileName.replace(/["\r\n]/g, "").slice(0, 180) || "download";
  const body = new Uint8Array(bytes).slice().buffer as ArrayBuffer;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": row.mimeType || "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
