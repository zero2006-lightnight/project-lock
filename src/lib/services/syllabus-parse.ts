import { z } from "zod";
import { getAiProvider, askForJson } from "@/lib/ai/provider";

/* ──────────────────────────────────────────────────────────────
   Syllabus import parsing.

   Path 1 (AI): provider available → LLM structures the document
   into subjects/units/topics; output is Zod-validated and hard-capped
   so a hallucinating model can't flood the planner.

   Path 2 (heuristic): deterministic regex parsing for common syllabus
   layouts ("Unit 1", "Module 2", topic lists). Used when no provider
   is configured or when the AI output fails validation.
   ────────────────────────────────────────────────────────────── */

/** Difficulty: coerce → clamp into 1..5 (never rejects the whole topic). */
const DifficultySchema = z
  .coerce.number()
  .int()
  .transform((n) => Math.min(5, Math.max(1, n)))
  .catch(3);

export const ParsedTopicSchema = z.object({
  name: z
    .string()
    .min(1)
    .catch("Untitled topic")
    .transform((s) => s.slice(0, 120)),
  difficulty: DifficultySchema,
});

const ParsedUnitBodySchema = z.object({
  name: z
    .string()
    .min(1)
    .catch("Untitled unit")
    .transform((s) => s.slice(0, 120)),
  topics: z.array(z.unknown()),
});

const ParsedSubjectBodySchema = z.object({
  name: z
    .string()
    .min(1)
    .catch("Imported subject")
    .transform((s) => s.slice(0, 80)),
  units: z.array(z.unknown()),
});

/** Validate array items individually and TRUNCATE at the cap — a runaway
 *  model payload gets capped, not rejected wholesale. */
function truncatingArray<T>(schema: z.ZodType<T>, max: number, fallback: T[]) {
  return z
    .array(z.unknown())
    .transform((arr) => {
      const out: T[] = [];
      for (const item of arr) {
        const r = schema.safeParse(item);
        if (r.success) out.push(r.data);
        if (out.length >= max) break;
      }
      return out;
    })
    .catch(fallback);
}

export const ParsedUnitSchema = ParsedUnitBodySchema.extend({
  topics: truncatingArray(ParsedTopicSchema, 40, [] as ParsedTopic[]),
});

const ParsedSubjectSchema = ParsedSubjectBodySchema.extend({
  units: truncatingArray(ParsedUnitSchema, 10, [] as ParsedUnit[]),
});

export const ParsedSyllabusSchema = z.object({
  subjects: z
    .array(z.unknown())
    .transform((arr) => {
      const out: { name: string; units: ParsedUnit[] }[] = [];
      for (const item of arr) {
        const r = ParsedSubjectSchema.safeParse(item);
        if (r.success) out.push(r.data);
        if (out.length >= 8) break;
      }
      return out;
    })
    .refine((s) => s.length >= 1, "At least one subject is required"),
});

export type ParsedTopic = z.infer<typeof ParsedTopicSchema>;
export type ParsedUnit = z.infer<typeof ParsedUnitSchema>;
export type ParsedSyllabus = z.infer<typeof ParsedSyllabusSchema>;

export type SyllabusParseResult = {
  syllabus: ParsedSyllabus;
  source: "ai" | "heuristic";
  warning?: string;
};

const AI_SYSTEM = `You are a syllabus structuring engine inside StudyPilot. The user pastes the raw text of a course document (possibly messy OCR/extraction output). Return JSON: {"subjects":[{"name":"...","units":[{"name":"...","topics":[{"name":"...","difficulty":3}]}]}]}.
Rules:
- One subject per actual course; if only one course appears, return exactly one subject.
- Units = chapters/modules/units named in the document. If none are named, put all topics in one unit called "Topics".
- Topics = teachable subtopics (1-5 words each). Do NOT invent topics that are not in the text.
- difficulty is 1 (easy) to 5 (hard) — your best guess from the topic's level.
- Drop page numbers, headers, grading policies, instructor info, schedules.
- Max 8 subjects, 10 units per subject, 40 topics per unit. Keep the original order.`;

/* ── Heuristic fallback ─────────────────────────────────────── */

// Matches "Unit 1", "UNIT-I", "Module 2 - ...", "Chapter III: ..." —
// the separator between keyword and numeral is optional so compact
// Indian-university headings (UNIT-I) parse like spaced ones (Unit 1).
const UNIT_HEADING = /^\s*\b(unit|module|chapter|part|section)\s*[-–—:.]?\s*(\d{1,2}|[ivx]{1,4})\b\s*[:.\-–—]?\s*(.{0,100})$/i;

/** Topic lines to ignore (policy/meta noise common in syllabi). */
const NOISE =
  /(credit|grade|grading|attendance|exam date|instructor|office hours|e-?mail|@|phone|policy|prerequisite|textbook|reference|assessment|marks|weightage|schedule|week\s*\d|http|www\.|\bpage\b)/i;

function cleanTopic(line: string): string | null {
  let s = line.trim();
  // strip common list decorations
  s = s.replace(/^[-•*–—>#]+\s*/, "").replace(/^\(?\d{1,2}[.)]\s*/, "").replace(/\s{2,}/g, " ");
  if (s.length < 3 || s.length > 90) return null;
  if (NOISE.test(s)) return null;
  if (!/[a-zA-Z]{3}/.test(s)) return null; // must contain words
  if (/^(syllabus|course|contents|table of)/i.test(s)) return null;
  return s.slice(0, 90);
}

/**
 * Deterministic parse for recognizable layouts. Never throws —
 * worst case it returns nothing and the caller reports honestly.
 */
export function heuristicParse(text: string): ParsedSyllabus | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const units: { name: string; topics: ParsedTopic[] }[] = [];
  let current: { name: string; topics: ParsedTopic[] } | null = null;

  for (const line of lines) {
    if (!line) continue;
    const m = line.match(UNIT_HEADING);
    if (m) {
      const label = m[3]?.trim() ? `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}: ${cleanTopic(m[3]) ?? ""}`.replace(/[:\s]+$/, "") : `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`;
      current = { name: label.slice(0, 120), topics: [] };
      units.push(current);
      continue;
    }
    if (NOISE.test(line)) continue;
    const topic = cleanTopic(line);
    if (!topic) continue;
    // A line that itself is a unit-like heading without the regex match
    // (e.g. "Unit III - Trees") was already caught above; anything else
    // is treated as a topic of the current unit.
    if (!current) {
      current = { name: "Topics", topics: [] };
      units.push(current);
    }
    if (current.topics.length < 40) current.topics.push({ name: topic, difficulty: 3 });
  }

  const meaningful = units.filter((u) => u.topics.length > 0);
  if (!meaningful.length) return null;
  const total = meaningful.reduce((a, u) => a + u.topics.length, 0);
  // Signal requirement: either the document has explicit unit structure,
  // or the topic list is long enough to actually be a syllabus — three
  // stray prose lines must not become a curriculum.
  const hasHeadings = !(units.length === 1 && units[0].name === "Topics");
  if (!hasHeadings && total < 8) return null;
  if (total < 1) return null;
  return { subjects: [{ name: "Imported syllabus", units: meaningful.slice(0, 10) }] };
}

/* ── Main entry ─────────────────────────────────────────────── */

export async function parseSyllabusText(
  text: string,
  opts?: { defaultSubjectName?: string },
): Promise<SyllabusParseResult> {
  const trimmed = text.trim();
  if (trimmed.length < 40) {
    return {
      syllabus: { subjects: [] },
      source: "heuristic",
      warning: "The document has too little readable text to structure. Try a text-based PDF or paste topics manually.",
    };
  }

  const provider = getAiProvider();
  if (provider.available()) {
    try {
      const payload = trimmed.slice(0, 18_000);
      const parsed = (await askForJson(provider, AI_SYSTEM, payload, ParsedSyllabusSchema)) as ParsedSyllabus;
      if (parsed.subjects.length > 0) {
        const defaultName = opts?.defaultSubjectName;
        const named = defaultName
          ? {
              ...parsed,
              subjects: parsed.subjects.map((s, i) =>
                i === 0 && /^(imported|untitled|unknown)/i.test(s.name) ? { ...s, name: defaultName } : s,
              ),
            }
          : parsed;
        return { syllabus: named, source: "ai" };
      }
    } catch {
      // fall through to the heuristic parser
    }
  }

  const heuristic = heuristicParse(trimmed);
  if (heuristic) {
    const defaultName = opts?.defaultSubjectName;
    const named = defaultName
      ? { subjects: heuristic.subjects.map((s) => ({ ...s, name: defaultName })) }
      : heuristic;
    return {
      syllabus: named,
      source: "heuristic",
      warning: provider.available()
        ? undefined
        : "Parsed with the built-in engine (no AI key connected) — review the topics below before importing.",
    };
  }

  return {
    syllabus: { subjects: [] },
    source: "heuristic",
    warning: "Couldn't recognize a syllabus structure in this document. You can still add subjects and topics manually.",
  };
}
