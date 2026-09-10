import { addDaysISO, daysUntil, parseISOStart, type ISODate } from "../dates";
import type {
  EngineAvailability,
  EngineDayPlan,
  EngineExam,
  EnginePlanBlock,
  EngineSubject,
  EngineTopic,
  ScheduleInput,
  ScheduleResult,
} from "./types";

/* ──────────────────────────────────────────────────────────────
   Priority score — transparent, deterministic.
   score = statusBase * (0.42 + urgency + subjectWeight + difficulty + weakness)
           + freshness

   · statusBase    not_started 1.0 · needs_revision 0.92 · learning 0.82 · completed 0
   · urgency       scales with the closest exam (importance & proximity)
   · subjectWeight subject priority + difficulty
   · difficulty    harder topics surface slightly earlier so they get more passes
   · weakness      needs_revision topics get extra attention
   · freshness     recently studied cools down, stale topics heat up
   ────────────────────────────────────────────────────────────── */
export function topicPriority(
  topic: EngineTopic,
  subject: EngineSubject | undefined,
  exams: EngineExam[],
): number {
  const statusBase =
    topic.status === "completed"
      ? 0
      : topic.status === "not_started"
        ? 1.0
        : topic.status === "needs_revision"
          ? 0.92
          : 0.82;

  const subjectExams = exams.filter((e) => e.subjectId === topic.subjectId && daysUntil(e.date) >= 0);
  let urgency = 0;
  if (subjectExams.length) {
    const closest = [...subjectExams].sort((a, b) => a.date.localeCompare(b.date))[0];
    const d = Math.max(1, daysUntil(closest.date));
    urgency = 0.34 * (closest.importance / 3) * (1 / (1 + d / 16));
  }

  const subjWeight = subject ? (subject.priority / 3) * 0.2 + (subject.difficulty / 3) * 0.08 : 0.12;
  const difficulty = 0.06 * ((topic.difficulty - 1) / 4);
  const weakness = topic.status === "needs_revision" ? 0.12 : 0;

  let freshness = 0;
  if (topic.lastStudiedAt) {
    const daysSince = Math.max(0, daysUntil(topic.lastStudiedAt.slice(0, 10)) * -1);
    if (daysSince <= 2) freshness = -0.18;
    else if (daysSince <= 7) freshness = 0.02;
    else freshness = 0.1;
  }

  return Math.max(0, statusBase * (0.42 + urgency + subjWeight + difficulty + weakness) + freshness);
}

/** Estimated first-pass minutes a topic needs before it can be considered done. */
export function estimateTopicMinutes(topic: Pick<EngineTopic, "difficulty" | "weight">): number {
  const base = 30 + topic.difficulty * 22;
  const weightAdj = (topic.weight - 1) * 40;
  return Math.round(Math.min(240, Math.max(30, base + weightAdj)));
}

/** Revision minutes for a topic that needs refreshing before an exam. */
export function estimateRevisionMinutes(difficulty: number): number {
  return Math.min(45, 15 + difficulty * 5);
}

/** Minutes still needed for a topic (respects how far along it is). */
export function topicRemainingMinutes(topic: EngineTopic, alreadyPlanned: number): number {
  if (topic.status === "completed") return 0;
  if (topic.status === "needs_revision") {
    return Math.max(0, estimateRevisionMinutes(topic.difficulty) - alreadyPlanned);
  }
  const total = estimateTopicMinutes(topic);
  const needed = topic.status === "learning" ? Math.round(total * 0.55) : total;
  return Math.max(0, needed - alreadyPlanned);
}

/* ──────────────────────────────────────────────────────────────
   Windows & chunk sizing
   ────────────────────────────────────────────────────────────── */
type Window = { key: string; start: number; end: number; label: string };

const WINDOWS: Record<string, Window> = {
  morning: { key: "morning", start: 8 * 60, end: 12 * 60, label: "Morning" },
  afternoon: { key: "afternoon", start: 12 * 60, end: 17 * 60, label: "Afternoon" },
  evening: { key: "evening", start: 17 * 60, end: 21 * 60, label: "Evening" },
  night: { key: "night", start: 21 * 60, end: 23 * 60 + 30, label: "Night" },
};

const DEFAULT_ORDER = ["morning", "afternoon", "evening", "night"] as const;

/**
 * Preferred windows first (kept in the user's own order), remaining windows
 * appended chronologically as overflow so capacity can still be used when the
 * preferred slots are too short for the available hours.
 */
export function preferredWindowOrder(preferred: string[]): string[] {
  if (!preferred.length) return [...DEFAULT_ORDER];
  const known = preferred.filter((p) => p in WINDOWS);
  const rest = DEFAULT_ORDER.filter((w) => !known.includes(w));
  return [...known, ...rest];
}

export function planChunkMinutes(style: string, difficulty: number): number {
  switch (style) {
    case "short":
      return Math.min(30, 24 + difficulty * 2);
    case "pomodoro":
      return 25;
    case "deep":
      return difficulty >= 4 ? 90 : 60;
    case "mixed":
    default:
      return difficulty >= 4 ? 55 : 40;
  }
}

function breakAfterMinutes(style: string, chunk: number): number {
  if (style === "pomodoro") return 5;
  if (style === "deep") return chunk >= 75 ? 15 : 10;
  return chunk >= 60 ? 10 : 5;
}

export function dayCapacityMinutes(availability: EngineAvailability, date: ISODate): number {
  const dow = parseISOStart(date).getDay(); // 0 = Sunday
  const isWeekend = dow === 0 || dow === 6;
  const hours = isWeekend ? availability.weekendHours : availability.weekdayHours;
  // ~92% of stated availability is schedulable; the rest stays as a real-life buffer
  return Math.max(0, Math.round(hours * 60 * 0.92));
}

/* ──────────────────────────────────────────────────────────────
   Daily scheduler — greedy + round-robin, fully deterministic.
   ────────────────────────────────────────────────────────────── */
type WorkTopic = {
  topic: EngineTopic;
  subject: EngineSubject | undefined;
  remaining: number;
  priority: number;
};

export function generateSchedule(input: ScheduleInput): ScheduleResult {
  const { subjects, topics, exams, tasks, availability } = input;
  const horizon = Math.min(21, Math.max(3, input.horizonDays ?? 7));
  const fromDate: ISODate = input.fromDate ?? new Date().toISOString().slice(0, 10);

  const subjectMap = new Map(subjects.map((s) => [s.id, s]));
  const examList = [...exams].sort((a, b) => a.date.localeCompare(b.date));

  // Work queue from unfinished topics.
  const work: WorkTopic[] = topics
    .filter((t) => t.status !== "completed")
    .map((t) => ({
      topic: t,
      subject: subjectMap.get(t.subjectId),
      remaining: topicRemainingMinutes(t, 0),
      priority: topicPriority(t, subjectMap.get(t.subjectId), examList),
    }))
    .filter((w) => w.remaining > 0);

  // Recently missed items are folded back in with a boost so the student's most
  // recent unfinished work is never silently dropped.
  const missedMinutes = new Map<string, number>();
  for (const m of input.missed ?? []) {
    if (!m.topicId) continue;
    missedMinutes.set(m.topicId, (missedMinutes.get(m.topicId) ?? 0) + m.minutes);
  }
  for (const w of work) {
    const mm = missedMinutes.get(w.topic.id);
    if (mm) {
      w.remaining = Math.max(w.remaining, mm);
      w.priority = Math.min(1.25, w.priority + 0.22);
    }
  }

  // Assignment blocks for tasks due within 3 days.
  const taskBlocks = tasks
    .filter((t) => t.deadline && t.status !== "completed" && t.status !== "skipped")
    .map((t) => ({ task: t, daysLeft: daysUntil(t.deadline!) }))
    .filter((t) => t.daysLeft >= 0 && t.daysLeft <= 3);

  const style = availability.sessionStyle || "mixed";
  const windowOrder = preferredWindowOrder(availability.preferredTimes);
  const chronoWindows = [...windowOrder]
    .map((k) => WINDOWS[k])
    .sort((a, b) => a.start - b.start);

  const days: EngineDayPlan[] = [];
  const overflow: ScheduleResult["overflow"] = [];
  let scheduledWork = 0;
  const totalNeeded = work.reduce((a, w) => a + w.remaining, 0);

  const workLeft = () => work.some((w) => w.remaining > 0);
  const tasksLeft = () => taskBlocks.some((t) => t.task.estimatedMinutes > 15);

  for (let offset = 0; offset < horizon; offset++) {
    const date = addDaysISO(offset, fromDate);
    const cap = dayCapacityMinutes(availability, date);
    const blocks: EnginePlanBlock[] = [];
    let capLeft = cap;
    if (capLeft < 20) continue;

    // Rotating pick list: schedule the highest-priority topic, then move it to
    // the back so a single topic never monopolizes the whole day.
    const queue = [...work]
      .filter((w) => w.remaining > 0)
      .sort((a, b) => b.priority - a.priority || b.remaining - a.remaining);

    for (const win of chronoWindows) {
      if (capLeft < 15) break;
      let pos = win.start;

      let guard = 0;
      while (capLeft >= 15 && pos + 15 <= win.end && queue.length && guard++ < 500) {
        // candidate = first queued item whose chunk fits in the remaining window
        let idx = -1;
        for (let i = 0; i < queue.length; i++) {
          const chunk = Math.min(planChunkMinutes(style, queue[i].topic.difficulty), queue[i].remaining, capLeft);
          if (chunk >= 15 && pos + chunk <= win.end) {
            idx = i;
            break;
          }
        }
        if (idx === -1) break;

        const item = queue[idx];
        const chunk = Math.min(planChunkMinutes(style, item.topic.difficulty), item.remaining, capLeft);
        const subject = item.subject;
        const topic = item.topic;

        const closestExam = examList
          .filter((e) => e.subjectId === topic.subjectId && daysUntil(e.date) >= 0)
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        const d = closestExam ? daysUntil(closestExam.date) : null;
        const reason =
          topic.status === "needs_revision"
            ? "Needs revision"
            : d !== null && d <= 21
              ? `Exam in ${d} day${d === 1 ? "" : "s"} · ${closestExam!.name}`
              : subject && subject.priority >= 3
                ? "High-priority subject"
                : "Planned study";

        blocks.push({
          date,
          startMinutes: pos,
          durationMinutes: chunk,
          kind: topic.status === "needs_revision" ? "revision" : "study",
          subjectId: topic.subjectId,
          subjectName: subject?.name ?? null,
          subjectColor: input.subjectMeta[topic.subjectId]?.color ?? null,
          topicId: topic.id,
          topicName: topic.name,
          title: null,
          reason,
          origin: "planned",
        });

        pos += chunk;
        capLeft -= chunk;
        scheduledWork += chunk;
        item.remaining -= chunk;

        // Insert a break when it still fits in this window.
        const brk = breakAfterMinutes(style, chunk);
        if (pos + Math.min(brk, 10) <= win.end) {
          const actual = Math.min(brk, win.end - pos, capLeft || Infinity);
          if (actual >= 5) {
            blocks.push({
              date,
              startMinutes: pos,
              durationMinutes: actual,
              kind: "break",
              subjectId: null,
              subjectName: null,
              subjectColor: null,
              topicId: null,
              topicName: null,
              title: "Break",
              reason: "Reset and recharge",
              origin: "planned",
            });
            pos += actual;
          }
        }

        // rotate to keep days balanced across subjects
        queue.push(queue.splice(idx, 1)[0]);
      }
    }

    // Assignments near their deadline get a block too (kind study, no topic).
    for (const tb of taskBlocks) {
      if (tb.task.estimatedMinutes < 15 || capLeft < 15) continue;
      const dur = Math.min(tb.task.estimatedMinutes, 90, capLeft);
      // place after the last planned block of the day
      const lastEnd = blocks.length ? Math.max(...blocks.filter((b) => b.kind !== "break").map((b) => b.startMinutes + b.durationMinutes)) : 0;
      const slot = chronoWindows.find((w) => lastEnd + dur <= w.end) ?? chronoWindows[chronoWindows.length - 1];
      const start = Math.max(lastEnd, slot.start);
      if (start + dur > slot.end) continue;
      blocks.push({
        date,
        startMinutes: start,
        durationMinutes: dur,
        kind: "study",
        subjectId: tb.task.subjectId,
        subjectName: tb.task.subjectId ? input.subjectMeta[tb.task.subjectId]?.name ?? null : null,
        subjectColor: tb.task.subjectId ? input.subjectMeta[tb.task.subjectId]?.color ?? null : null,
        topicId: null,
        topicName: null,
        title: tb.task.title,
        reason: tb.daysLeft === 0 ? "Due today" : `Due in ${tb.daysLeft} day${tb.daysLeft === 1 ? "" : "s"}`,
        origin: "planned",
      });
      capLeft -= dur;
      tb.task.estimatedMinutes -= dur;
      scheduledWork += dur;
    }

    const studyBlocks = blocks.filter((b) => b.kind !== "break");
    if (studyBlocks.length) {
      days.push({
        date,
        totalMinutes: studyBlocks.reduce((a, b) => a + b.durationMinutes, 0),
        blocks: [...blocks].sort((a, b) => a.startMinutes - b.startMinutes),
      });
    }

    if (!workLeft() && !tasksLeft()) break;
  }

  for (const w of work) {
    if (w.remaining > 0) {
      overflow.push({ topicId: w.topic.id, name: w.topic.name, minutes: w.remaining, subjectId: w.topic.subjectId });
    }
  }

  const coveragePercent = totalNeeded > 0 ? Math.min(100, Math.round((scheduledWork / totalNeeded) * 100)) : 100;
  return { days, overflow, coveragePercent };
}
