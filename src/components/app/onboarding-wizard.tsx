"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarClock,
  Check,
  GraduationCap,
  ListTodo,
  Rocket,
  Sparkles,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";
import { completeOnboardingAction } from "@/lib/actions/onboarding";

const COLORS = ["#5753d4", "#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e", "#ec4899", "#14b8a6"];

const STEPS = [
  { key: "welcome", label: "Welcome", icon: Rocket },
  { key: "profile", label: "Profile", icon: UserRound },
  { key: "subjects", label: "Subjects", icon: BookOpen },
  { key: "exams", label: "Exams", icon: GraduationCap },
  { key: "deadlines", label: "Deadlines", icon: ListTodo },
  { key: "availability", label: "Availability", icon: CalendarClock },
];

type DraftSubject = {
  name: string;
  color: string;
  difficulty: number;
  priority: number;
  topicsText: string;
};
type DraftExam = { name: string; subjectIndex: number; date: string; importance: number };
type DraftKind = "assignment" | "project" | "lab" | "quiz" | "revision" | "other";
type DraftTask = { title: string; kind: DraftKind; subjectIndex: number; deadline: string; estimatedMinutes: number };
type TimeKey = "morning" | "afternoon" | "evening" | "night";

const GENERATING_LINES = [
  "Analyzing your syllabus…",
  "Checking deadlines…",
  "Finding high-priority topics…",
  "Balancing your schedule…",
  "Building your study roadmap…",
];

export function OnboardingWizard() {
  const { toast } = useToast();
  const [step, setStep] = React.useState(0);
  const [generating, setGenerating] = React.useState(false);
  const [genLine, setGenLine] = React.useState(0);
  const [stepError, setStepError] = React.useState<string | null>(null);

  const [name, setName] = React.useState("");
  const [edu, setEdu] = React.useState("undergraduate");
  const [course, setCourse] = React.useState("");
  const [year, setYear] = React.useState("Year 1");
  const [goals, setGoals] = React.useState("");

  const [subjects, setSubjects] = React.useState<DraftSubject[]>([
    { name: "", color: COLORS[0], difficulty: 2, priority: 2, topicsText: "" },
  ]);
  const [exams, setExams] = React.useState<DraftExam[]>([]);
  const [tasks, setTasks] = React.useState<DraftTask[]>([]);

  const [weekday, setWeekday] = React.useState(3);
  const [weekend, setWeekend] = React.useState(5);
  const [times, setTimes] = React.useState<TimeKey[]>(["evening", "morning"]);
  const [style, setStyle] = React.useState<"short" | "pomodoro" | "deep" | "mixed">("mixed");

  const stepValid = (() => {
    switch (step) {
      case 1:
        return name.trim().length > 0;
      case 2:
        return subjects.some((s) => s.name.trim());
      case 5:
        return times.length > 0 && weekday > 0 && weekend > 0;
      default:
        return true;
    }
  })();

  /** Human hint shown when Continue is pressed but the step isn't complete yet. */
  const stepHint = (() => {
    switch (step) {
      case 1:
        return "Please type your name in the box above to continue.";
      case 2:
        return 'Add at least one subject name to continue — type it in the “Subject 1” box (topics are optional).';
      case 5:
        return "Choose at least one preferred study time and keep weekday/weekend hours above 0 to continue.";
      default:
        return null;
    }
  })();

  const goNext = () => {
    if (step >= STEPS.length - 1) return;
    if (!stepValid) {
      setStepError(stepHint);
      return;
    }
    setStepError(null);
    setStep((s) => s + 1);
  };
  const goBack = () => {
    setStepError(null);
    setStep((s) => Math.max(0, s - 1));
  };

  const finish = async () => {
    setGenerating(true);
    const lineTimer = setInterval(() => setGenLine((l) => Math.min(l + 1, GENERATING_LINES.length - 1)), 550);
    await new Promise((r) => setTimeout(r, 1200));

    const res = await completeOnboardingAction({
      name,
      educationLevel: edu,
      course,
      yearOfStudy: year,
      goals,
      subjects: subjects
        .filter((s) => s.name.trim())
        .map((s) => ({
          name: s.name.trim(),
          color: s.color,
          difficulty: s.difficulty,
          priority: s.priority,
          topics: s.topicsText
            .split(/[\n,;]+/)
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 60),
        })),
      exams,
      tasks,
      weekdayHours: weekday,
      weekendHours: weekend,
      preferredTimes: times,
      sessionStyle: style,
      dailyGoalMinutes: 240,
    });
    clearInterval(lineTimer);
    if (!res.ok) {
      setGenerating(false);
      toast("error", "Could not finish setup", res.error);
      return;
    }
    // action redirects to /app
  };

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* progress */}
      {!generating && (
        <div className="mb-6 flex items-center gap-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = i === step;
            const done = i < step;
            return (
              <div key={s.key} className="flex flex-1 items-center gap-2">
                <button
                  onClick={() => i < step && setStep(i)}
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all cursor-pointer",
                    done && "bg-success text-white shadow-raise-sm",
                    active && "bg-primary text-primary-foreground shadow-raise-sm ring-2 ring-ring/30",
                    !done && !active && "bg-card text-muted-foreground shadow-raise-sm",
                  )}
                  aria-label={s.label}
                >
                  {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </button>
                {i < STEPS.length - 1 && (
                  <span className={cn("h-0.5 flex-1 rounded-full shadow-inset-sm", i < step ? "bg-success/70" : "bg-muted")} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {generating ? (
        <Card>
          <CardBody className="flex flex-col items-center py-14 text-center">
            <span className="neo-raise-sm mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground animate-float">
              <Sparkles className="h-8 w-8" />
            </span>
            <div className="space-y-2">
              {GENERATING_LINES.map((l, i) => (
                <p
                  key={l}
                  className={cn(
                    "text-sm transition-all duration-300",
                    i < genLine ? "text-foreground" : i === genLine ? "text-primary font-semibold" : "text-muted-foreground/40",
                  )}
                >
                  {i < genLine ? "✓ " : ""}
                  {l}
                </p>
              ))}
            </div>
            <p className="mt-8 text-lg font-bold tracking-tight">Your StudyPilot plan is ready.</p>
            <p className="mt-1 text-sm text-muted-foreground">Taking you to your dashboard…</p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="pt-6">
            {/* WELCOME */}
            {step === 0 && (
              <div className="py-6 text-center">
                <span className="neo-float mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary text-primary-foreground">
                  <Rocket className="h-10 w-10" />
                </span>
                <h1 className="text-2xl font-bold tracking-tight">Welcome to StudyPilot</h1>
                <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Tell us about your subjects, exams and available time — we&apos;ll turn them into a personalized daily study plan
                  that adapts as you progress. Takes about two minutes.
                </p>
              </div>
            )}

            {/* PROFILE */}
            {step === 1 && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold tracking-tight">Tell us about yourself</h2>
                <Field label="Your name" required>
                  <Input
                    value={name}
                    onChange={(e) => {
                      setStepError(null);
                      setName(e.target.value);
                    }}
                    placeholder="e.g. Alex"
                    autoFocus
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Education level">
                    <Select value={edu} onChange={(e) => setEdu(e.target.value)}>
                      <option value="high-school">High school</option>
                      <option value="undergraduate">Undergraduate</option>
                      <option value="postgraduate">Postgraduate</option>
                      <option value="self-study">Self-study / other</option>
                    </Select>
                  </Field>
                  <Field label="Year">
                    <Select value={year} onChange={(e) => setYear(e.target.value)}>
                      {["Year 1", "Year 2", "Year 3", "Year 4", "Other"].map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Field label="Course / degree">
                  <Input value={course} onChange={(e) => setCourse(e.target.value)} placeholder="e.g. B.Tech Computer Science" />
                </Field>
                <Field label="Study goals" hint="What do you want to achieve?">
                  <Textarea value={goals} onChange={(e) => setGoals(e.target.value)} placeholder="e.g. Score distinction in DBMS and stay consistent all term" />
                </Field>
              </div>
            )}

            {/* SUBJECTS */}
            {step === 2 && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold tracking-tight">What are you studying?</h2>
                <p className="text-sm text-muted-foreground">Add each subject and (optionally) its main topics, one per line.</p>
                {subjects.map((s, i) => (
                  <div key={i} className="space-y-3 rounded-2xl bg-muted/40 p-4 shadow-inset-sm">
                    <div className="flex items-center gap-2">
                      <Field label={`Subject ${i + 1}`} required className="flex-1">
                        <Input
                          value={s.name}
                          onChange={(e) => {
                            setStepError(null);
                            setSubjects(subjects.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)));
                          }}
                          placeholder="e.g. Database Management Systems"
                          autoFocus={i === 0}
                        />
                      </Field>
                      {subjects.length > 1 && (
                        <button
                          onClick={() => setSubjects(subjects.filter((_, xi) => xi !== i))}
                          className="mt-5 text-xs font-semibold text-danger hover:underline cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Difficulty">
                        <Select
                          value={s.difficulty}
                          onChange={(e) => setSubjects(subjects.map((x, xi) => (xi === i ? { ...x, difficulty: Number(e.target.value) } : x)))}
                        >
                          <option value={1}>Easy</option>
                          <option value={2}>Moderate</option>
                          <option value={3}>Hard</option>
                        </Select>
                      </Field>
                      <Field label="Priority">
                        <Select
                          value={s.priority}
                          onChange={(e) => setSubjects(subjects.map((x, xi) => (xi === i ? { ...x, priority: Number(e.target.value) } : x)))}
                        >
                          <option value={1}>Low</option>
                          <option value={2}>Medium</option>
                          <option value={3}>High</option>
                        </Select>
                      </Field>
                      <Field label="Color">
                        <Select
                          value={s.color}
                          onChange={(e) => setSubjects(subjects.map((x, xi) => (xi === i ? { ...x, color: e.target.value } : x)))}
                        >
                          {COLORS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <Field label="Topics (one per line — optional)">
                      <Textarea
                        value={s.topicsText}
                        onChange={(e) => setSubjects(subjects.map((x, xi) => (xi === i ? { ...x, topicsText: e.target.value } : x)))}
                        placeholder={"Normalization\nTransactions\nIndexing"}
                        className="min-h-16"
                      />
                    </Field>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setSubjects([...subjects, { name: "", color: COLORS[subjects.length % COLORS.length], difficulty: 2, priority: 2, topicsText: "" }])}>
                  + Add another subject
                </Button>
              </div>
            )}

            {/* EXAMS */}
            {step === 3 && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold tracking-tight">Upcoming exams</h2>
                <p className="text-sm text-muted-foreground">We&apos;ll build a preparation roadmap and schedule around these.</p>
                {exams.length === 0 && (
                  <p className="rounded-xl bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground shadow-inset-sm">
                    No exams? Skip this step — you can add them later.
                  </p>
                )}
                {exams.map((e, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3 rounded-2xl bg-muted/40 p-4 shadow-inset-sm">
                    <Field label="Exam name">
                      <Input
                        value={e.name}
                        onChange={(ev) => setExams(exams.map((x, xi) => (xi === i ? { ...x, name: ev.target.value } : x)))}
                        placeholder="e.g. DBMS Mid-Term"
                      />
                    </Field>
                    <Field label="Date">
                      <Input
                        type="date"
                        value={e.date}
                        onChange={(ev) => setExams(exams.map((x, xi) => (xi === i ? { ...x, date: ev.target.value } : x)))}
                      />
                    </Field>
                    <button onClick={() => setExams(exams.filter((_, xi) => xi !== i))} className="mb-1 text-xs font-semibold text-danger hover:underline cursor-pointer">
                      Remove
                    </button>
                    <Field label="Subject" className="col-span-2">
                      <Select
                        value={e.subjectIndex}
                        onChange={(ev) => setExams(exams.map((x, xi) => (xi === i ? { ...x, subjectIndex: Number(ev.target.value) } : x)))}
                      >
                        <option value={-1}>No subject</option>
                        {subjects.map((s, si) => s.name.trim() && (
                          <option key={si} value={si}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setExams([...exams, { name: "", subjectIndex: subjects.findIndex((s) => s.name.trim()) !== -1 ? subjects.findIndex((s) => s.name.trim()) : -1, date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), importance: 2 }])
                  }
                >
                  + Add exam
                </Button>
              </div>
            )}

            {/* DEADLINES */}
            {step === 4 && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold tracking-tight">Deadlines & assignments</h2>
                <p className="text-sm text-muted-foreground">These get planned into your day automatically as they approach.</p>
                {tasks.length === 0 && (
                  <p className="rounded-xl bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground shadow-inset-sm">
                    Nothing due soon? Skip — tasks can be added later.
                  </p>
                )}
                {tasks.map((t, i) => (
                  <div key={i} className="grid grid-cols-2 items-end gap-3 rounded-2xl bg-muted/40 p-4 shadow-inset-sm">
                    <Field label="Task" className="col-span-2">
                      <Input
                        value={t.title}
                        onChange={(ev) => setTasks(tasks.map((x, xi) => (xi === i ? { ...x, title: ev.target.value } : x)))}
                        placeholder="e.g. DSA lab report"
                      />
                    </Field>
                    <Field label="Deadline">
                      <Input
                        type="date"
                        value={t.deadline}
                        onChange={(ev) => setTasks(tasks.map((x, xi) => (xi === i ? { ...x, deadline: ev.target.value } : x)))}
                      />
                    </Field>
                    <Field label="Est. minutes">
                      <Input
                        type="number"
                        min={5}
                        step={5}
                        value={t.estimatedMinutes}
                        onChange={(ev) => setTasks(tasks.map((x, xi) => (xi === i ? { ...x, estimatedMinutes: Number(ev.target.value) } : x)))}
                      />
                    </Field>
                    <Field label="Kind" className="col-span-1">
                      <Select
                        value={t.kind}
                        onChange={(ev) => setTasks(tasks.map((x, xi) => (xi === i ? { ...x, kind: ev.target.value as DraftKind } : x)))}
                      >
                        {["assignment", "project", "lab", "quiz", "revision", "other"].map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="flex justify-end">
                      <button onClick={() => setTasks(tasks.filter((_, xi) => xi !== i))} className="text-xs font-semibold text-danger hover:underline cursor-pointer">
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setTasks([...tasks, { title: "", kind: "assignment" as DraftKind, subjectIndex: -1, deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), estimatedMinutes: 60 }])
                  }
                >
                  + Add deadline
                </Button>
              </div>
            )}

            {/* AVAILABILITY */}
            {step === 5 && (
              <div className="space-y-5">
                <h2 className="text-lg font-bold tracking-tight">When can you study?</h2>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Weekday hours / day">
                    <Input type="number" min={0.5} max={12} step={0.5} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} />
                  </Field>
                  <Field label="Weekend hours / day">
                    <Input type="number" min={0.5} max={12} step={0.5} value={weekend} onChange={(e) => setWeekend(Number(e.target.value))} />
                  </Field>
                </div>
                <Field label="Preferred study times">
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        { key: "morning", label: "Morning" },
                        { key: "afternoon", label: "Afternoon" },
                        { key: "evening", label: "Evening" },
                        { key: "night", label: "Night" },
                      ] as const
                    ).map((t) => {
                      const on = times.includes(t.key);
                      return (
                        <button
                          key={t.key}
                          onClick={() => setTimes(on ? times.filter((x) => x !== t.key) : [...times, t.key])}
                          className={cn(
                            "rounded-full px-4 py-2 text-sm font-semibold transition-all cursor-pointer",
                            on ? "bg-primary-soft/80 text-primary shadow-inset-sm ring-1 ring-inset ring-primary/30" : "bg-card text-muted-foreground shadow-raise-sm hover:text-foreground",
                          )}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <Field label="Session style">
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { key: "short", label: "Short sessions", desc: "30-min sprints" },
                        { key: "pomodoro", label: "Pomodoro", desc: "25 + 5 cycles" },
                        { key: "deep", label: "Deep work", desc: "60–90 min blocks" },
                        { key: "mixed", label: "Mixed", desc: "Adaptive" },
                      ] as const
                    ).map((s) => (
                      <button
                        key={s.key}
                        onClick={() => setStyle(s.key)}
                        className={cn(
                          "rounded-xl p-3 text-left transition-all cursor-pointer",
                          style === s.key ? "bg-primary-soft/70 shadow-inset-sm ring-1 ring-inset ring-primary/25" : "bg-card shadow-raise-sm hover:shadow-raise",
                        )}
                      >
                        <p className="text-[13px] font-semibold">{s.label}</p>
                        <p className="text-[11px] text-muted-foreground">{s.desc}</p>
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            )}

            {/* nav */}
            <div className="mt-8 border-t border-border pt-5">
              {stepError && (
                <p role="alert" className="mb-3 rounded-xl bg-warning-soft px-3.5 py-2.5 text-[13px] font-medium text-warning">
                  {stepError}
                </p>
              )}
              <div className="flex items-center justify-between">
                <Button variant="ghost" onClick={goBack} disabled={step === 0}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button onClick={goNext}>
                    Continue <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button onClick={finish} size="lg">
                    <Sparkles className="h-4 w-4" /> Generate my plan
                  </Button>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}