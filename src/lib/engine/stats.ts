import { addDaysISO, daysUntil, type ISODate } from "../dates";

/** Days studied (as ISO set). Streak counts consecutive days ending today — a
 *  session today counts today, otherwise the streak is measured back from yesterday. */
export function currentStreak(activeDays: Set<ISODate>, today: ISODate): number {
  let streak = 0;
  let cursor = today;
  if (!activeDays.has(cursor)) cursor = addDaysISO(-1, cursor);
  while (activeDays.has(cursor)) {
    streak++;
    cursor = addDaysISO(-1, cursor);
  }
  return streak;
}

export function longestStreak(activeDays: Set<ISODate>): number {
  const days = [...activeDays].sort();
  let longest = 0;
  let run = 0;
  let prev: ISODate | null = null;
  for (const d of days) {
    if (prev && daysUntil(d) === daysUntil(prev) + 1) run++;
    else run = 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  return longest;
}

export type SessionSample = { startedAt: string; durationMinutes: number };

const HOUR_LABELS = [
  "12 AM", "1 AM", "2 AM", "3 AM", "4 AM", "5 AM", "6 AM", "7 AM", "8 AM", "9 AM", "10 AM", "11 AM",
  "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM", "6 PM", "7 PM", "8 PM", "9 PM", "10 PM", "11 PM",
];

/** Most productive contiguous 3-hour window based on recorded study minutes. */
export function productiveHourRange(sessions: SessionSample[]): {
  startHour: number;
  minutes: number;
  label: string;
} | null {
  if (!sessions.length) return null;
  const perHour = new Array<number>(24).fill(0);
  for (const s of sessions) {
    const h = new Date(s.startedAt).getHours();
    perHour[h] += s.durationMinutes;
  }
  let best = 0;
  let bestSum = -1;
  for (let start = 0; start < 24; start++) {
    const sum = perHour[start] + perHour[(start + 1) % 24] + perHour[(start + 2) % 24];
    if (sum > bestSum) {
      bestSum = sum;
      best = start;
    }
  }
  if (bestSum <= 0) return null;
  const endHour = (best + 2) % 24;
  const label =
    best === 0 && endHour === 2
      ? "12 AM – 2 AM"
      : `${HOUR_LABELS[best]} – ${HOUR_LABELS[endHour]}`;
  return { startHour: best, minutes: bestSum, label };
}

export function completionRate(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}
