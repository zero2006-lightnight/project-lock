/* ──────────────────────────────────────────────────────────────
   Tuning text pipeline — clean → section-split → semantic chunks.

   Splits on real document structure (headings, numbered sections,
   paragraph groups) with overlap, never on blind character windows.
   ────────────────────────────────────────────────────────────── */

export const MAX_TUNING_CHARS = 200_000;
export const MAX_CHUNKS_PER_DOC = 400;
const TARGET_CHUNK = 850;
const OVERLAP = 130;

export type TuningChunk = { section: string | null; content: string };

/** Remove extraction artifacts while preserving academic content. */
export function cleanTuningText(raw: string): string {
  const noNulls = raw.replace(/\u0000/g, "").replace(/\r/g, "\n");
  const lines = noNulls.split("\n");
  // Drop lines that repeat 3+ times (running headers/footers/page numbers).
  const counts = new Map<string, number>();
  for (const l of lines) {
    const k = l.trim();
    if (k.length > 3) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const kept = lines.filter((l) => {
    const t = l.trim();
    if (!t) return true; // keep paragraph breaks
    if (/^\d{1,4}$/.test(t)) return false; // lone page numbers
    if (t.length > 3 && (counts.get(t) ?? 0) >= 3 && t.length < 90) return false;
    return true;
  });
  return kept
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TUNING_CHARS);
}

const HEADING_PATTERNS: RegExp[] = [
  /^#{1,4}\s+(.+)/, // markdown
  /^(chapter|unit|module|section|lesson|part)\s+[\divx.\-:]+\s*(.+)?$/i,
  /^\d{1,2}(\.\d{1,2}){0,3}\s+[A-Z].+/, // 3.2 Graph Traversal
  /^[A-Z][A-Z0-9 ,&'’\-/()]{6,80}$/, // ALL-CAPS headings
];

function headingOf(line: string): string | null {
  const t = line.trim();
  if (!t || t.length > 90) return null;
  for (const re of HEADING_PATTERNS) {
    const m = t.match(re);
    if (m) return (m[1] ?? m[2] ?? t).trim().slice(0, 80) || t.slice(0, 80);
  }
  return null;
}

export type Section = { title: string | null; body: string };

/** Split cleaned text into titled sections. */
export function splitSections(clean: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { title: null, body: "" };
  for (const line of clean.split("\n")) {
    const h = headingOf(line);
    if (h && current.body.trim().length > 120) {
      sections.push(current);
      current = { title: h, body: "" };
    } else if (h && !current.body.trim()) {
      current.title = current.title ?? h;
    } else {
      current.body += `${line}\n`;
    }
  }
  if (current.body.trim()) sections.push(current);
  return sections.filter((s) => s.body.trim().length > 0);
}

/** Chunk one section body into paragraph-group windows with overlap. */
function chunkBody(body: string, target = TARGET_CHUNK): string[] {
  const paras = body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paras) {
    if ((buf + " " + p).trim().length <= target || !buf) {
      buf = buf ? `${buf}\n\n${p}` : p;
    } else {
      chunks.push(buf);
      // Overlap: carry the tail of the previous chunk forward.
      const tail = buf.slice(-OVERLAP);
      buf = `${tail}\n\n${p}`.trim();
      if (buf.length > target * 1.6) {
        chunks.push(buf);
        buf = "";
      }
    }
  }
  if (buf.trim()) chunks.push(buf);
  // Hard-split any pathological single-paragraph chunk.
  const out: string[] = [];
  for (const c of chunks) {
    if (c.length <= target * 1.8) out.push(c);
    else {
      for (let i = 0; i < c.length; i += target) out.push(c.slice(i, i + target));
    }
  }
  return out.map((c) => c.trim()).filter((c) => c.length >= 60);
}

/** Full pipeline: raw extracted text → section-aware chunks. */
export function buildTuningChunks(raw: string): TuningChunk[] {
  const clean = cleanTuningText(raw);
  if (clean.length < 60) return [];
  const out: TuningChunk[] = [];
  for (const s of splitSections(clean)) {
    for (const content of chunkBody(s.body)) {
      out.push({ section: s.title, content });
      if (out.length >= MAX_CHUNKS_PER_DOC) return out;
    }
  }
  return out;
}
