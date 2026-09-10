"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Loader2, MessageSquareHeart, Send } from "lucide-react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";
import { submitFeedbackAction } from "@/lib/actions/feedback";
import type { FeedbackCategory } from "@/lib/db/schema";
import { recallReveal, successPop } from "@/components/motion/variants";

/* ──────────────────────────────────────────────────────────────
   Profile → Feedback. Enhancement-only: category + optional
   rating + text → validate → store → toast. Input is preserved
   on failure with an inline retry. Nothing here touches AI,
   auth, or any other workflow.
   ────────────────────────────────────────────────────────────── */

const CATEGORIES: { key: FeedbackCategory; label: string }[] = [
  { key: "ai_answer", label: "AI answer" },
  { key: "pilot", label: "Pilot" },
  { key: "tuning", label: "AI tuning" },
  { key: "accuracy", label: "Accuracy" },
  { key: "performance", label: "Performance" },
  { key: "ui_ux", label: "UI / UX" },
  { key: "bug", label: "Bug or problem" },
  { key: "feature", label: "Feature suggestion" },
  { key: "general", label: "General feedback" },
];

const RATINGS = [
  { value: 1, face: "😞", label: "Poor" },
  { value: 2, face: "😐", label: "Okay" },
  { value: 3, face: "🙂", label: "Good" },
  { value: 4, face: "😊", label: "Great" },
  { value: 5, face: "🤩", label: "Excellent" },
];

export function FeedbackForm() {
  const { toast } = useToast();
  const pathname = usePathname();
  const [category, setCategory] = React.useState<FeedbackCategory>("general");
  const [rating, setRating] = React.useState<number | null>(null);
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);

  const submit = async () => {
    if (sending) return;
    if (text.trim().length < 4) {
      setError("Tell us a little more — a few words at least.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await submitFeedbackAction({
        category,
        rating,
        text: text.trim().slice(0, 4000),
        feature: pathname || undefined,
      });
      if (!res.ok) {
        setError(res.error); // input preserved for retry
        return;
      }
      setSent(true);
      setText("");
      setRating(null);
      toast("success", "Thank you! Your feedback has been submitted and will help improve Project Lock.");
    } catch {
      setError("Connection problem — your text is kept, try again."); // input preserved
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 block text-[13px] font-medium text-foreground">Category</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Feedback category">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={category === c.key}
              onClick={() => setCategory(c.key)}
              className={cn(
                "cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
                category === c.key
                  ? "bg-primary-soft/80 text-primary shadow-inset-sm ring-1 ring-inset ring-primary/30"
                  : "bg-card text-muted-foreground shadow-raise-sm hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 block text-[13px] font-medium text-foreground">
          How was your experience? <span className="font-normal text-muted-foreground">(optional)</span>
        </p>
        <div className="flex gap-1.5" role="radiogroup" aria-label="Experience rating">
          {RATINGS.map((r) => (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={rating === r.value}
              aria-label={`${r.value} out of 5: ${r.label}`}
              title={r.label}
              onClick={() => setRating(rating === r.value ? null : r.value)}
              className={cn(
                "cursor-pointer rounded-xl px-2.5 py-1.5 text-xl transition-all",
                rating === r.value ? "bg-primary-soft/80 shadow-inset-sm ring-1 ring-inset ring-primary/30" : "hover:bg-muted/60",
                rating !== null && rating !== r.value && "opacity-45 grayscale",
              )}
            >
              <span aria-hidden>{r.face}</span>
            </button>
          ))}
        </div>
      </div>

      <Field label="Your feedback" hint="Tell us what worked well, what did not work, or how we can improve.">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={4000}
          rows={5}
          placeholder="Tell us what worked well, what did not work, or how we can improve…"
          aria-label="Your feedback"
        />
      </Field>

      <AnimatePresence>
        {error && (
          <motion.p
            variants={recallReveal}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            className="text-[13px] font-medium text-danger"
            role="alert"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sent && (
          <motion.div
            variants={successPop}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            className="flex items-start gap-2.5 rounded-[6px] border-2 border-ink bg-success-soft px-4 py-3 shadow-brutal-sm"
            role="status"
          >
            <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-success" aria-hidden />
            <p className="text-[13px] font-medium text-success">Feedback received — thank you for helping improve Project Lock.</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex justify-end">
        <Button loading={sending} disabled={sending || text.trim().length < 4} onClick={submit} className="gap-1.5">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {sending ? "Sending…" : error ? "Retry" : "Submit feedback"}
        </Button>
      </div>
    </div>
  );
}

export function FeedbackCard() {
  return (
    <div>
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] border-2 border-ink bg-lime text-inkfill shadow-brutal-sm">
          <MessageSquareHeart className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-semibold">Help us improve Project Lock</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Your feedback helps us improve Project Lock, Pilot, and AI responses.
          </p>
        </div>
      </div>
      <FeedbackForm />
    </div>
  );
}
