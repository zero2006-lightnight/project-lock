import { describe, expect, it } from "vitest";
import {
  dayCapacityMinutes,
  estimateTopicMinutes,
  generateSchedule,
  planChunkMinutes,
  topicPriority,
  topicRemainingMinutes,
} from "@/lib/engine/schedule";
import { redistributeMissed } from "@/lib/engine/reschedule";
import { examRoadmap } from "@/lib/engine/roadmap";
import type { EngineAvailability, EngineExam, EngineSubject, EngineTopic } from "@/lib/engine/types";

const AVAIL: EngineAvailability = {
  weekdayHours: 3,
  weekendHours: 5,
  preferredTimes: ["evening", "morning"],
  sessionStyle: "mixed",
};

function topic(over: Partial<EngineTopic> & { id: string }): EngineTopic {
  return {
    subjectId: "s1",
    unitId: "u1",
    name: "T",
    difficulty: 3,
    weight: 1,
    status: "not_started",
    unitOrder: 0,
    topicOrder: 0,
    lastStudiedAt: null,
    ...over,
  };
}

function subject(id = "s1"): EngineSubject {
  return { id, name: "Subject", priority: 2, difficulty: 2 };
}

function exam(daysAhead: number, subjectId = "s1"): EngineExam {
  const d = new Date(Date.now() + daysAhead * 86400000);
  return {
    id: "e1",
    subjectId,
    name: "Exam",
    date: d.toISOString().slice(0, 10),
    importance: 3,
  };
}

describe("topicPriority", () => {
  it("boosts topics whose subject has a close exam", () => {
    const t = topic({ id: "t1" });
    const far = topicPriority(t, subject(), [exam(30)], );
    const close = topicPriority(t, subject(), [exam(5)]);
    expect(close).toBeGreaterThan(far);
  });

  it("treats needs_revision higher than learning, completed as zero", () => {
    const rev = topicPriority(topic({ id: "r", status: "needs_revision" }), subject(), []);
    const learn = topicPriority(topic({ id: "l", status: "learning" }), subject(), []);
    const done = topicPriority(topic({ id: "d", status: "completed" }), subject(), []);
    expect(rev).toBeGreaterThan(learn);
    expect(done).toBe(0);
  });

  it("cools down a topic studied within the last 2 days", () => {
    const fresh = topicPriority(
      topic({ id: "f", lastStudiedAt: new Date(Date.now() - 86400000).toISOString() }),
      subject(),
      [],
    );
    const stale = topicPriority(topic({ id: "s", lastStudiedAt: null }), subject(), []);
    expect(fresh).toBeLessThan(stale);
  });
});

describe("time estimates", () => {
  it("keeps topic minutes within sane bounds", () => {
    for (const d of [1, 2, 3, 4, 5]) {
      const m = estimateTopicMinutes({ difficulty: d, weight: 1 });
      expect(m).toBeGreaterThanOrEqual(30);
      expect(m).toBeLessThanOrEqual(240);
    }
  });

  it("remaining minutes shrink as topics progress", () => {
    const ns = topic({ id: "a" });
    const le = topic({ id: "b", status: "learning" });
    expect(topicRemainingMinutes(ns, 0)).toBeGreaterThan(topicRemainingMinutes(le, 0));
    expect(topicRemainingMinutes(ns, 9999)).toBe(0);
  });
});

describe("capacity & chunks", () => {
  it("gives weekends more capacity than weekdays", () => {
    const sat = dayCapacityMinutes(AVAIL, "2026-09-12"); // Saturday
    const tue = dayCapacityMinutes(AVAIL, "2026-09-08"); // Tuesday
    expect(sat).toBeGreaterThan(tue);
  });

  it("respects session style chunk sizes", () => {
    expect(planChunkMinutes("pomodoro", 3)).toBe(25);
    expect(planChunkMinutes("deep", 4)).toBe(90);
  });
});

describe("generateSchedule", () => {
  it("produces deterministic plans that respect the daily capacity", () => {
    const input = {
      subjects: [subject()],
      topics: [
        topic({ id: "a", difficulty: 3, status: "learning" }),
        topic({ id: "b", difficulty: 4, status: "not_started" }),
        topic({ id: "c", difficulty: 2, status: "not_started" }),
      ],
      exams: [exam(12)],
      tasks: [],
      availability: AVAIL,
      horizonDays: 7,
      subjectMeta: { s1: { id: "s1", name: "Subject", color: "#5753d4" } },
    };
    const a = generateSchedule(input);
    const b = generateSchedule(input);
    expect(a.days.length).toBeGreaterThan(0);
    expect(JSON.stringify(a.days)).toBe(JSON.stringify(b.days)); // deterministic

    for (const day of a.days) {
      const studyMin = day.blocks.filter((x) => x.kind !== "break").reduce((s, x) => s + x.durationMinutes, 0);
      expect(studyMin).toBeLessThanOrEqual(dayCapacityMinutes(AVAIL, day.date) + 1);
      // blocks must not overlap
      const sorted = [...day.blocks].sort((x, y) => x.startMinutes - y.startMinutes);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]!.startMinutes).toBeGreaterThanOrEqual(
          sorted[i - 1]!.startMinutes + sorted[i - 1]!.durationMinutes,
        );
      }
    }

    // every block has a reason
    for (const day of a.days) {
      for (const block of day.blocks) {
        if (block.kind !== "break") expect(block.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it("adds assignment blocks for tasks due within 3 days", () => {
    const input = {
      subjects: [subject()],
      topics: [topic({ id: "a", status: "learning" })],
      exams: [],
      tasks: [
        {
          id: "task1",
          subjectId: "s1",
          title: "Lab report",
          deadline: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
          status: "todo",
          estimatedMinutes: 60,
        },
      ],
      availability: AVAIL,
      horizonDays: 4,
      subjectMeta: { s1: { id: "s1", name: "Subject", color: "#5753d4" } },
    };
    const res = generateSchedule(input);
    const taskBlocks = res.days.flatMap((d) => d.blocks).filter((b) => b.title === "Lab report");
    expect(taskBlocks.length).toBeGreaterThan(0);
    expect(taskBlocks[0]!.reason).toContain("Due in");
  });
});

describe("redistributeMissed", () => {
  it("spreads missed work without exceeding capacity or duplicating topics per day", () => {
    const existing = new Map<string, ReturnType<typeof existingSummary>>();
    existing.set("2026-09-07", existingSummary(60, new Set()));
    const res = redistributeMissed({
      missed: [
        {
          planItemId: "p1",
          topicId: "t1",
          subjectId: "s1",
          date: "2026-09-06",
          minutes: 60,
          title: "",
        },
      ],
      availability: AVAIL,
      existing,
      spreadDays: 3,
      subjectMeta: { s1: { name: "Subject", color: "#5753d4" } },
      fromDate: "2026-09-07",
    });
    expect(res.blocks.length).toBeGreaterThan(0);
    const perDate = new Map<string, number>();
    for (const b of res.blocks) {
      perDate.set(b.date, (perDate.get(b.date) ?? 0) + b.durationMinutes);
    }
    for (const [date, used] of perDate) {
      const cap = dayCapacityMinutes(AVAIL, date);
      const existingUsed = existing.get(date)?.usedMinutes ?? 0;
      expect(existingUsed + used).toBeLessThanOrEqual(cap + 1);
    }
    // topic appears at most once per date
    const topicDays = res.blocks.filter((b) => b.topicId === "t1").map((b) => b.date);
    expect(new Set(topicDays).size).toBe(topicDays.length);
    expect(res.summary.length).toBe(1);
    expect(res.summary[0]!.reason).toContain("→");
  });
});

describe("examRoadmap", () => {
  it("builds a full phase plan with a capped readiness score", () => {
    const topics = [
      topic({ id: "t1", difficulty: 3, status: "completed" }),
      topic({ id: "t2", difficulty: 3, status: "learning" }),
      topic({ id: "t3", difficulty: 4, status: "not_started" }),
    ];
    const roadmap = examRoadmap({
      exam: exam(20),
      subject: subject(),
      subjectColor: "#5753d4",
      topics,
      availability: AVAIL,
      today: new Date().toISOString().slice(0, 10),
    });
    expect(roadmap.phases.length).toBeGreaterThanOrEqual(3);
    expect(roadmap.readiness).toBeGreaterThanOrEqual(0);
    expect(roadmap.readiness).toBeLessThanOrEqual(99);
    expect(roadmap.syllabusPercent).toBeGreaterThan(0);
    expect(roadmap.recommendedSessions).toBeGreaterThan(0);
    // syllabus percent reflects completed weight
    expect(roadmap.syllabusPercent).toBeLessThan(100);
  });

  it("handles a crash-course exam in 2 days", () => {
    const roadmap = examRoadmap({
      exam: exam(2),
      subject: subject(),
      subjectColor: null,
      topics: [topic({ id: "t1", status: "not_started" })],
      availability: AVAIL,
      today: new Date().toISOString().slice(0, 10),
    });
    expect(roadmap.daysLeft).toBeLessThanOrEqual(2);
    expect(roadmap.phases.every((p) => p.key === "rapid" || p.key === "practice" || p.key === "mock")).toBe(true);
  });
});

function existingSummary(usedMinutes: number, topicKeys: Set<string>) {
  return { date: "", usedMinutes, lastEndMinutes: -1, topicKeys };
}