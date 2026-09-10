/* ──────────────────────────────────────────────────────────────
   Quote of the Day — curated static pool (no AI, no API, no DB).

   Selection: exclude recently shown ids, pick randomly from the rest,
   fall back to the full pool when everything is recent. Pure and
   unit-tested; persistence (localStorage/sessionStorage) lives in the
   component so a storage failure can never break the dashboard.
   ────────────────────────────────────────────────────────────── */

export type QuoteVariant = "leaf-right" | "leaf-left" | "sprig-bottom";

export type DayQuote = {
  id: string;
  text: string;
  category: string;
  variant: QuoteVariant;
};

export const QUOTES: DayQuote[] = [
  { id: "focus-01", text: "A focused hour today can make tomorrow feel much easier.", category: "focus", variant: "leaf-right" },
  { id: "focus-02", text: "Attention is a skill. Every undistracted session trains it.", category: "focus", variant: "leaf-left" },
  { id: "focus-03", text: "One topic, full attention, no tabs. That is the whole trick.", category: "focus", variant: "sprig-bottom" },
  { id: "consistency-01", text: "Study a little, understand deeply, and repeat tomorrow.", category: "consistency", variant: "leaf-left" },
  { id: "consistency-02", text: "Discipline grows quietly through the things you choose to do every day.", category: "consistency", variant: "leaf-right" },
  { id: "consistency-03", text: "Small sessions compound. Showing up is the strategy.", category: "consistency", variant: "sprig-bottom" },
  { id: "planning-01", text: "Don't wait for motivation. Start with a small plan and let progress create it.", category: "planning", variant: "leaf-right" },
  { id: "planning-02", text: "A clear plan turns a difficult study session into one small step at a time.", category: "planning", variant: "leaf-left" },
  { id: "planning-03", text: "Plan tonight's session in two minutes and tomorrow starts itself.", category: "planning", variant: "sprig-bottom" },
  { id: "exam-01", text: "Exams reward steady weeks, not heroic nights.", category: "exam preparation", variant: "leaf-left" },
  { id: "exam-02", text: "Revise like you'll teach it — exams can tell the difference.", category: "exam preparation", variant: "leaf-right" },
  { id: "confidence-01", text: "You don't need to finish everything today. You just need to move forward.", category: "confidence", variant: "sprig-bottom" },
  { id: "confidence-02", text: "Confusion is the doorway. Walk through it slowly and it opens.", category: "confidence", variant: "leaf-left" },
  { id: "learning-01", text: "Your future self benefits from every page you understand today.", category: "learning", variant: "leaf-right" },
  { id: "learning-02", text: "Understanding beats memorizing — ask why until it clicks.", category: "learning", variant: "sprig-bottom" },
  { id: "learning-03", text: "Mistakes in practice are tuition you never have to pay twice.", category: "learning", variant: "leaf-left" },
  { id: "discipline-01", text: "Start before you feel ready. Readiness follows action.", category: "discipline", variant: "leaf-right" },
  { id: "discipline-02", text: "Put the phone in another room. Your focus will thank you.", category: "discipline", variant: "leaf-left" },
  { id: "progress-01", text: "Done is a direction, not a destination. Keep walking.", category: "progress", variant: "sprig-bottom" },
  { id: "progress-02", text: "Compare yourself to last week's notes, not to anyone else.", category: "progress", variant: "leaf-right" },
  { id: "time-01", text: "Twenty-five honest minutes beat two distracted hours.", category: "time management", variant: "leaf-left" },
  { id: "time-02", text: "Give every session one job. Multitasking is just quitting slowly.", category: "time management", variant: "leaf-right" },
  { id: "persist-01", text: "Hard topics soften on the third visit. Come back once more.", category: "persistence", variant: "sprig-bottom" },
  { id: "persist-02", text: "Procrastination shrinks the moment you open the first page.", category: "persistence", variant: "leaf-left" },
];

export const RECENT_LIMIT = 8;

export function pickQuote(history: string[], random: () => number = Math.random): DayQuote {
  const recent = new Set(history.slice(-RECENT_LIMIT));
  const fresh = QUOTES.filter((q) => !recent.has(q.id));
  const pool = fresh.length > 0 ? fresh : QUOTES;
  const fallback = QUOTES[0]!;
  const chosen = pool[Math.floor(random() * pool.length)] ?? fallback;
  return chosen;
}
