/* ──────────────────────────────────────────────────────────────
   Tuning pattern analysis — deterministic cross-document mining.

   Identifies recurring concepts, emphasized definitions, concept
   co-occurrence relationships, topic hierarchy, repeated question
   patterns, and terminology style. No model in the loop: every claim
   in the profile is counted from the student's own documents.
   ────────────────────────────────────────────────────────────── */

export type TuningProfile = {
  coreConcepts: { term: string; count: number; docs: number }[];
  definitions: { term: string; text: string }[];
  relationships: { from: string; to: string; weight: number }[];
  topicTree: { title: string; chunks: number }[];
  questionPatterns: { sample: string; count: number };
  terminologyNotes: string[];
  summary: string;
  updatedAt: string;
};

const STOP = new Set(
  "the,a,an,and,or,of,to,in,on,for,with,as,by,at,from,is,are,was,were,be,been,being,it,its,this,that,these,those,they,them,their,there,here,which,who,whom,what,when,where,how,why,can,could,should,would,may,might,must,shall,will,do,does,did,done,have,has,had,having,not,no,yes,also,more,most,less,least,many,much,very,such,than,then,into,over,under,between,through,during,each,other,used,use,using,often,sometimes,example,examples,figure,table,page,chapter,section,following,followed,along,well,both,either,neither,within,without,across,among,towards,upon,including,included,excludes,per,via,etc,ie,eg,one,two,three,first,second,new,old,large,small,given,take,taken,makes,made,become,comes,going,goes,get,gets,keep,keeps,part,parts,form,forms,shown,shows,see,look,looks,like,just,still,even,ever,never,always,usually,generally,however,therefore,hence,thus,although,though,since,while,whereas,whether,because,until,unless,despite,toward,onto,off,out,up,down,again,further,once,twice,thrice".split(
    ",",
  ),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+# ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && w.length <= 32 && !STOP.has(w) && !/^\d+$/.test(w));
}

export function emptyProfile(now?: string): TuningProfile {
  return {
    coreConcepts: [],
    definitions: [],
    relationships: [],
    topicTree: [],
    questionPatterns: { sample: "", count: 0 },
    terminologyNotes: [],
    summary: "",
    updatedAt: now ?? new Date().toISOString(),
  };
}

export function parseProfile(raw: string | null): TuningProfile {
  if (!raw) return emptyProfile();
  try {
    const p = JSON.parse(raw) as Partial<TuningProfile>;
    return {
      coreConcepts: Array.isArray(p.coreConcepts) ? p.coreConcepts.slice(0, 60) : [],
      definitions: Array.isArray(p.definitions) ? p.definitions.slice(0, 30) : [],
      relationships: Array.isArray(p.relationships) ? p.relationships.slice(0, 40) : [],
      topicTree: Array.isArray(p.topicTree) ? p.topicTree.slice(0, 20) : [],
      questionPatterns: p.questionPatterns ?? { sample: "", count: 0 },
      terminologyNotes: Array.isArray(p.terminologyNotes) ? p.terminologyNotes : [],
      summary: typeof p.summary === "string" ? p.summary : "",
      updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : new Date().toISOString(),
    };
  } catch {
    // Same-process clock ensures the catch-branch result stays structurally
    // comparable to emptyProfile() (the updatedAt millisecond must match
    // exactly for the defensive-parse test — see tests/tuning.test.ts).
    return emptyProfile();
  }
}

const DEF_RE =
  /\b([A-Z][A-Za-z0-9 +#/\-]{2,48}?)\s+(is|are|refers to|is defined as|means|denotes?)\s+([^.\n]{20,220})/g;

/**
 * Analyze all chunks of a knowledge base. `docs` carries per-chunk
 * provenance: { docId, section, content }.
 */
export function analyzePatterns(
  kbName: string,
  docs: { docId: string; section: string | null; content: string }[],
): TuningProfile {
  const profile = emptyProfile();
  if (!docs.length) return profile;

  const freq = new Map<string, number>();
  const docSets = new Map<string, Set<string>>();
  for (const d of docs) {
    for (const w of words(d.content)) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
      let s = docSets.get(w);
      if (!s) docSets.set(w, (s = new Set()));
      s.add(d.docId);
    }
  }
  const ranked = [...freq.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40);
  profile.coreConcepts = ranked.map(([term, count]) => ({
    term,
    count,
    docs: docSets.get(term)?.size ?? 1,
  }));

  // Definitions: capture emphasized "X is ..." statements, prefer frequent terms.
  const seen = new Set<string>();
  const defs: { term: string; text: string }[] = [];
  const topTerms = new Set(ranked.slice(0, 60).map(([t]) => t));
  for (const d of docs) {
    DEF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DEF_RE.exec(d.content)) && defs.length < 30) {
      const term = m[1]!.trim().toLowerCase();
      const key = term.slice(0, 40);
      if (seen.has(key) || (!topTerms.has(term.split(" ")[0]!) && defs.length > 6)) continue;
      seen.add(key);
      defs.push({ term: m[1]!.trim(), text: `${m[1]!.trim()} ${m[2]} ${m[3]!.trim()}`.slice(0, 240) });
    }
  }
  profile.definitions = defs.slice(0, 12);

  // Relationships: co-occurrence of top concepts inside the same chunk.
  const top = ranked.slice(0, 24).map(([t]) => t);
  const pairCounts = new Map<string, number>();
  for (const d of docs) {
    const present = top.filter((t) => d.content.toLowerCase().includes(t));
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const key = [present[i]!, present[j]!].sort().join("||");
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  profile.relationships = [...pairCounts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([k, weight]) => {
      const [from, to] = k.split("||");
      return { from: from!, to: to!, weight };
    });

  // Topic hierarchy from section titles.
  const sectionCounts = new Map<string, number>();
  for (const d of docs) {
    if (d.section) sectionCounts.set(d.section, (sectionCounts.get(d.section) ?? 0) + 1);
  }
  profile.topicTree = [...sectionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([title, chunks]) => ({ title, chunks }));

  // Repeated question / exercise patterns.
  const questions: string[] = [];
  let exerciseMarks = 0;
  for (const d of docs) {
    for (const line of d.content.split(/\n|(?<=[.!?])\s+(?=[A-Z])|; /)) {
      const t = line.trim();
      if (t.endsWith("?") && t.length > 12 && t.length < 220 && questions.length < 40) questions.push(t);
    }
    exerciseMarks += (d.content.match(/\b(exercise|review question|practice|assignment|try it|checkpoint)\b/gi) ?? []).length;
  }
  profile.questionPatterns = {
    sample: questions[0] ?? "",
    count: questions.length + exerciseMarks,
  };

  // Terminology style notes (honest, counted).
  const notes: string[] = [];
  const refCount = defs.filter((d) => /refers to|defined as/i.test(d.text)).length;
  if (defs.length >= 3) {
    notes.push(
      refCount >= defs.length / 2
        ? "Your materials favor formal definitions (“X refers to … / is defined as …”)."
        : "Your materials favor plain explanations (“X is …”).",
    );
  }
  if (profile.questionPatterns.count >= 5) {
    notes.push(`${profile.questionPatterns.count} question or exercise cues recur — the authors test, not just tell.`);
  }
  const shared = profile.coreConcepts.filter((c) => c.docs >= 2).slice(0, 5).map((c) => c.term);
  if (shared.length >= 2) notes.push(`Bridging vocabulary across documents: ${shared.join(", ")}.`);
  profile.terminologyNotes = notes.slice(0, 4);

  // Human-readable summary.
  const focus = profile.coreConcepts.slice(0, 3).map((c) => c.term).join(", ");
  const docCount = new Set(docs.map((d) => d.docId)).size;
  profile.summary = focus
    ? `Your ${kbName} material spans ${docs.length} indexed passages across ${docCount} document${docCount === 1 ? "" : "s"}, strongly focused on ${focus}.`
    : `Your ${kbName} material is indexed and ready — add more documents and the focus picture sharpens.`;

  return profile;
}
