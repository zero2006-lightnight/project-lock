import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractText, classifyPdfError } from "./extract";

/* ──────────────────────────────────────────────────────────────
   Local Python PDF parsing bridge.

   Primary:  scripts/syllabus_parse.py (PyMuPDF) — page-incremental,
             header/footer dedupe, heading detection, one JSON out.
   Fallback: in-process pdf-parse — only if Python is missing, slow,
             or errors. Never run both for the same document.
   ────────────────────────────────────────────────────────────── */

export const PYTHON_TIMEOUT_MS = 120_000;
export const PYTHON_MAX_CHARS = 500_000;

export type PythonParseResult = {
  engine: "python-pymupdf" | "node-fallback";
  pageCount: number | null;
  headings: { pageNumber: number; text: string }[];
  text: string;
  fingerprint: string;
  durationMs: number;
};

export function fingerprintBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Throw only for genuinely encrypted PDFs — never for parse failures. */
export class PdfPasswordError extends Error {
  constructor() {
    super("PDF_PASSWORD_REQUIRED");
    this.name = "PdfPasswordError";
  }
}

function runPython(pdfPath: string): Promise<{ text: string; pageCount: number | null; headings: { pageNumber: number; text: string }[]; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const script = join(process.cwd(), "scripts", "syllabus_parse.py");
    const child = spawn("python", [script, pdfPath, "--max-chars", String(PYTHON_MAX_CHARS)], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: PYTHON_TIMEOUT_MS,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
      // Guard: never buffer unbounded output (100MB docs).
      if (stdout.length > PYTHON_MAX_CHARS + 2_000_000) {
        child.kill();
        reject(new Error("python parser output exceeded safety cap"));
      }
    });
    child.stderr.on("data", (d) => (stderr += d.toString().slice(0, 2000)));
    child.on("error", (e) => reject(new Error(`python spawn failed: ${e.message}`)));
    child.on("close", (code) => {
      if (code === 2 || /PASSWORD_REQUIRED/.test(stderr)) {
        reject(new PdfPasswordError());
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || `python parser exited with code ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as {
          status: string;
          pageCount: number;
          headings: { pageNumber: number; text: string }[];
          fullText: string;
          durationMs: number;
        };
        if (parsed.status !== "SUCCESS" || typeof parsed.fullText !== "string") {
          reject(new Error("python parser returned unsuccessful status"));
          return;
        }
        resolve({ text: parsed.fullText, pageCount: parsed.pageCount ?? null, headings: parsed.headings ?? [], durationMs: parsed.durationMs ?? 0 });
      } catch {
        reject(new Error("python parser returned invalid JSON"));
      }
    });
  });
}

/**
 * Extract PDF text via the local Python parser, falling back to the
 * in-process Node extractor only when Python is unavailable or fails.
 * The temp file is always removed; the buffer is read exactly once.
 */
export async function extractPdfSmart(buffer: Buffer): Promise<PythonParseResult> {
  const started = Date.now();
  const fingerprint = fingerprintBuffer(buffer);
  const dir = mkdtempSync(join(tmpdir(), "sp-parse-"));
  const pdfPath = join(dir, "input.pdf");
  try {
    writeFileSync(pdfPath, buffer);
    const r = await runPython(pdfPath);
    return { engine: "python-pymupdf", pageCount: r.pageCount, headings: r.headings, text: r.text, fingerprint, durationMs: Date.now() - started };
  } catch (err) {
    // Genuinely encrypted PDFs fail everywhere — never waste the fallback on them.
    if (err instanceof PdfPasswordError) throw err;
    // Fallback runs only after primary failure — never both. Guarded by a
    // timeout so a pathological PDF can't hang the server event loop.
    try {
      const text = await Promise.race([
        extractText("pdf", "input.pdf", buffer),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("node fallback timed out")), 60_000)),
      ]);
      return { engine: "node-fallback", pageCount: null, headings: [], text, fingerprint, durationMs: Date.now() - started };
    } catch (fallbackErr) {
      if (classifyPdfError(fallbackErr) === "password") throw new PdfPasswordError();
      if (process.env.NODE_ENV === "development") {
        console.error("[extract] node pdf fallback failed:", fallbackErr);
      }
      throw fallbackErr;
    }
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* temp cleanup is best-effort */
    }
  }
}
