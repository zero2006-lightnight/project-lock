import type { MaterialKind } from "@/lib/db/schema";

export type { MaterialKind } from "@/lib/db/schema";

/* ──────────────────────────────────────────────────────────────
   Study-material text extraction.

   pdf  → pdf-parse (pure JS, no native deps)
   word → mammoth (.docx → plain text)
   excel→ xlsx (all sheets → row text)
   text → as-is
   image→ stored for reference; text extraction needs OCR (backlog)
   ────────────────────────────────────────────────────────────── */

export const MAX_MATERIAL_CHARS = 200_000;

export function detectKind(fileName: string, mimeType: string): MaterialKind | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || mimeType === "application/pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "word";
  if (ext === "xlsx" || ext === "xls" || ext === "csv") return "excel";
  if (ext === "txt" || ext === "md" || ext === "json" || mimeType === "application/json" || mimeType.startsWith("text/")) return "text";
  if (mimeType.startsWith("image/")) return "image";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  return null;
}

/**
 * PDF failure taxonomy — only genuinely encrypted documents are password
 * errors. Everything else (broken xref tables, truncated downloads,
 * non-PDF bytes renamed to .pdf) is "could not be read", never
 * "password protected".
 */
export function classifyPdfError(err: unknown): "password" | "unreadable" {
  const name = (err as { name?: string } | null)?.name ?? "";
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (name === "PasswordException" || /PASSWORD_REQUIRED|password/i.test(msg)) return "password";
  return "unreadable";
}

export async function extractText(
  kind: MaterialKind,
  fileName: string,
  buffer: Buffer,
): Promise<string> {
  switch (kind) {
    case "pdf":
      return extractPdf(buffer);
    case "word":
      return extractWord(buffer);
    case "excel":
      return extractExcel(buffer, fileName);
    case "text":
      return buffer.toString("utf8").slice(0, MAX_MATERIAL_CHARS);
    case "image":
      return "";
  }
}

type PdfParseModule = {
  PDFParse?: new (options: { data: Uint8Array }) => {
    getText(): Promise<{ text?: string }>;
    destroy?(): Promise<void>;
  };
  text?: (b: Buffer) => Promise<string>;
  default?: PdfParseModule;
};

async function extractPdf(buffer: Buffer): Promise<string> {
  const mod = (await import("pdf-parse")) as unknown as PdfParseModule;
  // pdf-parse v2.4+ (ESM): PDFParse class with getText()
  const PDFParse = mod.PDFParse ?? mod.default?.PDFParse;
  if (typeof PDFParse === "function") {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return (result?.text ?? "").replace(/\u0000/g, "").trim().slice(0, MAX_MATERIAL_CHARS);
    } catch (err) {
      // Re-throw with a recognizable name so classifyPdfError() can tell
      // "this PDF is password protected" apart from "could not be read".
      const kind = classifyPdfError(err);
      const wrapped = new Error(kind === "password" ? "PASSWORD_REQUIRED" : "PDF_UNREADABLE");
      (wrapped as { cause?: unknown }).cause = err;
      if (process.env.NODE_ENV === "development") {
        console.error("[extract] pdf-parse failed:", err);
      }
      throw wrapped;
    } finally {
      try {
        await parser.destroy?.();
      } catch {
        /* destroy is best-effort */
      }
    }
  }
  // Legacy/alternate builds: plain text() function
  const legacy = mod.text ?? mod.default?.text;
  if (legacy) {
    const out = await legacy.call(mod, buffer);
    return (out ?? "").replace(/\u0000/g, "").trim().slice(0, MAX_MATERIAL_CHARS);
  }
  throw new Error("pdf-parse module shape unrecognized");
}

async function extractWord(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return (result.value ?? "").trim().slice(0, MAX_MATERIAL_CHARS);
}

/** Hard cap for binary workbooks: the xlsx dependency carries unpatched
 *  prototype-pollution/ReDoS advisories, so attacker-controlled workbooks
 *  stay small and CSVs bypass the library entirely (plain parsing). */
export const MAX_EXCEL_BYTES = 10 * 1024 * 1024;

function parseCsvPlain(buffer: Buffer): string {
  const text = buffer.toString("utf8");
  const rows = text.split(/\r?\n/).map((line) => {
    // Minimal RFC-4180: quoted cells may contain commas/quotes.
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells.join(" | ");
  });
  return rows.filter((r) => r.replace(/[|\s]/g, "").length > 0).join("\n");
}

async function extractExcel(buffer: Buffer, fileName: string): Promise<string> {
  // CSVs never touch the workbook library (no PP/ReDoS surface at all).
  if (/\.csv$/i.test(fileName)) {
    return parseCsvPlain(buffer).slice(0, MAX_MATERIAL_CHARS);
  }
  if (buffer.length > MAX_EXCEL_BYTES) {
    throw new Error("Excel workbooks over 10 MB aren't supported — export the sheet as CSV instead.");
  }
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer", sheetStubs: false });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames.slice(0, 20)) {
    if (/^__(proto|defineGetter|lookupGetter)__$/.test(sheetName)) continue; // never honor magic keys
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
    if (csv.trim()) parts.push(`# Sheet: ${sheetName.slice(0, 80)}\n${csv}`);
  }
  return parts.join("\n\n").trim().slice(0, MAX_MATERIAL_CHARS);
}

/** Build a condensed excerpt for AI grounding (keeps head + samples). */
export function buildExcerpt(fullText: string, maxChars = 1400): string {
  const clean = fullText.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  const head = clean.slice(0, Math.floor(maxChars * 0.7));
  const tail = clean.slice(-Math.floor(maxChars * 0.25));
  return `${head} … ${tail}`;
}
