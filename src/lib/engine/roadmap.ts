import { addDaysISO, dayLabel, daysUntil, parseISOStart, type ISODate } from "../dates";
import { dayCapacityMinutes, estimateRevisionMinutes, estimateTopicMinutes } from "./schedule";
import type { EngineAvailability, EngineExam, EngineSubject, EngineTopic } from "./types";

export type ExamPhase = {
  key: "learning" | "practice" | "revision" | "mock" | "rapid";
  name: string;
  from: ISODate;
  to: ISODate;
  description: string;
};

export type ExamReadiness = {
  examId: string;
  examName: string;
  examDate: ISODate;
  subjectId: string | null;
  subjectName: string | null;
  subjectColor: string | null;
  daysLeft: number;
  importance: number;
  /** share of syllabus weight completed (learning counts half) */
  syllabusPercent: number;
  /** 0..100 — syllabus done + whether remaining work fits the time left */
  readiness: number;
  remainingMinutes: number;
  capacityMinutes: number;
  recommendedSessions: number;
  weakTopics: { topicId: string; name: string; difficulty: number }[];
  phases: ExamPhase[];
};

type RoadmapInput = {
  exam: EngineExam;
  subject: EngineSubject | null;
  subjectColor: string | null;
  topics: EngineTopic[];
  availability: EngineAvailability;
  today?: ISODate;
};

const PARTIAL_CREDIT: Record<EngineTopic["status"], number> = {
  not_started: 0,
  learning: 0.45,
  completed: 1,
  needs_revision: 1, // was completed; still flagged for review
};

export function examRoadmap(input: RoadmapInput): ExamReadiness {
  const { exam, subject, subjectColor, topics, availability } = input;
  const today: ISODate = input.today ?? new Date().toISOString().slice(0, 10);
  const daysLeft = Math.max(0, daysUntil(exam.date));

  const subjectTopics = subject ? topics.filter((t) => t.subjectId === subject.id) : topics;

  const totalWeight = subjectTopics.reduce((a, t) => a + t.weight, 0) || 1;
  const creditWeight = subjectTopics.reduce(
    (a, t) => a + t.weight * PARTIAL_CREDIT[t.status],
    0,
  );
  const syllabusPercent = Math.round((creditWeight / totalWeight) * 100);

  let remainingMinutes = 0;
  for (const t of subjectTopics) {
    if (t.status === "completed") continue;
    if (t.status === "needs_revision") {
      remainingMinutes += estimateRevisionMinutes(t.difficulty);
      continue;
    }
    const total = estimateTopicMinutes(t);
    remainingMinutes += t.status === "learning" ? Math.round(total * 0.55) : total;
  }

  // Capacity = schedulable minutes between today (inclusive) and the day before the exam.
  let capacityMinutes = 0;
  for (let i = 0; i < daysLeft; i++) {
    capacityMinutes += dayCapacityMinutes(availability, addDaysISO(i, today));
  }
  if (daysLeft === 0 && remainingMinutes > 0) capacityMinutes = 0;

  const feasibility = remainingMinutes > 0 ? Math.min(1, capacityMinutes / remainingMinutes) : 1;
  const readiness = Math.max(
    0,
    Math.min(99, Math.round(syllabusPercent + feasibility * (100 - syllabusPercent))),
  );

  const avgSession = 40;
  const recommendedSessions = Math.max(1, Math.ceil(remainingMinutes / avgSession));

  const weakTopics = subjectTopics
    .filter((t) => t.status === "needs_revision" || (t.status === "learning" && t.difficulty >= 4))
    .sort((a, b) => b.difficulty - a.difficulty)
    .slice(0, 5)
    .map((t) => ({ topicId: t.id, name: t.name, difficulty: t.difficulty }));

  const phases = buildPhases(exam.date, today, daysLeft, remainingMinutes, syllabusPercent);
  void parseISOStart;

  return {
    examId: exam.id,
    examName: exam.name,
    examDate: exam.date,
    subjectId: subject?.id ?? null,
    subjectName: subject?.name ?? null,
    subjectColor,
    daysLeft,
    importance: exam.importance,
    syllabusPercent,
    readiness,
    remainingMinutes,
    capacityMinutes,
    recommendedSessions,
    weakTopics,
    phases,
  };
}

function buildPhases(
  examDate: ISODate,
  today: ISODate,
  daysLeft: number,
  remainingMinutes: number,
  syllabusPercent: number,
): ExamPhase[] {
  const fmt = (iso: ISODate) => dayLabel(iso);
  void fmt;

  const phases: ExamPhase[] = [];

  if (daysLeft <= 6) {
    phases.push(
      {
        key: "rapid",
        name: "Focused revision",
        from: today,
        to: addDaysISO(Math.max(0, daysLeft - 2), today),
        description: "Hit your weakest topics first — one pass per flagged area, alternating with practice questions.",
      },
      {
        key: "practice",
        name: "Practice & past papers",
        from: addDaysISO(Math.max(1, daysLeft - 1), today),
        to: addDaysISO(daysLeft - 1, today),
        description: "Work through past questions under exam conditions. Review mistakes the same evening.",
      },
      {
        key: "mock",
        name: "Final review",
        from: addDaysISO(Math.max(1, daysLeft - 1), today),
        to: examDate,
        description: "Light final sweep of formula sheets and summaries. Sleep well before the exam.",
      },
    );
    return phases.filter((p) => daysUntil(p.from) <= daysUntil(p.to));
  }

  if (daysLeft <= 13) {
    phases.push(
      {
        key: "learning",
        name: "Close remaining gaps",
        from: today,
        to: addDaysISO(Math.max(0, daysLeft - 5), today),
        description: "Learn any unfinished topics and rework flagged ones. Keep sessions short and frequent.",
      },
      {
        key: "practice",
        name: "Practice phase",
        from: addDaysISO(Math.max(0, daysLeft - 4), today),
        to: addDaysISO(Math.max(1, daysLeft - 2), today),
        description: "Switch to problem solving and past papers — this is where understanding sticks.",
      },
      {
        key: "revision",
        name: "Revision & mock",
        from: addDaysISO(Math.max(1, daysLeft - 2), today),
        to: examDate,
        description: "Timed mock, then a calm final review of summaries and common mistakes.",
      },
    );
    return phases;
  }

  void addDaysISO(daysLeft - 10, today);
  phases.push(
    {
      key: "learning",
      name: "Learning phase",
      from: today,
      to: addDaysISO(daysLeft - 10, today),
      description:
        syllabusPercent >= 80
          ? "Syllabus is mostly covered — spend this window deepening weak topics and building notes."
          : "Learn remaining topics steadily. The planner spreads them across your available hours.",
    },
    {
      key: "practice",
      name: "Practice phase",
      from: addDaysISO(Math.max(1, daysLeft - 10), today),
      to: addDaysISO(Math.max(2, daysLeft - 4), today),
      description: "Past papers, problem sets and active recall on everything learned so far.",
    },
    {
      key: "revision",
      name: "Revision phase",
      from: addDaysISO(Math.max(2, daysLeft - 4), today),
      to: addDaysISO(Math.max(3, daysLeft - 2), today),
      description: "Compress notes into summaries; revise flagged topics; clear remaining doubts.",
    },
    {
      key: "mock",
      name: "Mock & final review",
      from: addDaysISO(Math.max(3, daysLeft - 2), today),
      to: examDate,
      description: "One timed mock test, then light final revision. Rest before exam day.",
    },
  );
  return phases;
}

export { daysUntil };
