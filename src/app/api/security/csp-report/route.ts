import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** CSP violation sink (Report-Only policy). Logs compactly for phased tightening. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      "csp-report"?: { "document-uri"?: string; "violated-directive"?: string; "blocked-uri"?: string };
    } | null;
    const r = body?.["csp-report"];
    if (r) {
      console.log(
        `[security] csp-violation doc=${String(r["document-uri"] ?? "").slice(0, 120)} directive=${String(r["violated-directive"] ?? "").slice(0, 80)} blocked=${String(r["blocked-uri"] ?? "").slice(0, 160)}`,
      );
    }
  } catch {
    /* never fail on telemetry */
  }
  return new NextResponse(null, { status: 204 });
}
