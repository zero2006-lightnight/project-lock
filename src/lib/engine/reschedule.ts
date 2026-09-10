import { addDaysISO, dayLabel, parseISOStart, type ISODate } from "../dates";
import { dayCapacityMinutes, planChunkMinutes, preferredWindowOrder } from "./schedule";
import type { EngineAvailability, EnginePlanBlock } from "./types";

export type MissedBlock = {
  planItemId: string;
  topicId: string | null;
  subjectId: string | null;
  date: ISODate;
  minutes: number;
  title: string;
};

export type ExistingPlanSummary = {
  date: ISODate;
  /** minutes of study blocks already planned for the date */
  usedMinutes: number;
  /** minute-of-day where the last planned block ends (-1 when empty) */
  lastEndMinutes: number;
  /** topics already occupying the date (avoid stacking identical topics) */
  topicKeys: Set<string>;
};

export type RedistributeInput = {
  missed: MissedBlock[];
  availability: EngineAvailability;
  existing: Map<ISODate, ExistingPlanSummary>;
  /** how many future days to spread the load over */
  spreadDays?: number;
  subjectMeta: Record<string, { name: string; color: string }>;
  fromDate?: ISODate;
};

export type RedistributeResult = {
  blocks: EnginePlanBlock[];
  /** human explanation per topic: "Missed Monday → moved to Tuesday + Wednesday" */
  summary: { topicId: string; topicTitle: string; movedTo: ISODate[]; reason: string }[];
  /** blocks that could not be placed anywhere within the spread window */
  dropped: MissedBlock[];
};

const FALLBACK_WINDOWS = [
  { key: "morning", start: 8 * 60, end: 12 * 60 },
  { key: "afternoon", start: 12 * 60, end: 17 * 60 },
  { key: "evening", start: 17 * 60, end: 21 * 60 },
  { key: "night", start: 21 * 60, end: 23 * 60 + 30 },
];

/**
 * Missed work is redistributed — never silently dropped, never dumped as a
 * punishing double-session. Each missed block is spread across the next few
 * days that still have spare capacity, at most one session per topic per day,
 * and never beyond the student's stated daily availability.
 */
export function redistributeMissed(input: RedistributeInput): RedistributeResult {
  const {
    missed,
    availability,
    existing,
    spreadDays = 3,
    subjectMeta,
    fromDate = new Date().toISOString().slice(0, 10),
  } = input;

  const style = availability.sessionStyle || "mixed";
  const blocks: EnginePlanBlock[] = [];
  const summary: RedistributeResult["summary"] = [];
  const dropped: MissedBlock[] = [];

  const windows = [...preferredWindowOrder(availability.preferredTimes)]
    .map((k) => FALLBACK_WINDOWS.find((w) => w.key === k)!)
    .sort((a, b) => a.start - b.start);

  // Remaining capacity per future date after existing plan is respected.
  const capacity = new Map<ISODate, number>();
  const topicByDate = new Map<ISODate, Set<string>>();
  for (let i = 0; i < Math.max(spreadDays, 2); i++) {
    const date = addDaysISO(i, fromDate);
    const ex = existing.get(date);
    capacity.set(date, Math.max(0, dayCapacityMinutes(availability, date) - (ex?.usedMinutes ?? 0)));
    topicByDate.set(date, new Set(ex?.topicKeys ?? []));
  }

  // Group by topic (or by task title when no topic) so multi-part misses spread evenly.
  const byTopic = new Map<string, MissedBlock[]>();
  for (const m of missed) {
    const key = m.topicId ?? `task:${m.title}`;
    byTopic.set(key, [...(byTopic.get(key) ?? []), m]);
  }

  const shortDay = (iso: ISODate) => dayLabel(iso).split(",")[0];

  for (const [key, group] of byTopic) {
    const first = group[0];
    let remaining = group.reduce((a, b) => a + b.minutes, 0);
    const movedTo: ISODate[] = [];
    const lastEndByDate = new Map<ISODate, number>();
    for (const [d, ex] of existing) lastEndByDate.set(d, ex.lastEndMinutes);

    for (const date of [...capacity.keys()].sort()) {
      if (remaining < 15) break;
      const cap = capacity.get(date)!;
      if (cap < 15) continue;

      const occupied = topicByDate.get(date)!;
      if (occupied.has(key)) continue;

      const chunk = Math.min(planChunkMinutes(style, 3), remaining, cap);
      if (chunk < 15) continue;

      const start = findSlot(date, chunk, lastEndByDate.get(date) ?? -1, windows);
      if (start === null) continue;

      const subject = first.subjectId ? subjectMeta[first.subjectId] : undefined;
      blocks.push({
        date,
        startMinutes: start,
        durationMinutes: chunk,
        kind: "study",
        subjectId: first.subjectId,
        subjectName: subject?.name ?? null,
        subjectColor: subject?.color ?? null,
        topicId: first.topicId,
        topicName: first.topicId ? null : null,
        title: first.topicId ? null : first.title,
        reason: `Missed ${shortDay(first.date)} — redistributed`,
        origin: "rescheduled",
      });

      capacity.set(date, cap - chunk);
      occupied.add(key);
      topicByDate.set(date, occupied);
      lastEndByDate.set(date, start + chunk);
      remaining -= chunk;
      movedTo.push(date);
    }

    if (!movedTo.length) {
      dropped.push(...group);
      continue;
    }

    summary.push({
      topicId: first.topicId ?? "",
      topicTitle: first.topicId ? first.title || "topic" : first.title,
      movedTo,
      reason:
        remaining < 15
          ? `${shortDay(first.date)} → ${movedTo.map(shortDay).join(" + ")}`
          : `Partly moved (${Math.round(remaining)}m still queued)`,
    });
  }

  return { blocks, summary, dropped };
}

function findSlot(
  date: ISODate,
  chunk: number,
  lastEnd: number,
  windows: { start: number; end: number }[],
): number | null {
  void date;
  for (const w of windows) {
    const candidate = Math.max(w.start, lastEnd + 5);
    if (candidate + chunk <= w.end) return candidate;
  }
  // No preferred window fits; allow a late slot if the whole day still has room
  const dayEnd = 23 * 60 + 30;
  if (lastEnd + chunk <= dayEnd) return Math.max(lastEnd + 5, 8 * 60);
  return null;
}

export { dayCapacityMinutes, parseISOStart };
