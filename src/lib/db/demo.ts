import { count, eq } from "drizzle-orm";
import { db, uid } from "@/lib/db";
import {
  exams,
  planItems,
  profiles,
  settings,
  studySessions,
  subjects,
  tasks,
  topics,
  units,
  users,
  type Subject,
  type Topic,
} from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { addDaysISO, todayISO } from "@/lib/dates";
import { ensurePlan } from "@/lib/services/plan";
import { refreshAchievements, createNotification } from "@/lib/services/achievements";

export const DEMO_EMAIL = "demo@studypilot.app";
export const DEMO_PASSWORD = "demo1234";

const now = () => new Date().toISOString();

type SeedSubject = {
  name: string;
  color: string;
  priority: number;
  difficulty: number;
  units: { name: string; topics: [string, number, TopicStatus, string?][] }[];
};

const TOPIC = (name: string, difficulty: number, status: TopicStatus, description?: string) =>
  [name, difficulty, status, description] as [string, number, TopicStatus, string?];

type TopicStatus = "not_started" | "learning" | "completed" | "needs_revision";

const CURRICULUM: SeedSubject[] = [
  {
    name: "Data Structures & Algorithms",
    color: "#5753d4",
    priority: 3,
    difficulty: 3,
    units: [
      {
        name: "Foundations",
        topics: [
          TOPIC("Arrays & Strings", 2, "completed", "Contiguous memory, two-pointer patterns, sliding window."),
          TOPIC("Complexity Analysis", 2, "completed", "Big-O, space-time tradeoffs, recurrence relations."),
          TOPIC("Recursion & Backtracking", 3, "learning", "Subset/permutation generation, pruning, memoization intro."),
        ],
      },
      {
        name: "Sorting & Searching",
        topics: [
          TOPIC("Sorting Algorithms", 2, "completed", "Merge/quick/insertion sort, stability, inversions."),
          TOPIC("Binary Search", 3, "completed", "Classic + rotated arrays + search on answers."),
        ],
      },
      {
        name: "Graphs",
        topics: [
          TOPIC("Graph Traversal (BFS/DFS)", 3, "learning", "Adjacency lists, connected components, cycle detection."),
          TOPIC("Shortest Paths", 4, "not_started", "Dijkstra, Bellman-Ford, topological order + DP."),
          TOPIC("Minimum Spanning Trees", 4, "not_started", "Kruskal & Prim, union-find."),
        ],
      },
      {
        name: "Dynamic Programming",
        topics: [
          TOPIC("DP Fundamentals", 4, "learning", "Overlapping subproblems, 1D/2D transitions."),
          TOPIC("Classic DP Problems", 4, "not_started", "Knapsack, LIS, LCS, edit distance."),
        ],
      },
    ],
  },
  {
    name: "Database Management Systems",
    color: "#8b5cf6",
    priority: 3,
    difficulty: 3,
    units: [
      {
        name: "Relational Foundations",
        topics: [
          TOPIC("ER & Relational Models", 2, "completed", "Entities, relationships, mapping to schemas."),
          TOPIC("Relational Algebra & SQL", 2, "completed", "Selection, projection, joins, aggregation."),
        ],
      },
      {
        name: "Design & Normalization",
        topics: [
          TOPIC("Functional Dependencies", 3, "completed", "Closure, keys, canonical covers."),
          TOPIC("Normalization (1NF–BCNF)", 3, "needs_revision", "Decomposition, lossless joins, dependency preservation."),
          TOPIC("Transactions & Concurrency", 3, "learning", "ACID, schedules, locking, isolation levels."),
          TOPIC("Recovery Systems", 3, "not_started", "WAL, checkpoints, undo/redo logging."),
        ],
      },
      {
        name: "Storage & Indexing",
        topics: [
          TOPIC("Indexing (B+ Trees, Hashing)", 3, "not_started", "Clustered vs secondary, cost estimation."),
        ],
      },
    ],
  },
  {
    name: "Operating Systems",
    color: "#0ea5e9",
    priority: 2,
    difficulty: 2,
    units: [
      {
        name: "Processes",
        topics: [
          TOPIC("Processes & Threads", 2, "completed", "PCB, context switch, thread models."),
          TOPIC("CPU Scheduling", 2, "completed", "FCFS, SJF, Round Robin, MLFQ."),
          TOPIC("Synchronization", 3, "learning", "Mutexes, semaphores, monitors, deadlock."),
        ],
      },
      {
        name: "Memory & Storage",
        topics: [
          TOPIC("Memory Management", 3, "not_started", "Paging, segmentation, virtual memory, thrashing."),
          TOPIC("File Systems", 2, "not_started", "Inodes, allocation strategies, journaling."),
        ],
      },
    ],
  },
  {
    name: "Computer Networks",
    color: "#10b981",
    priority: 2,
    difficulty: 2,
    units: [
      {
        name: "Core Layers",
        topics: [
          TOPIC("Application Layer (HTTP, DNS)", 2, "completed", "Protocols, sockets, CDNs."),
          TOPIC("Transport Layer (TCP/UDP)", 3, "completed", "Flow & congestion control, three-way handshake."),
          TOPIC("Network Layer (IP)", 3, "learning", "Addressing, routing, IPv4/IPv6."),
        ],
      },
      {
        name: "Advanced Topics",
        topics: [
          TOPIC("Link Layer & Wireless", 2, "not_started", "MAC, ARP, ethernet, wifi basics."),
        ],
      },
    ],
  },
  {
    name: "Software Design",
    color: "#f59e0b",
    priority: 1,
    difficulty: 2,
    units: [
      {
        name: "Design & Architecture",
        topics: [
          TOPIC("SOLID Principles", 2, "completed", "Single responsibility, open/closed, Liskov..."),
          TOPIC("UML & Modeling", 2, "learning", "Class/sequence diagrams, use cases."),
          TOPIC("Design Patterns", 3, "not_started", "Strategy, observer, factory, singleton — when to use them."),
        ],
      },
    ],
  },
];

export async function demoUserExists(): Promise<boolean> {
  const [{ c }] = await db.select({ c: count() }).from(users).where(eq(users.email, DEMO_EMAIL)).all();
  return c > 0;
}

/** Idempotent demo bootstrap — call on first visit when the DB is empty. */
export async function ensureDemoData(): Promise<boolean> {
  if (await demoUserExists()) return false;
  const userId = await createDemoUser();
  await seedDemoCurriculum(userId);
  return true;
}

export async function createDemoUser(): Promise<string> {
  const userId = uid();
  const t = now();
  await db.insert(users).values({
    id: userId,
    email: DEMO_EMAIL,
    name: "Alex Morgan",
    passwordHash: hashPassword(DEMO_PASSWORD),
    onboarded: true,
    createdAt: t,
    updatedAt: t,
  });
  await db.insert(profiles).values({
    userId,
    educationLevel: "undergraduate",
    course: "B.Tech Computer Science",
    yearOfStudy: "Year 3",
    studyGoals: "Aim for distinction this semester and stay consistent instead of cramming.",
    weekdayHours: 3,
    weekendHours: 5,
    preferredTimes: JSON.stringify(["evening", "morning", "night"]),
    sessionStyle: "mixed",
    updatedAt: t,
  });
  await db.insert(settings).values({
    userId,
    theme: "system",
    dailyGoalMinutes: 240,
    focusMinutes: 25,
    breakMinutes: 5,
    notificationPrefs: JSON.stringify({
      session: true, missed_task: true, deadline: true, exam: true, daily_plan: true, streak: true,
      ai_recommendation: true, achievement: true,
    }),
    updatedAt: t,
  });
  return userId;
}

export async function seedDemoCurriculum(userId: string): Promise<void> {
  const t = now();
  const subjectRows: Subject[] = [];
  const topicRows: Topic[] = [];

  for (const [si, s] of CURRICULUM.entries()) {
    const sid = uid();
    subjectRows.push({
      id: sid, userId, name: s.name, color: s.color, priority: s.priority,
      difficulty: s.difficulty, sortOrder: si, deletedAt: null, createdAt: t, updatedAt: t,
    } as Subject);
    await db.insert(subjects).values({
      id: sid, userId, name: s.name, color: s.color, priority: s.priority,
      difficulty: s.difficulty, sortOrder: si, createdAt: t, updatedAt: t,
    });
    for (const [ui, u] of s.units.entries()) {
      const unitId = uid();
      await db.insert(units).values({ id: unitId, subjectId: sid, name: u.name, sortOrder: ui, createdAt: t });
      for (const [ti, topic] of u.topics.entries()) {
        const [name, difficulty, status, description] = topic;
        const topicId = uid();
        topicRows.push({
          id: topicId, unitId, name, description: description ?? null, difficulty,
          weight: 1, status, sortOrder: ti, completedAt: status === "completed" ? addDaysISO(-20) : null,
          lastStudiedAt: status !== "not_started" ? addDaysISO(-(3 + ti)) : null, createdAt: t, updatedAt: t,
        } as Topic);
        await db.insert(topics).values({
          id: topicId, unitId, name, description: description ?? null, difficulty,
          weight: 1, status, sortOrder: ti,
          completedAt: status === "completed" ? addDaysISO(-20) : null,
          lastStudiedAt: status !== "not_started" ? addDaysISO(-(3 + ti)) : null,
          createdAt: t, updatedAt: t,
        });
      }
    }
  }

  const subjectByName = new Map(subjectRows.map((s) => [s.name, s.id]));

  // Exams with relative dates
  await db.insert(exams).values([
    { id: uid(), userId, subjectId: subjectByName.get("Database Management Systems")!, name: "DBMS Mid-Term", date: addDaysISO(13), importance: 3, createdAt: t, updatedAt: t },
    { id: uid(), userId, subjectId: subjectByName.get("Data Structures & Algorithms")!, name: "DSA End-Term", date: addDaysISO(23), importance: 3, createdAt: t, updatedAt: t },
    { id: uid(), userId, subjectId: subjectByName.get("Operating Systems")!, name: "OS Quiz", date: addDaysISO(6), importance: 2, createdAt: t, updatedAt: t },
    { id: uid(), userId, subjectId: subjectByName.get("Computer Networks")!, name: "CN Mid-Term", date: addDaysISO(34), importance: 2, createdAt: t, updatedAt: t },
  ]);

  // Tasks / deadlines
  const dsSubj = subjectByName.get("Data Structures & Algorithms")!;
  const dbSubj = subjectByName.get("Database Management Systems")!;
  const osSubj = subjectByName.get("Operating Systems")!;
  const cnSubj = subjectByName.get("Computer Networks")!;
  await db.insert(tasks).values([
    { id: uid(), userId, subjectId: dsSubj, title: "Graph visualizer lab — submit report", kind: "assignment", deadline: addDaysISO(2), priority: 3, estimatedMinutes: 90, status: "todo", createdAt: t, updatedAt: t },
    { id: uid(), userId, subjectId: dbSubj, title: "Normalization problem set", kind: "assignment", deadline: addDaysISO(6), priority: 3, estimatedMinutes: 60, status: "todo", createdAt: t, updatedAt: t },
    { id: uid(), userId, subjectId: cnSubj, title: "Wireshark capture quiz", kind: "quiz", deadline: addDaysISO(4), priority: 2, estimatedMinutes: 45, status: "in_progress", createdAt: t, updatedAt: t },
    { id: uid(), userId, subjectId: osSubj, title: "Scheduler simulation project", kind: "project", deadline: addDaysISO(19), priority: 2, estimatedMinutes: 180, status: "todo", createdAt: t, updatedAt: t },
    { id: uid(), userId, subjectId: dsSubj, title: "LeetCode streak problem set", kind: "other", deadline: null, priority: 1, estimatedMinutes: 40, status: "completed", completedAt: addDaysISO(-1), createdAt: t, updatedAt: t },
  ]);

  // Realistic past study history (sessions) — day -6 is the deliberate miss.
  // Build a name -> topic row index so sessions can reference real topics.
  const flatTopics: { name: string; row: Topic }[] = [];
  for (const s of CURRICULUM) for (const u of s.units) for (const tp of u.topics) {
    flatTopics.push({ name: tp[0], row: topicRows[flatTopics.length] });
  }
  const byDef = (name: string) => flatTopics.find((f) => f.name === name)?.row;

  const sessions: { subjName: string; topicName: string | null; dayOffset: number; startHour: number; minutes: number }[] = [
    { subjName: "Database Management Systems", topicName: "Normalization (1NF–BCNF)", dayOffset: -12, startHour: 19, minutes: 55 },
    { subjName: "Data Structures & Algorithms", topicName: "Binary Search", dayOffset: -11, startHour: 20, minutes: 45 },
    { subjName: "Operating Systems", topicName: "CPU Scheduling", dayOffset: -10, startHour: 18, minutes: 60 },
    { subjName: "Database Management Systems", topicName: "Functional Dependencies", dayOffset: -9, startHour: 21, minutes: 40 },
    { subjName: "Data Structures & Algorithms", topicName: "Recursion & Backtracking", dayOffset: -8, startHour: 19, minutes: 70 },
    { subjName: "Computer Networks", topicName: "Transport Layer (TCP/UDP)", dayOffset: -7, startHour: 20, minutes: 50 },
    // day -6 skipped (that's the miss)
    { subjName: "Data Structures & Algorithms", topicName: "Graph Traversal (BFS/DFS)", dayOffset: -5, startHour: 18, minutes: 65 },
    { subjName: "Database Management Systems", topicName: "Transactions & Concurrency", dayOffset: -4, startHour: 19, minutes: 50 },
    { subjName: "Software Design", topicName: "SOLID Principles", dayOffset: -3, startHour: 20, minutes: 40 },
    { subjName: "Operating Systems", topicName: "Synchronization", dayOffset: -2, startHour: 17, minutes: 55 },
    { subjName: "Computer Networks", topicName: "Network Layer (IP)", dayOffset: -1, startHour: 19, minutes: 45 },
  ];

  for (const s of sessions) {
    const subjectRow = subjectRows.find((r) => r.name === s.subjName);
    const topicRow = s.topicName ? byDef(s.topicName) : null;
    const start = new Date(addDaysISO(s.dayOffset));
    start.setHours(s.startHour, 15, 0, 0);
    const end = new Date(start.getTime() + s.minutes * 60000);
    await db.insert(studySessions).values({
      id: uid(),
      userId,
      subjectId: subjectRow?.id ?? null,
      topicId: topicRow?.id ?? null,
      planItemId: null,
      kind: "focus",
      startedAt: start.toISOString(),
      endedAt: end.toISOString(),
      durationMinutes: s.minutes,
      completed: true,
      createdAt: start.toISOString(),
    });
  }

  // Missed plan item (yesterday) so the reschedule story is visible
  const yesterdayTopic = byDef("Normalization (1NF–BCNF)") ?? topicRows[0];
  await db.insert(planItems).values({
    id: uid(),
    userId,
    date: addDaysISO(-1),
    kind: "study",
    subjectId: subjectByName.get("Database Management Systems"),
    topicId: yesterdayTopic.id,
    title: "Normalization (1NF–BCNF)",
    startMinutes: 19 * 60,
    durationMinutes: 50,
    status: "missed",
    reason: "Exam in 14 days · DBMS Mid-Term",
    origin: "planned",
    createdAt: addDaysISO(-2),
    updatedAt: now(),
  });
  const missedTopic2 = byDef("Transactions & Concurrency") ?? topicRows[0];
  await db.insert(planItems).values({
    id: uid(),
    userId,
    date: addDaysISO(-1),
    kind: "study",
    subjectId: subjectByName.get("Database Management Systems"),
    topicId: missedTopic2.id,
    title: "Transactions & Concurrency",
    startMinutes: 20 * 60,
    durationMinutes: 45,
    status: "missed",
    reason: "Exam in 14 days · DBMS Mid-Term",
    origin: "planned",
    createdAt: addDaysISO(-2),
    updatedAt: now(),
  });

  // AI-generated plan for the upcoming window via the real engine
  await ensurePlan(userId, 7);

  // unlock streak + early achievements
  const unlocked = await refreshAchievements(userId);
  void unlocked;

  await createNotification(userId, "exam", "DBMS Mid-Term in 13 days", "You're at ~64% syllabus coverage — the plan has front-loaded the remaining topics.");
  await createNotification(userId, "deadline", "Graph visualizer lab due Friday", "Make time for the 90-minute block before the deadline.");
}

export { todayISO };
