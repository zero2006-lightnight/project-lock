import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { materials } from "@/lib/db/schema";
import { currentUser } from "@/lib/auth/actions";

export const runtime = "nodejs";

/**
 * Authorized material file download — no direct storage URLs exist.
 * Uploaded images become renderable at /api/material/[id] so previews
 * persist across refreshes; non-image materials keep text-only rows
 * (rawBlob null → 404) and remain downloadable through their source UI.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;
  const row = (
    await db
      .select({
        fileName: materials.fileName,
        kind: materials.kind,
        mimeType: materials.mimeType,
        rawBlob: materials.rawBlob,
      })
      .from(materials)
      .where(and(eq(materials.id, id), eq(materials.userId, user.id)))
      .limit(1)
      .all()
  )[0];
  if (!row || !row.rawBlob) return NextResponse.json({ error: "File not found." }, { status: 404 });

  const bytes = Buffer.from(row.rawBlob as Buffer);
  const body = new Uint8Array(bytes).slice().buffer as ArrayBuffer;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": row.mimeType || "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${row.fileName.replace(/["\r\n]/g, "").slice(0, 180) || "file"}"`,
    },
  });
}
