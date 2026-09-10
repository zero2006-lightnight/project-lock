import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Brain,
  CalendarClock,
  Check,
  Flame,
  GraduationCap,
  MessageSquareText,
  Rocket,
  Target,
  Timer,
  TrendingUp,
} from "lucide-react";
import { variantClasses, sizeClasses } from "@/components/ui/button";
import { Tilt } from "@/components/ui/tilt";
import { cn } from "@/lib/utils";

function MockDashboard() {
  const blocks = [
    { time: "09:00", subject: "Data Structures", topic: "Graph traversal", minutes: "45 min", reason: "DBMS exam in 13 days, so DSA moves early" },
    { time: "11:00", subject: "Databases", topic: "Normalization", minutes: "50 min", reason: "Closest exam, weakest topic" },
    { time: "15:00", subject: "Operating Systems", topic: "Scheduling", minutes: "40 min", reason: "High-priority subject, morning slot missed" },
  ];
  return (
    <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-2xl bg-card">
      {/* window chrome */}
      <div className="flex items-center gap-1.5 border-b border-border/70 bg-muted/40 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        <span className="ml-3 rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">studypilot.app/app</span>
      </div>
      <div className="grid gap-0 sm:grid-cols-[1fr_240px]">
        <div className="p-5">
          <p className="text-sm font-bold">Good morning, Alex</p>
          <p className="text-[11px] text-muted-foreground">Three blocks, each with a reason. That is the whole product.</p>
          <div className="mt-4 space-y-2">
            {blocks.map((b) => (
              <div key={b.time} className="neo-inset-sm flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2">
                <span className="w-9 shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">{b.time}</span>
                <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: "var(--color-primary)" }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold">{b.topic}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{b.subject} — {b.reason}</p>
                </div>
                <span className="shrink-0 text-[11px] font-semibold tabular-nums">{b.minutes}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-border/70 bg-muted/30 p-5 sm:border-l sm:border-t-0">
          <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full" style={{ background: "conic-gradient(var(--color-primary) 62%, var(--color-muted) 0)" }}>
            <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full bg-card">
              <span className="font-display text-lg font-bold">62%</span>
              <span className="text-[9px] text-muted-foreground">of today</span>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {[
              { icon: Flame, label: "5-day streak" },
              { icon: GraduationCap, label: "DBMS exam in 13 days" },
              { icon: TrendingUp, label: "3.2 hours this week" },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 py-1.5 text-[11px] font-medium">
                <s.icon className="h-3.5 w-3.5 text-primary" aria-hidden />
                {s.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: Brain,
    title: "AI study planning",
    desc: "Tell Pilot your deadlines and free hours — the engine turns your syllabus into a realistic daily plan, no cramming required.",
  },
  {
    icon: CalendarClock,
    title: "Adaptive schedules",
    desc: "Miss a session? Work gets redistributed across the coming days — never dropped, never doubled up. The plan bends, you stay on track.",
  },
  {
    icon: MessageSquareText,
    title: "Pilot, your AI tutor",
    desc: "Ask what to study, why you're stuck on a topic, or for a quiz. Pilot answers from your actual syllabus, deadlines and progress.",
  },
  {
    icon: Target,
    title: "Daily planning",
    desc: "Every morning you get a realistic timeline with reasons: why this topic, why now, how long. One tap starts a focus session.",
  },
  {
    icon: BarChart3,
    title: "Progress & analytics",
    desc: "Streaks, heatmaps, subject-level trends and rule-based insights — e.g. “you're most productive between 7 PM and 9 PM.”",
  },
  {
    icon: GraduationCap,
    title: "Exam readiness",
    desc: "A live readiness score per exam — syllabus coverage blended with whether the remaining work fits your available time.",
  },
];

const STEPS = [
  { n: "01", title: "Add your subjects & syllabus", desc: "Topics, units and difficulty — in minutes, or paste them in." },
  { n: "02", title: "Enter exams & deadlines", desc: "StudyPilot knows what's coming and plans backwards from it." },
  { n: "03", title: "Tell us your available hours", desc: "Weekday/weekend hours and when you actually like to study." },
  { n: "04", title: "Follow your adaptive plan", desc: "Complete sessions, miss some, ask Pilot — the plan recalibrates daily." },
];

const TESTIMONIALS = [
  { quote: "It's the first planner that actually understands I have a life. Missed a session Tuesday, and the plan just quietly moved it to Thursday.", name: "Priya S.", role: "2nd-year CS student" },
  { quote: "The exam readiness score is addictive — I check it every morning. Passed DBMS with my best grade ever.", name: "Daniel K.", role: "Pre-med, 3rd year" },
  { quote: "Pilot feels like a tutor who knows my whole semester. 'Quiz me on normalization' works on my phone on the bus.", name: "Amara O.", role: "Final-year engineering" },
];

const FAQS = [
  { q: "Is StudyPilot an AI chatbot or a planner?", a: "Both. A deterministic planning engine handles scheduling, rescheduling and readiness (so the math is always correct), while Pilot — the AI assistant — handles reasoning, explanations and recommendations using your real data." },
  { q: "Does it work without an API key?", a: "Yes. The full product — planning, today's plan, syllabus, exams, focus mode, analytics and structured chat — runs on the built-in engine with zero external services. Add an OpenAI-compatible key (OpenRouter, Groq, etc.) in Settings to unlock free-form tutoring and AI-generated quizzes and flashcards." },
  { q: "What happens if I miss a planned session?", a: "The topic is redistributed across your next available slots in smaller pieces — respecting your daily hour limit — instead of being marked as a failure. You get a short explanation of where the work went." },
  { q: "Which platforms does it support?", a: "It's a web app built mobile-first: a bottom navigation on phones and a full sidebar on desktop. Installable as a PWA-ready Next.js app." },
  { q: "Is my data private?", a: "Yes. Authentication is session-based with hashed passwords, and your study data stays in your own database. No analytics trackers, no third-party data sharing." },
];

export default function LandingPage() {
  return (
    <div className="editorial-landing min-h-dvh bg-background text-foreground">
      {/* ── Nav ─────────────────────────────────────────── */}
      <header className="editorial-header sticky top-0 z-40 border-b border-border/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="editorial-mark flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Rocket className="h-4.5 w-4.5" />
            </span>
            <span className="text-[15px] font-bold tracking-tight">StudyPilot<span className="text-primary">.</span></span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex" aria-label="Landing navigation">
            <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#faq" className="transition-colors hover:text-foreground">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className={cn(variantClasses.ghost, sizeClasses.sm, "hidden sm:inline-flex rounded-full")}>
              Sign in
            </Link>
            <Link href="/signup" className={cn(variantClasses.primary, sizeClasses.sm, "inline-flex")}>
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero — extruded 3D stage ───────── */}
      <section className="editorial-hero relative overflow-hidden">
        <div className="editorial-shape editorial-shape-one" aria-hidden />
        <div className="editorial-shape editorial-shape-two" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-16 sm:pt-24 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
          {/* Copy — left, ragged-right, rising in 3D. */}
          <div className="max-w-xl animate-rise-3d">
            <h1 className="text-[2.9rem] font-bold leading-[.96] tracking-tight sm:text-7xl">
              Your semester,
              <br />
              <span className="editorial-highlight">finally in focus.</span>
              <br />
            </h1>
            <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
              StudyPilot turns your syllabus, deadlines and available time into a personal study plan that adapts as you progress.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link href="/signup" className="editorial-primary inline-flex items-center justify-center gap-2 sm:justify-start">
                Build my study plan <ArrowRight className="h-4.5 w-4.5" aria-hidden />
              </Link>
              <a href="#how" className="editorial-secondary inline-flex items-center justify-center sm:justify-start">
                Explore the edition
              </a>
            </div>
            <p className="mt-7 flex items-center gap-2 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-success" aria-hidden />
              Free to start. Works with your real syllabus. No card needed.
            </p>
          </div>

          {/* Preview — right, floating extruded stage with pointer tilt */}
          <div className="relative">
            <div className="stamp neo-raise-lg animate-float-soft absolute -left-6 -top-5 z-10 hidden -rotate-2 px-4 py-2.5 md:block">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-success">
                <Check className="h-3.5 w-3.5" aria-hidden /> Normalization done
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                <Flame className="h-3 w-3" aria-hidden /> Streak extended to 6 days
              </p>
            </div>
            <div className="stamp neo-raise-lg animate-float-soft absolute -right-5 top-1/3 z-10 hidden rotate-1 px-4 py-2.5 md:block" style={{ animationDelay: "1.2s" }}>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                <Timer className="h-3.5 w-3.5" aria-hidden /> Focus session, 45 minutes
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Next up: graph traversal</p>
            </div>
            <Tilt max={8}>
              <div className="editorial-preview rounded-2xl">
                <MockDashboard />
              </div>
            </Tilt>
          </div>
        </div>
      </section>

      {/* ── How it works — ruled ledger, sequential numbers earn their place ── */}
      <section id="how" className="mx-auto max-w-6xl px-5 py-24">
        <div className="section-head mb-8 max-w-2xl">
          <span className="font-display text-sm font-bold tabular-nums text-muted-foreground">01</span>
          <div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">From syllabus to daily plan in minutes</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              Four steps, in order. Ten minutes of setup buys back the semester.
            </p>
          </div>
        </div>
        <ol className="rise-3d grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="hover-lift bevel-top neo-raise relative overflow-hidden rounded-2xl bg-card p-6">
              <span className="font-display text-3xl font-bold tabular-nums text-primary drop-shadow-[2px_2px_0_var(--neu-lo)]">{s.n}</span>
              <h3 className="mt-3 text-[15px] font-bold">{s.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{s.desc}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Features — index ledger, not a card kit ─────── */}
      <section id="features" className="border-y border-border bg-muted/30 py-24">
        <div className="mx-auto max-w-6xl px-5">
          <div className="section-head mb-8 max-w-2xl">
            <span className="font-display text-sm font-bold tabular-nums text-muted-foreground">02</span>
            <div>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">A complete study desk, not another todo list</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                Deterministic planning underneath, AI reasoning on top. The schedule stays realistic and the advice knows your context.
              </p>
            </div>
          </div>
          <div className="rise-3d grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="hover-lift bevel-top neo-raise group rounded-2xl bg-card p-6">
                <span className="neo-inset-sm mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-muted/60 text-primary transition-transform duration-200 group-hover:scale-110 group-hover:-translate-y-0.5">
                  <f.icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="text-[15px] font-bold">{f.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials — margin notes ─────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-24">
        <div className="section-head mb-8 max-w-2xl">
          <span className="font-display text-sm font-bold tabular-nums text-muted-foreground">03</span>
          <div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Real students, real semesters</h2>
          </div>
        </div>
        <div className="rise-3d grid gap-4 md:grid-cols-3">
          {TESTIMONIALS.map((t, i) => (
            <figure
              key={t.name}
              className="hover-lift bevel-top neo-raise rounded-2xl bg-card p-6"
              style={{ transform: `rotate(${i === 1 ? 0.6 : i === 2 ? -0.6 : 0.4}deg)` }}
            >
              <blockquote className="font-display text-[15px] italic leading-relaxed text-foreground/90">“{t.quote}”</blockquote>
              <figcaption className="mt-4 border-t border-border/70 pt-3">
                <p className="text-sm font-bold">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.role}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────── */}
      <section id="faq" className="mx-auto max-w-3xl px-5 py-24">
        <div className="section-head mb-8">
          <span className="font-display text-sm font-bold tabular-nums text-muted-foreground">05</span>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Questions, answered</h2>
        </div>
        <div className="rise-3d space-y-3">
          {FAQS.map((f) => (
            <details key={f.q} className="group neo-raise-sm bevel-top rounded-2xl bg-card px-6 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="neo-inset-sm flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-lg leading-none text-primary transition-transform group-open:rotate-45" aria-hidden>+</span>
              </summary>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── Final CTA — extruded ink slab with drifting light ── */}
      <section className="px-5 pb-24">
        <div className="editorial-cta neo-extrude relative mx-auto max-w-5xl overflow-hidden rounded-3xl px-6 py-16 sm:px-12 sm:py-20">
          <div className="orb orb-a right-[-80px] top-[-80px] h-64 w-64 bg-white/15" aria-hidden />
          <div className="orb orb-b bottom-[-100px] left-[20%] h-56 w-56 bg-[var(--edition-lime)]/20" aria-hidden />
          <div className="relative max-w-2xl">
            <span className="neo-inset mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
              <BookOpen className="h-6 w-6" aria-hidden />
            </span>
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Your next exam is closer than you think. Start planning for it today.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/85 sm:text-base">
              Two minutes of setup. A plan that adapts every single day. No more deciding what to study next.
            </p>
            <Link
              href="/signup"
              className="shine neo-raise mt-8 inline-flex items-center gap-2 rounded-2xl bg-[var(--edition-lime)] px-7 py-3.5 text-[15px] font-bold text-[var(--edition-ink)] transition-transform duration-200 hover:scale-[1.03] hover:-translate-y-0.5"
            >
              Build my study plan <ArrowRight className="h-4.5 w-4.5" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────── */}
      <footer className="border-t border-border px-5 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 sm:flex-row">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-raise-sm">
              <Rocket className="h-4 w-4" />
            </span>
            <span className="text-sm font-bold tracking-tight">StudyPilot</span>
          </Link>
          <p className="text-xs text-muted-foreground">
            “Plan smarter. Study better. Stay ahead.” — © {new Date().getFullYear()} StudyPilot
          </p>
          <div className="flex items-center gap-5 text-xs font-medium text-muted-foreground">
            <Link href="/login" className="hover:text-foreground">Sign in</Link>
            <Link href="/signup" className="hover:text-foreground">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}