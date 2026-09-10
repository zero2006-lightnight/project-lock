"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, RotateCcw, Sparkles, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingStages, useStagedBusy } from "@/components/motion/feedback";
import { quizQuestion, recallReveal, successPop } from "@/components/motion/variants";
import { checkQuizAnswerAction, finishQuizAction } from "@/lib/actions/assess";
import {
  generateGeneralQuizAction,
  generateSyllabusQuizAction,
} from "@/lib/actions/study";
import { SourceToggle, SyllabusScopePicker, useSyllabusTree } from "./study-source-picker";

type SafeQuestion = {
  id: string;
  topic: string;
  question: string;
  options: string[];
  difficulty?: string;
};

type Feedback = {
  correct: boolean;
  correctOptionIndex: number;
  explanation: string;
  wrongWhy: string;
};

type Result = {
  answers: (Feedback & { questionId: string; topic: string; selected: number | null })[];
  correctCount: number;
  total: number;
  scorePercent: number;
  weakTopics: { topic: string; missed: number }[];
  strongTopics: { topic: string; correct: number }[];
};

const LETTERS = ["A", "B", "C", "D"];

const GENERATION_STAGES = ["Analyzing syllabus", "Selecting important concepts", "Creating questions"];

export function QuizRunner({ subjectId }: { subjectId?: string }) {
  const [source, setSource] = React.useState<"syllabus" | "general">("syllabus");
  const tree = useSyllabusTree();
  const [selSubjectRaw, setSelSubject] = React.useState(subjectId ?? "");
  const [selUnit, setSelUnit] = React.useState("");
  const [selTopic, setSelTopic] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [count, setCount] = React.useState(5);
  const [difficulty, setDifficulty] = React.useState<"easy" | "medium" | "hard">("medium");
  const [topicFocus, setTopicFocus] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Default to the first subject once the tree arrives (render-time
  // derivation — no effect, no cascading render).
  const selSubject = selSubjectRaw || tree?.[0]?.id || "";

  const start = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r =
        source === "syllabus"
          ? await generateSyllabusQuizAction({
              subjectId: selSubject,
              unitId: selUnit || undefined,
              topicId: selTopic || undefined,
              count,
              difficulty,
              focus: topicFocus || undefined,
            })
          : await generateGeneralQuizAction({ prompt, count, difficulty });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setAttemptId(r.attemptId);
      setQuestions(r.questions);
      setIndex(0);
      setPicked({});
      setFeedback({});
    } finally {
      setBusy(false);
    }
  };

  const [attemptId, setAttemptId] = React.useState<string | null>(null);
  const [questions, setQuestions] = React.useState<SafeQuestion[]>([]);
  const [index, setIndex] = React.useState(0);
  const [picked, setPicked] = React.useState<Record<string, number>>({});
  const [feedback, setFeedback] = React.useState<Record<string, Feedback>>({});
  const [checking, setChecking] = React.useState(false);
  const [result, setResult] = React.useState<Result | null>(null);
  const [finishing, setFinishing] = React.useState(false);
  const genStage = useStagedBusy(busy, GENERATION_STAGES);

  const reset = () => {
    setAttemptId(null);
    setQuestions([]);
    setResult(null);
    setError(null);
  };

  const check = async (q: SafeQuestion, selected: number) => {
    if (!attemptId || feedback[q.id] || checking) return;
    setPicked((p) => ({ ...p, [q.id]: selected }));
    setChecking(true);
    try {
      const r = await checkQuizAnswerAction({ attemptId, questionId: q.id, selected });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setFeedback((f) => ({
        ...f,
        [q.id]: { correct: r.correct, correctOptionIndex: r.correctOptionIndex, explanation: r.explanation, wrongWhy: r.wrongWhy },
      }));
    } finally {
      setChecking(false);
    }
  };

  const finish = async () => {
    if (!attemptId || finishing) return;
    setFinishing(true);
    try {
      const r = await finishQuizAction(attemptId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResult(r);
    } finally {
      setFinishing(false);
    }
  };

  if (result) {
    const band = result.scorePercent >= 80 ? "success" : result.scorePercent >= 50 ? "warning" : "danger";
    return (
      <motion.div variants={successPop} initial="hidden" animate="show">
      <Card className="neo-extrude bevel-top">
        <CardHeader>
          <CardTitle>Quiz complete</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-display text-4xl font-bold tabular-nums">{result.scorePercent}%</p>
            <Badge tone={band as "success" | "warning" | "danger"}>
              {result.correctCount} of {result.total} correct
            </Badge>
          </div>
          <div className="flex justify-center py-1">
            <div className="relative h-28 w-28" aria-label={`${result.scorePercent}% complete`} role="img">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden>
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--color-muted)" strokeWidth="9" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="var(--color-primary)"
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 42}
                  strokeDashoffset={2 * Math.PI * 42 * (1 - result.scorePercent / 100)}
                  className="bar-grow"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center font-display text-2xl font-bold tabular-nums">
                {result.scorePercent}%
              </span>
            </div>
          </div>
          {result.weakTopics.length > 0 ? (
            <div>
              <p className="text-sm font-semibold">Review next</p>
              <ul className="mt-2 space-y-1.5">
                {result.weakTopics.map((w) => (
                  <li key={w.topic} className="neo-inset-sm rounded-xl bg-muted/30 px-3 py-2 text-[13px]">
                    <span className="font-medium">{w.topic}</span>
                    <span className="text-muted-foreground"> — missed {w.missed} question{w.missed === 1 ? "" : "s"}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Clean sweep — every concept held. Push the difficulty up next time.</p>
          )}
          {result.strongTopics.length > 0 && (
            <div>
              <p className="text-sm font-semibold">Strengths</p>
              <ul className="mt-2 space-y-1.5">
                {result.strongTopics.map((s) => (
                  <li key={s.topic} className="neo-inset-sm rounded-xl bg-muted/30 px-3 py-2 text-[13px]">
                    <span className="font-medium">{s.topic}</span>
                    <span className="text-muted-foreground"> — {s.correct} for {s.correct}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={reset} variant="outline" className="gap-1.5">
              <RotateCcw className="h-4 w-4" /> New quiz
            </Button>
          </div>
        </CardBody>
      </Card>
      </motion.div>
    );
  }

  if (!attemptId) {
    const canStart =
      !busy && (source === "general" ? prompt.trim().length >= 3 : selSubject !== "");
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" /> Quiz
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <SourceToggle value={source} onChange={setSource} />

          {source === "syllabus" ? (
            <>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Built from your syllabus — topics, notes, and progress. No pasting needed.
              </p>
              {tree === null ? (
                <p className="text-[13px] text-muted-foreground">Loading your syllabus…</p>
              ) : (
                <SyllabusScopePicker
                  tree={tree}
                  subject={selSubject}
                  unit={selUnit}
                  topic={selTopic}
                  onSubject={(id) => {
                    setSelSubject(id);
                    setSelUnit("");
                    setSelTopic("");
                  }}
                  onUnit={(id) => {
                    setSelUnit(id);
                    setSelTopic("");
                  }}
                  onTopic={setSelTopic}
                />
              )}
              <label className="block space-y-1.5">
                <span className="block text-xs font-semibold text-muted-foreground">Focus (optional)</span>
                <input
                  value={topicFocus}
                  onChange={(e) => setTopicFocus(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Normalization"
                  className="neo-inset-sm h-10 w-full rounded-xl bg-muted/40 px-3 text-sm outline-none placeholder:text-muted-foreground/70"
                />
              </label>
            </>
          ) : (
            <>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Any topic, no syllabus needed — a word, a sentence, or a detailed prompt.
              </p>
              <label className="block space-y-1.5">
                <span className="block text-xs font-semibold text-muted-foreground">What should I quiz you on?</span>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="What would you like to be quizzed on? e.g. Python loops, Indian Constitution…"
                  className="neo-inset-sm w-full resize-none rounded-2xl bg-muted/40 px-4 py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring"
                />
              </label>
            </>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1.5">
              <span className="block text-xs font-semibold text-muted-foreground">Questions</span>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="neo-inset-sm h-10 rounded-xl bg-muted/40 px-3 text-sm outline-none"
              >
                {[3, 4, 5, 6, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <div className="space-y-1.5">
              <span className="block text-xs font-semibold text-muted-foreground">Difficulty</span>
              <div className="neo-inset-sm flex rounded-xl bg-muted/40 p-1" role="group" aria-label="Difficulty">
                {(["easy", "medium", "hard"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDifficulty(d)}
                    className={cn(
                      "cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-all",
                      difficulty === d ? "neo-raise-sm bg-card text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {error && <p className="text-[13px] text-danger" role="alert">{error}</p>}
          {busy && (
            <LoadingStages stages={GENERATION_STAGES} stageIndex={genStage} busyLabel="Preparing your quiz" />
          )}
          <Button onClick={start} loading={busy} disabled={!canStart} className="w-full sm:w-auto">
            {busy ? "Preparing your quiz…" : "Generate quiz"}
          </Button>
        </CardBody>
      </Card>
    );
  }

  const q = questions[index]!;
  const fb = feedback[q.id];
  const answeredCount = Object.keys(feedback).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold tabular-nums">
          Question {index + 1} of {questions.length}
        </p>
        <div
          className="relative h-10 w-10 shrink-0"
          aria-label={`${answeredCount} of ${questions.length} questions answered`}
          role="img"
        >
          <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden>
            <circle cx="50" cy="50" r="38" fill="none" stroke="var(--color-muted)" strokeWidth="12" />
            <circle
              cx="50"
              cy="50"
              r="38"
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 38}
              strokeDashoffset={2 * Math.PI * 38 * (1 - answeredCount / questions.length)}
            />
          </svg>
        </div>
      </div>

      <AnimatePresence mode="wait">
      <motion.div key={q.id} variants={quizQuestion} initial="hidden" animate="show" exit="exit">
      <Card>
        <CardBody className="space-y-4 pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="primary">{q.topic}</Badge>
            {q.difficulty && <Badge tone="neutral">{q.difficulty}</Badge>}
          </div>
          <p className="text-[15px] font-semibold leading-relaxed">{q.question}</p>
          <div className="grid gap-2" role="radiogroup" aria-label={q.question}>
            {q.options.map((opt, oi) => {
              const isPicked = picked[q.id] === oi;
              const revealed = Boolean(fb);
              const isCorrect = fb?.correctOptionIndex === oi;
              return (
                <button
                  key={oi}
                  type="button"
                  role="radio"
                  aria-checked={isPicked}
                  disabled={revealed || checking}
                  onClick={() => void check(q, oi)}
                  className={cn(
                    "flex min-h-12 cursor-pointer items-start gap-3 rounded-xl px-4 py-3 text-left text-sm transition-all",
                    !revealed && "neo-raise-sm bg-card hover:-translate-y-0.5",
                    revealed && isCorrect && "neo-inset-sm bg-success-soft font-medium",
                    revealed && isPicked && !isCorrect && "neo-inset-sm bg-danger-soft",
                    revealed && !isPicked && !isCorrect && "opacity-70",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      revealed && isCorrect
                        ? "bg-success text-white"
                        : revealed && isPicked
                          ? "bg-danger text-white"
                          : "neo-inset-sm bg-muted/60 text-muted-foreground",
                    )}
                    aria-hidden
                  >
                    {LETTERS[oi]}
                  </span>
                  <span className="flex-1">{opt}</span>
                </button>
              );
            })}
          </div>

          {checking && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking…
            </p>
          )}

          <AnimatePresence>
          {fb && (
            <motion.div
              variants={recallReveal}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              className={cn(
                "neo-inset-sm space-y-2 rounded-2xl p-4",
                fb.correct ? "bg-success-soft/50" : "bg-danger-soft/40",
              )}
              role="status"
            >
              <p className="flex items-center gap-2 text-sm font-bold">
                {fb.correct ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-success" /> Correct — yes, that&apos;s right.
                  </>
                ) : (
                  <>
                    <XCircle className="h-5 w-5 text-danger" /> Not quite
                  </>
                )}
              </p>
              {!fb.correct && (
                <>
                  <p className="text-[13px]">
                    <span className="font-semibold">Your answer: </span>
                    {LETTERS[picked[q.id] ?? 0]}. {q.options[picked[q.id] ?? 0]}
                  </p>
                  {fb.wrongWhy && (
                    <p className="text-[13px] leading-relaxed">
                      <span className="font-semibold">Why it is incorrect: </span>
                      {fb.wrongWhy}
                    </p>
                  )}
                  <p className="text-[13px]">
                    <span className="font-semibold">Correct answer: </span>
                    {LETTERS[fb.correctOptionIndex]}. {q.options[fb.correctOptionIndex]}
                  </p>
                </>
              )}
              <p className="text-[13px] leading-relaxed">
                <span className="font-semibold">Why: </span>
                {fb.explanation}
              </p>
            </motion.div>
          )}
          </AnimatePresence>
          {error && <p className="text-[13px] text-danger" role="alert">{error}</p>}
        </CardBody>
      </Card>
      </motion.div>
      </AnimatePresence>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" disabled={index === 0} onClick={() => setIndex((i) => i - 1)} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Prev
        </Button>
        {index < questions.length - 1 ? (
          <Button variant="outline" onClick={() => setIndex((i) => i + 1)} className="gap-1.5">
            Next <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={finish} loading={finishing} disabled={finishing || answeredCount < questions.length}>
            {answeredCount < questions.length ? `Answer all (${answeredCount}/${questions.length})` : "See results"}
          </Button>
        )}
      </div>
    </div>
  );
}
