"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCheck, HelpCircle, Lightbulb, Loader2, MessageSquarePlus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toaster";
import {
  answerQuestionAction,
  askQuestionAction,
  listAnswersAction,
  listQuestionsAction,
  markHelpfulAction,
  moderateAnswerAction,
  moderateQuestionAction,
  resolveQuestionAction,
  type AnswerDTO,
  type QuestionDTO,
} from "@/lib/actions/community";
import { listItem } from "@/components/motion/variants";

const STATUS_TONE: Record<string, "neutral" | "primary" | "success"> = { open: "neutral", answered: "primary", resolved: "success" };

function Thread({ questionId, isAdmin, onChanged }: { questionId: string; isAdmin: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [answers, setAnswers] = React.useState<AnswerDTO[]>([]);
  const [canHelp, setCanHelp] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const res = await listAnswersAction(questionId);
    if (res.ok) {
      setAnswers(res.answers);
      setCanHelp(res.question.own || isAdmin);
    }
  }, [questionId, isAdmin]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const post = async () => {
    if (draft.trim().length < 2 || busy) return;
    setBusy(true);
    const res = await answerQuestionAction({ questionId, content: draft.trim().slice(0, 4000) });
    setBusy(false);
    if (!res.ok) {
      toast("error", "Couldn't post answer", res.error);
      return;
    }
    setDraft("");
    toast("success", "Answer posted");
    await load();
    onChanged();
  };

  const moderate = async (id: string) => {
    const res = await moderateAnswerAction(id);
    if (!res.ok) {
      toast("error", "Couldn't moderate", res.error);
      return;
    }
    await load();
  };

  const helpful = async (id: string) => {
    const res = await markHelpfulAction(id);
    if (!res.ok) {
      toast("error", "Couldn't mark helpful", res.error);
      return;
    }
    await load();
  };

  return (
    <div className="mt-3 space-y-2 border-t-2 border-ink/10 pt-3">
      <AnimatePresence initial={false}>
        {answers.map((a) => (
          <motion.div key={a.id} variants={listItem} initial="hidden" animate="show" exit="exit" className={cn("rounded-[6px] border-2 px-3 py-2.5", a.helpful ? "border-ink bg-success-soft/60" : "border-ink/20 bg-muted/30")}>
            <p className="whitespace-pre-line text-[13px] leading-relaxed">{a.content}</p>
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>Answered by {a.by}</span>
              {a.helpful ? (
                <Badge tone="success">Helpful</Badge>
              ) : (
                canHelp && (
                  <button
                    type="button"
                    onClick={() => void helpful(a.id)}
                    className="cursor-pointer font-bold text-success hover:underline"
                  >
                    Mark as helpful
                  </button>
                )
              )}
              <span className="ml-auto flex gap-1">
                {isAdmin && (
                  <button type="button" onClick={() => void moderate(a.id)} aria-label="Remove answer" className="cursor-pointer rounded p-1 hover:text-danger">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </span>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      <div className="flex items-end gap-2">
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={4000} placeholder="Write an answer as a community member…" aria-label="Your answer" className="flex-1" />
        <Button size="sm" loading={busy} disabled={draft.trim().length < 2} onClick={post}>Post</Button>
      </div>
    </div>
  );
}

export function CommunityQA({ communityId, isAdmin }: { communityId: string; isAdmin: boolean }) {
  const { toast } = useToast();
  const [questions, setQuestions] = React.useState<QuestionDTO[]>([]);
  const [openThread, setOpenThread] = React.useState<string | null>(null);
  const [askOpen, setAskOpen] = React.useState(false);
  const [postType, setPostType] = React.useState<"question" | "answer">("question");
  const [title, setTitle] = React.useState("");
  const [content, setContent] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const res = await listQuestionsAction(communityId);
    if (res.ok) setQuestions(res.questions);
  }, [communityId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const ask = async () => {
    if (title.trim().length < 4 || busy) return;
    setBusy(true);
    const res = await askQuestionAction({ communityId, title: title.trim(), content: content.trim(), subject: subject.trim() || undefined });
    setBusy(false);
    if (!res.ok) {
      toast("error", "Couldn't post question", res.error);
      return;
    }
    setAskOpen(false);
    setTitle("");
    setContent("");
    setSubject("");
    toast("success", "Question posted anonymously");
    await load();
  };

  const resolve = async (id: string) => {
    const res = await resolveQuestionAction(id);
    if (!res.ok) {
      toast("error", "Couldn't resolve", res.error);
      return;
    }
    toast("success", "Question marked resolved");
    await load();
  };

  const moderate = async (id: string) => {
    const res = await moderateQuestionAction(id, true);
    if (!res.ok) {
      toast("error", "Couldn't moderate", res.error);
      return;
    }
    setQuestions((qs) => qs.filter((q) => q.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {questions.length} question{questions.length === 1 ? "" : "s"} · peer answers, clearly labeled
        </p>
        <Button
          size="sm"
          onClick={() => {
            setPostType("question");
            setAskOpen(true);
          }}
          className="gap-1.5"
        >
          <MessageSquarePlus className="h-4 w-4" /> Ask question
        </Button>
      </div>

      {questions.length === 0 ? (
        <EmptyState compact icon={<HelpCircle className="h-6 w-6" />} title="No questions yet" description="Ask the first question — members answer anonymously to prepare together." />
      ) : (
        <motion.div layout className="space-y-3">
          <AnimatePresence initial={false}>
            {questions.map((q) => (
              <motion.div key={q.id} variants={listItem} initial="hidden" animate="show" exit="exit" layout>
                <Card>
                  <CardBody className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={STATUS_TONE[q.status] ?? "neutral"}>{q.status}</Badge>
                      <p className="min-w-0 flex-1 text-[14px] font-bold leading-snug">{q.title}</p>
                    </div>
                    {q.content && <p className="whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground">{q.content}</p>}
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span>Asked by {q.by}</span>
                      {q.subject && <span>· {q.subject}</span>}
                      <span>· {q.answerCount} answer{q.answerCount === 1 ? "" : "s"}</span>
                      {q.status !== "resolved" && (q.own || isAdmin) && (
                        <button type="button" onClick={() => void resolve(q.id)} className="ml-auto inline-flex cursor-pointer items-center gap-1 font-bold text-success hover:underline">
                          <CheckCheck className="h-3.5 w-3.5" aria-hidden /> Mark resolved
                        </button>
                      )}
                      {isAdmin && (
                        <button type="button" onClick={() => void moderate(q.id)} aria-label={`Remove question ${q.title}`} className="cursor-pointer rounded p-1 hover:text-danger">
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenThread(openThread === q.id ? null : q.id);
                        setPostType("answer");
                      }}
                      className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold text-primary hover:underline"
                      aria-expanded={openThread === q.id}
                    >
                      <Lightbulb className="h-3.5 w-3.5" aria-hidden />
                      {openThread === q.id ? "Hide answers" : q.answerCount > 0 ? `View ${q.answerCount} answers / reply` : "Answer this question"}
                    </button>
                    {openThread === q.id && <Thread questionId={q.id} isAdmin={isAdmin} onChanged={load} />}
                  </CardBody>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <Dialog
        open={askOpen}
        onClose={() => setAskOpen(false)}
        title={postType === "question" ? "Ask a question" : "Post"}
        description="Posted anonymously — members see “Anonymous Student”, never your identity."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAskOpen(false)}>Cancel</Button>
            <Button loading={busy} disabled={title.trim().length < 4} onClick={ask}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Post question
            </Button>
          </>
        }
      >
        <div className="mb-4 flex gap-2" role="radiogroup" aria-label="Post type">
          {(["question", "answer"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={postType === t}
              onClick={() => setPostType(t)}
              className={cn(
                "flex-1 cursor-pointer rounded-[6px] border-2 px-3 py-2.5 text-[13px] font-bold transition-all",
                postType === t ? "border-ink bg-lime text-inkfill shadow-brutal-sm" : "border-ink/30 text-muted-foreground",
              )}
            >
              {t === "question" ? "❓ Question" : "💡 Answer"}
            </button>
          ))}
        </div>
        {postType === "question" ? (
          <div className="space-y-4">
            <Field label="Question title" required>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="e.g. Supervised vs unsupervised learning?" autoFocus />
            </Field>
            <Field label="Details">
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} maxLength={4000} rows={4} placeholder="What exactly is confusing?" />
            </Field>
            <Field label="Subject / topic (optional)">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={80} placeholder="e.g. Machine Learning" />
            </Field>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Answers belong under a question — open any question above and reply in its thread so context stays together.
          </p>
        )}
      </Dialog>
    </div>
  );
}
