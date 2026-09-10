"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Layers, Loader2, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingStages, useStagedBusy } from "@/components/motion/feedback";
import { quizQuestion, recallReveal } from "@/components/motion/variants";
import { SourceToggle, SyllabusScopePicker, useSyllabusTree } from "./study-source-picker";
import {
  deleteFlashcardAction,
  generateFlashcardsAction,
  getFlashcardsAction,
  gradeFlashcardAction,
} from "@/lib/actions/study";

type CardT = { id: string; front: string; back: string };
type SavedCard = CardT & { subjectName: string | null; reviewCount: number };

/* Tactile 3D flip — front/back faces with preserved readability.
   Tap, click, or Enter/Space flips. Reduced motion falls back to a
   crossfade via MotionConfig reducedMotion="user". */
function AnswerCard({ card, revealed, onToggle }: { card: CardT; revealed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={revealed}
      aria-label={revealed ? "Show question side" : "Show answer side"}
      className="block w-full cursor-pointer text-left [perspective:1200px]"
    >
      <motion.div
        animate={{ rotateY: revealed ? 180 : 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative min-h-44 [transform-style:preserve-3d]"
      >
        {/* Front — question */}
        <div
          aria-hidden={revealed}
          className="w-full rounded-[6px] border-2 border-ink bg-card p-6 shadow-brutal [backface-visibility:hidden]"
        >
          <Badge tone="primary" className="w-fit">
            Question
          </Badge>
          <p className="mt-2 text-[16px] font-semibold leading-relaxed">{card.front}</p>
          <p className="mt-2 text-xs text-muted-foreground">Tap to reveal the answer</p>
        </div>
        {/* Back — answer, pre-rotated so text never mirrors */}
        <div
          aria-hidden={!revealed}
          className="absolute inset-0 w-full rounded-[6px] border-2 border-ink bg-lime p-6 text-inkfill shadow-brutal [backface-visibility:hidden] [transform:rotateY(180deg)]"
        >
          <Badge tone="success" className="w-fit">
            Answer
          </Badge>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed">{card.back}</p>
          <p className="mt-2 text-xs opacity-70">Tap to flip back</p>
        </div>
      </motion.div>
    </button>
  );
}

function Viewer({
  cards,
  onRate,
  onDelete,
  onExit,
}: {
  cards: CardT[];
  onRate: (id: string, rating: "easy" | "practice" | "hard") => void;
  onDelete?: (id: string) => void;
  onExit: () => void;
}) {
  const [index, setIndex] = React.useState(0);
  const [revealed, setRevealed] = React.useState(false);
  const [rated, setRated] = React.useState<Record<string, "easy" | "practice" | "hard">>({});
  const card = cards[index];
  if (!card) return null;
  const go = (d: number) => {
    setIndex((i) => Math.min(cards.length - 1, Math.max(0, i + d)));
    setRevealed(false);
  };
  // Rating records recall and stays on the card — it never navigates.
  const rate = (r: "easy" | "practice" | "hard") => {
    onRate(card.id, r);
    setRated((prev) => ({ ...prev, [card.id]: r }));
  };
  const myRating = rated[card.id];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold tabular-nums">
          Card {index + 1} of {cards.length}
        </p>
        <div className="neo-inset-sm h-2.5 w-40 overflow-hidden rounded-full bg-muted/50">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((index + 1) / cards.length) * 100}%` }} />
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={card.id} variants={quizQuestion} initial="hidden" animate="show" exit="exit">
          <AnswerCard card={card} revealed={revealed} onToggle={() => setRevealed((f) => !f)} />
        </motion.div>
      </AnimatePresence>
      {!revealed ? (
        <Button onClick={() => setRevealed(true)} className="w-full sm:w-auto">
          Show answer
        </Button>
      ) : (
        <motion.div variants={recallReveal} initial="hidden" animate="show" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="How well did you recall this?">
            <span className="text-xs font-semibold text-muted-foreground">Recall:</span>
            {(
              [
                { id: "easy", label: "Easy" },
                { id: "practice", label: "Need practice" },
                { id: "hard", label: "Hard" },
              ] as const
            ).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => rate(r.id)}
                aria-pressed={myRating === r.id}
                className={cn(
                  "cursor-pointer rounded-xl px-4 py-2 text-[13px] font-semibold transition-all hover:-translate-y-0.5",
                  myRating === r.id ? "bg-primary text-primary-foreground" : "neo-raise-sm bg-card",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          {myRating && (
            <p className="text-xs text-muted-foreground" role="status">
              Marked as {myRating === "practice" ? "need practice" : myRating} — this card stays here; move on when ready.
            </p>
          )}
          <Button variant="outline" onClick={() => setRevealed(false)} className="w-full sm:w-auto">
            Hide answer
          </Button>
        </motion.div>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button variant="outline" disabled={index === 0} onClick={() => go(-1)} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Prev
          </Button>
          <Button variant="outline" disabled={index === cards.length - 1} onClick={() => go(1)} className="gap-1.5">
            Next <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-2">
          {onDelete && (
            <Button variant="outline" onClick={() => onDelete(card.id)} className="gap-1.5 text-danger" aria-label="Delete this card">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="outline" onClick={onExit} className="gap-1.5">
            <RotateCcw className="h-4 w-4" /> Done
          </Button>
        </div>
      </div>
    </div>
  );
}

export function FlashcardsStudio({
  initialSaved,
  signals,
}: {
  initialSaved: SavedCard[];
  signals: { needsPractice: { subjectName: string | null; topic: string; missed: number }[]; revisionTopics: { subjectName: string; topicName: string }[] };
}) {
  const [source, setSource] = React.useState<"syllabus" | "general">("syllabus");
  const tree = useSyllabusTree();
  const [selSubjectRaw, setSelSubject] = React.useState("");
  const selSubject = selSubjectRaw || tree?.[0]?.id || "";
  const [selUnit, setSelUnit] = React.useState("");
  const [selTopic, setSelTopic] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [count, setCount] = React.useState(8);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [deck, setDeck] = React.useState<CardT[] | null>(null);
  const [saved, setSaved] = React.useState<SavedCard[]>(initialSaved);
  const [reviewSaved, setReviewSaved] = React.useState(false);
  const cardStage = useStagedBusy(busy, ["Reading syllabus scope", "Extracting key concepts", "Writing cards"]);

  const refreshSaved = async () => setSaved(await getFlashcardsAction());

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await generateFlashcardsAction({
        source,
        subjectId: source === "syllabus" ? selSubject || undefined : undefined,
        unitId: selUnit || undefined,
        topicId: selTopic || undefined,
        prompt: source === "general" ? prompt || undefined : undefined,
        count,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDeck(r.cards);
      setReviewSaved(false);
      void refreshSaved();
    } finally {
      setBusy(false);
    }
  };

  const rate = (id: string, rating: "easy" | "practice" | "hard") => {
    void gradeFlashcardAction({ cardId: id, rating }).then(() => void refreshSaved());
  };

  const remove = (id: string) => {
    void deleteFlashcardAction(id).then(() => {
      setDeck((d) => (d ? d.filter((c) => c.id !== id) : d));
      setSaved((s) => s.filter((c) => c.id !== id));
    });
  };

  if (deck) {
    return <Viewer cards={deck} onRate={rate} onExit={() => setDeck(null)} />;
  }
  if (reviewSaved) {
    return <Viewer cards={saved} onRate={rate} onDelete={remove} onExit={() => setReviewSaved(false)} />;
  }

  const canStart = !busy && (source === "general" ? prompt.trim().length >= 3 : selSubject !== "");
  return (
    <div className="space-y-5">
      {(signals.needsPractice.length > 0 || signals.revisionTopics.length > 0) && (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-semibold">Worth reviewing:</p>
            {signals.needsPractice.slice(0, 3).map((w) => (
              <button
                key={w.topic}
                type="button"
                onClick={() => {
                  setSource("general");
                  setPrompt(w.topic);
                }}
                className="neo-raise-sm cursor-pointer rounded-full bg-card px-3 py-1.5 text-xs font-medium transition-all hover:-translate-y-0.5"
                title={`Missed ${w.missed} time${w.missed === 1 ? "" : "s"} in recent quizzes`}
              >
                {w.topic}
              </button>
            ))}
            {signals.revisionTopics.slice(0, 3).map((t) => (
              <button
                key={`${t.subjectName}:${t.topicName}`}
                type="button"
                onClick={() => {
                  setSource("general");
                  setPrompt(t.topicName);
                }}
                className="neo-raise-sm cursor-pointer rounded-full bg-card px-3 py-1.5 text-xs font-medium transition-all hover:-translate-y-0.5"
              >
                {t.topicName}
              </button>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" /> New flashcards
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <SourceToggle value={source} onChange={setSource} />
          {source === "syllabus" ? (
            tree === null ? (
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
            )
          ) : (
            <label className="block space-y-1.5">
              <span className="block text-xs font-semibold text-muted-foreground">Topic or concept</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="What should the cards cover? e.g. BFS vs DFS, Photosynthesis…"
                className="neo-inset-sm w-full resize-none rounded-2xl bg-muted/40 px-4 py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring"
              />
            </label>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1.5">
              <span className="block text-xs font-semibold text-muted-foreground">Cards</span>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="neo-inset-sm h-10 rounded-xl bg-muted/40 px-3 text-sm outline-none"
              >
                {[4, 6, 8, 10, 12].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && <p className="text-[13px] text-danger" role="alert">{error}</p>}
          {busy && (
            <LoadingStages
              stages={["Reading syllabus scope", "Extracting key concepts", "Writing cards"]}
              stageIndex={cardStage}
              busyLabel="Writing cards"
            />
          )}
          <Button onClick={generate} loading={busy} disabled={!canStart} className="w-full sm:w-auto">
            {busy ? "Writing cards…" : "Generate flashcards"}
          </Button>
        </CardBody>
      </Card>

      {saved.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" /> Saved decks ({saved.length})
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-[13px] text-muted-foreground">
              Every generated card is kept — review them any time, rate your recall, and Pilot spaces the hard ones closer.
            </p>
            <Button variant="outline" onClick={() => setReviewSaved(true)} className="gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />} Review saved cards
            </Button>
            <ul className="space-y-1.5">
              {saved.slice(0, 6).map((c) => (
                <li key={c.id} className="neo-inset-sm rounded-xl bg-muted/30 px-3 py-2 text-[13px]">
                  <span className="font-medium">{c.front.length > 90 ? `${c.front.slice(0, 90)}…` : c.front}</span>
                  {c.subjectName && <span className="text-muted-foreground"> · {c.subjectName}</span>}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
