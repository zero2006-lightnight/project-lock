/* ──────────────────────────────────────────────────────────────
   G-o1 request router (pure — no browser APIs, fully unit-tested).

   Transcribed speech → one discriminated intent. Rules:
   - Navigation: known destinations → existing routes.
   - Destructive verbs ALWAYS need explicit confirmation, even when
     the rest of the request is unambiguous.
   - Generation extracts difficulty + unit number where present.
   - Only stable final transcripts reach this router (the provider
     never routes interim results), and every routed request carries
     a unique requestId for idempotent execution.
   ────────────────────────────────────────────────────────────── */

export type VoiceContext = {
  /** Current route, e.g. "/app/syllabus" — for "this"/"here" resolution. */
  pathname: string;
  /** Known subject names for disambiguation (display names). */
  subjectNames?: string[];
};

export type VoiceIntent =
  | { kind: "navigation"; route: string; label: string }
  | { kind: "info"; question: string }
  | { kind: "generation"; target: "quiz" | "flashcards" | "mindmap"; difficulty?: "easy" | "medium" | "hard"; unit?: number; topic?: string; route: string }
  | { kind: "control"; action: "stop" | "repeat" | "mute" | "unmute" | "help" }
  | { kind: "confirm"; value: boolean }
  | { kind: "destructive"; action: string; needsConfirm: true }
  | { kind: "ambiguous"; prompt: string }
  | { kind: "unknown" }
  | { kind: "task"; action: "create" | "complete"; details: string; date?: string; priority?: number; duration?: number }
  | { kind: "planning"; action: "regenerate" | "reschedule" | "skip"; details?: string; date?: string }
  | { kind: "notification"; message: "read" };

export type RoutedRequest = { requestId: string; intent: VoiceIntent; transcript: string };

const DESTINATIONS: { route: string; label: string; keys: RegExp }[] = [
  { route: "/app", label: "Dashboard", keys: /\b(dashboard|home)\b/ },
  { route: "/app/today", label: "Today's plan", keys: /\b(today'?s plan|today'?s tasks|my day|plan my day)\b/ },
  { route: "/app/syllabus", label: "Syllabus", keys: /\b(syllabus|subjects|topics)\b/ },
  { route: "/app/exams", label: "Exams", keys: /\b(exams?|tests?|mid[ -]?terms?|finals?)\b/ },
  { route: "/app/tasks", label: "Tasks", keys: /\b(tasks?|to-?dos?|assignments?)\b/ },
  { route: "/app/calendar", label: "Calendar", keys: /\b(calendar|schedule)\b/ },
  { route: "/app/focus", label: "Focus mode", keys: /\b(focus|pomodoro|timer|start (a )?focus)\b/ },
  { route: "/app/chat", label: "Pilot", keys: /\b(pilot|chat|assistant)\b/ },
  { route: "/app/flashcards", label: "Flashcards", keys: /\b(flashcards?|flash cards?|decks?)\b/ },
  { route: "/app/mindmaps", label: "Mind maps", keys: /\b(mind ?maps?)\b/ },
  { route: "/app/progress", label: "Progress", keys: /\b(progress|analytics|stats|statistics|how am i doing|on track)\b/ },
  { route: "/app/achievements", label: "Achievements", keys: /\b(achievements?|badges?|trophies|streak)\b/ },
  { route: "/app/settings", label: "Settings", keys: /\b(settings?|preferences)\b/ },
];

const NAV_VERBS = /\b(open|go to|take me to|show me|navigate to|switch to)\b/;
const DESTRUCTIVE = /\b(delete|remove|erase|clear|reset|overwrite|replace|drop)\b/;
const CONFIRM_YES = /^\s*(yes|yeah|yep|confirm|confirmed|proceed|do it|go ahead)\b/;
const CONFIRM_NO = /^\s*(no|nope|cancel|never mind|stop|don't)\b/;
const DIFFICULTY: { key: "easy" | "medium" | "hard"; re: RegExp }[] = [
  { key: "easy", re: /\b(easy|simple|basic)\b/ },
  { key: "hard", re: /\b(hard|difficult|tough|challenging)\b/ },
  { key: "medium", re: /\b(medium|moderate|intermediate)\b/ },
];
const GENERATION_ROUTE = { quiz: "/app/exams", flashcards: "/app/flashcards", mindmap: "/app/mindmaps" } as const;

export function newRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function extractUnit(text: string): number | undefined {
  const m = text.match(/\bunit\s+(\d{1,2})\b/);
  return m ? Number(m[1]) : undefined;
}

function extractDate(text: string): string | undefined {
  const base = new Date();
  if (/\btoday\b/.test(text)) return base.toISOString().slice(0, 10);
  if (/\btomorrow\b/.test(text)) {
    base.setDate(base.getDate() + 1);
    return base.toISOString().slice(0, 10);
  }
  const weekday = text.match(/\b(mon|tue|wed|thu|fri|sat|sun)(?:day)?\b/);
  if (!weekday) return undefined;
  const names = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const target = names.indexOf(weekday[1]!);
  const delta = (target - base.getDay() + 7) % 7 || 7;
  base.setDate(base.getDate() + delta);
  return base.toISOString().slice(0, 10);
}

function extractPriority(text: string): number | undefined {
  if (/\b(high|urgent|important)\b/.test(text)) return 3;
  if (/\b(low|minor)\b/.test(text)) return 1;
  if (/\b(medium|normal)\b/.test(text)) return 2;
  return undefined;
}

function extractDuration(text: string): number | undefined {
  const match = text.match(/\b(\d+)\s*(minutes?|mins?|hours?|hrs?)\b/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  return /hour|hr/.test(match[2]!) ? amount * 60 : amount;
}

export function parseVoiceIntent(raw: string, ctx: VoiceContext): VoiceIntent {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return { kind: "unknown" };
  const lower = text.toLowerCase();

  // 1. Interruption / playback controls (exact scope: speech only).
  if (/^\s*(stop|be quiet|quiet|cancel|wait|hold on)\s*[.!?]*\s*$/i.test(text)) return { kind: "control", action: "stop" };
  if (/\b(repeat (that|it)|say (that|it) again|read it again)\b/.test(lower)) return { kind: "control", action: "repeat" };
  if (/\b(mute|silence|turn off (your )?voice)\b/.test(lower)) return { kind: "control", action: "mute" };
  if (/\b(unmute|turn on (your )?voice|speak again)\b/.test(lower)) return { kind: "control", action: "unmute" };
  if (/^\s*(help|what can you do)\s*[.!?]*\s*$/i.test(text)) return { kind: "control", action: "help" };

  // 2. Confirmation answers (handled by the provider's pending-confirm flow).
  if (CONFIRM_YES.test(lower)) return { kind: "confirm", value: true };
  if (CONFIRM_NO.test(lower)) return { kind: "confirm", value: false };

  // 3. Destructive actions NEVER execute directly.
  if (DESTRUCTIVE.test(lower)) return { kind: "destructive", action: text, needsConfirm: true };

  if (/\b(mark|set)\b.*\b(completed|complete|done)\b/.test(lower) && /\b(task|assignment|todo)\b/.test(lower)) {
    return { kind: "task", action: "complete", details: text.replace(/\b(mark|set)\b.*\b(completed|complete|done)\b/i, "").replace(/\b(task|assignment|todo)\b/i, "").trim() };
  }
  if (/\b(regenerate|rebuild|refresh)\b.*\b(plan|schedule|today)\b/.test(lower)) return { kind: "planning", action: "regenerate" };
  if (/\b(reschedule|redistribute)\b.*\b(missed|missed sessions|missed blocks)\b/.test(lower)) return { kind: "planning", action: "reschedule" };
  if (/\b(mark all|clear|read)\b.*\bnotifications?\b|\bnotifications?\b\s+(as\s+)?read\b/.test(lower)) return { kind: "notification", message: "read" };
  if (/\b(skip)\b.*\b(session|block)\b/.test(lower)) return { kind: "planning", action: "skip", details: text };
  if (/\b(create|add|make)\b.*\b(task|assignment|todo|project|lab)\b/.test(lower)) {
    const kind = /\bquiz\b/.test(lower) ? "quiz" : /\bproject\b/.test(lower) ? "project" : /\blab\b/.test(lower) ? "lab" : "assignment";
    return { kind: "task", action: "create", details: text, date: extractDate(lower), priority: extractPriority(lower), duration: extractDuration(lower) };
  }

  // 4. Generation requests (quiz / flashcards / mind map).
  const wantsQuiz = /\b(quiz|test me|practice questions?)\b/.test(lower);
  const wantsCards = /\b(flashcards?|flash cards?)\b/.test(lower);
  const wantsMap = /\b(mind ?maps?)\b/.test(lower);
  if (wantsQuiz || wantsCards || wantsMap) {
    const target = wantsQuiz ? "quiz" : wantsCards ? "flashcards" : "mindmap";
    const genVerb = /\b(create|generate|make|build|give|start)\b/.test(lower);
    if (genVerb || wantsQuiz) {
      const difficulty = DIFFICULTY.find((d) => d.re.test(lower))?.key;
      const unit = extractUnit(lower);
      // Unscoped request + several subjects → ask, never guess.
      if (!unit && (ctx.subjectNames?.length ?? 0) > 1) {
        const scopeNoun = target === "quiz" ? "quiz" : target === "flashcards" ? "flashcards" : "mind map";
        return { kind: "ambiguous", prompt: `Which subject would you like the ${scopeNoun} to cover?` };
      }
      return { kind: "generation", target, difficulty, unit, route: GENERATION_ROUTE[target] };
    }
  }

  // 5. Navigation ("open X", "go to Y", "show me Z").
  if (NAV_VERBS.test(lower)) {
    for (const d of DESTINATIONS) {
      if (d.keys.test(lower)) return { kind: "navigation", route: d.route, label: d.label };
    }
  }
  // Bare destination mention ("exams", "my progress") also navigates.
  for (const d of DESTINATIONS) {
    if (d.keys.test(lower) && /^(open|show|go|take|switch|view|see|my|the|)\b/.test(lower)) {
      // Avoid hijacking info questions that merely mention a destination.
      if (/\b(what|why|how|explain|when|which|who)\b/.test(lower)) break;
      return { kind: "navigation", route: d.route, label: d.label };
    }
  }

  // 6. Ambiguous generation without a resolvable subject.
  if (/\b(create|generate|make|build)\b/.test(lower) && (ctx.subjectNames?.length ?? 0) > 1) {
    return { kind: "ambiguous", prompt: "Which subject should I use?" };
  }

  // 7. Everything else is an information request for Pilot.
  // Guard: a bare "create a quiz" with several subjects asks first.
  if (/^\s*create a quiz\s*[.!?]*\s*$/i.test(text) && (ctx.subjectNames?.length ?? 0) > 1) {
    return { kind: "ambiguous", prompt: "Which subject would you like the quiz to cover?" };
  }
  return { kind: "info", question: text };
}
