/* ──────────────────────────────────────────────────────────────
   File-signature validation. Extensions and browser MIME types are
   attacker-controlled; magic bytes are not. Every upload path must
   pass through verifyUpload() — it rejects renamed executables and
   mismatched content (polyglots) before parsing or storage.
   Pure and unit-tested; no I/O.
   ────────────────────────────────────────────────────────────── */

import { detectKind } from "@/lib/services/extract";
import type { MaterialKind } from "@/lib/db/schema";

export type UploadVerdict = { ok: true; kind: MaterialKind } | { ok: false; error: string };

function startsWith(buffer: Buffer, sig: number[]): boolean {
  if (buffer.length < sig.length) return false;
  return sig.every((b, i) => buffer[i] === b);
}

function isPdf(buffer: Buffer): boolean {
  // PDF spec: %PDF- header within the first 1024 bytes (allows BOM,
  // blank lines, and exporter padding before the marker).
  const head = buffer.subarray(0, 1024).toString("latin1");
  return /%PDF-\d\.\d/.test(head);
}

function isZip(buffer: Buffer): boolean {
  return startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]) || startsWith(buffer, [0x50, 0x4b, 0x07, 0x08]);
}

function isPng(buffer: Buffer): boolean {
  return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function isJpeg(buffer: Buffer): boolean {
  return startsWith(buffer, [0xff, 0xd8, 0xff]);
}

function isGif(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 6).toString("latin1");
  return head === "GIF87a" || head === "GIF89a";
}

function isWebp(buffer: Buffer): boolean {
  return buffer.length >= 12 && buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP";
}

function isExecutable(buffer: Buffer): boolean {
  if (buffer.length < 2) return false;
  // MZ (Windows), ELF (Linux), Mach-O / fat binaries (macOS).
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) return true;
  if (startsWith(buffer, [0x7f, 0x45, 0x4c, 0x46])) return true;
  const m = buffer.subarray(0, 4);
  const machO = ["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe"].includes(m.toString("hex"));
  if (machO) return true;
  // Shell/batch scripts masquerading as documents.
  const head = buffer.subarray(0, 64).toString("latin1").toLowerCase();
  if (head.startsWith("#!") || /^\s*@(echo|setlocal)\b/.test(head)) return true;
  return false;
}

function looksText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8192);
  if (sample.includes(0x00)) return false; // NUL = binary
  return true;
}

/**
 * Verify an upload: extension/MIME gives the claimed kind, magic bytes
 * confirm it. Returns a safe error string (no internals leaked).
 */
export function verifyUpload(fileName: string, mimeType: string, buffer: Buffer): UploadVerdict {
  if (!buffer.length) return { ok: false, error: "The file is empty." };
  if (isExecutable(buffer)) {
    return { ok: false, error: "That file isn't an accepted document type." };
  }
  const claimed = detectKind(fileName, mimeType);
  if (!claimed) return { ok: false, error: "Unsupported format — upload a PDF, Word, Excel, text or image file." };

  switch (claimed) {
    case "pdf":
      return isPdf(buffer) ? { ok: true, kind: claimed } : { ok: false, error: "That file isn't a readable PDF." };
    case "word":
      // ZIP = OOXML (.docx). Legacy OLE .doc fails closed here
      // (the parser only handles OOXML) with a non-technical message.
      return isZip(buffer) ? { ok: true, kind: claimed } : { ok: false, error: "That Word file isn't a readable .docx document." };
    case "excel": {
      // CSVs are plain text (parsed without the workbook library).
      const ext = fileName.toLowerCase().split(".").pop() ?? "";
      if (ext === "csv") {
        return looksText(buffer) ? { ok: true, kind: claimed } : { ok: false, error: "That CSV file contains binary data." };
      }
      return isZip(buffer) ? { ok: true, kind: claimed } : { ok: false, error: "That file isn't a readable .xlsx workbook." };
    }
    case "text":
      // JSON must start with { or [ (after whitespace) — a plain binary
      // blob renamed .json is rejected here, matching text handling.
      if (fileName.toLowerCase().split(".").pop() === "json" || mimeType === "application/json") {
        const head = buffer.subarray(0, 64).toString("utf8").trim();
        return head.startsWith("{") || head.startsWith("[")
          ? { ok: true, kind: claimed }
          : { ok: false, error: "That JSON file is not a valid object or array." };
      }
      return looksText(buffer) ? { ok: true, kind: claimed } : { ok: false, error: "That text file contains binary data." };
    case "image": {
      const ext = fileName.toLowerCase().split(".").pop() ?? "";
      const magicOk =
        (ext === "png" && isPng(buffer)) ||
        (["jpg", "jpeg"].includes(ext) && isJpeg(buffer)) ||
        (ext === "gif" && isGif(buffer)) ||
        (ext === "webp" && isWebp(buffer)) ||
        // MIME-claimed images without a clear extension: accept any known magic.
        (!["png", "jpg", "jpeg", "gif", "webp"].includes(ext) && (isPng(buffer) || isJpeg(buffer) || isGif(buffer) || isWebp(buffer)));
      return magicOk ? { ok: true, kind: claimed } : { ok: false, error: "That file isn't a supported image." };
    }
  }
}
