"use client";

import * as React from "react";
import { ClipboardList, LayoutGrid, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExamManager } from "./exam-manager";
import { QuizRunner } from "./quiz-runner";
import { SummaryRunner } from "./summary-runner";

type SubjectRef = { id: string; name: string };
type ExamAgg = React.ComponentProps<typeof ExamManager>["exams"];

/* Exams workspace: existing Overview untouched, plus the two new
   assessment modes as clearly separated tabs. */
export function ExamsWorkspace({ exams, subjects }: { exams: ExamAgg; subjects: SubjectRef[] }) {
  const [tab, setTab] = React.useState<"overview" | "quiz" | "summary">("overview");
  const firstSubjectId = subjects[0]?.id;

  return (
    <div className="space-y-5">
      <div className="neo-inset-sm flex w-fit max-w-full gap-1 overflow-x-auto rounded-2xl bg-muted/40 p-1.5" role="tablist" aria-label="Exams sections">
        {(
          [
            { id: "overview", label: "Overview", icon: LayoutGrid },
            { id: "quiz", label: "Quiz", icon: ClipboardList },
            { id: "summary", label: "Summary Practice", icon: PenLine },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl px-4 py-2 text-[13px] font-semibold transition-all",
              tab === t.id ? "neo-raise-sm bg-card text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <ExamManager exams={exams} subjects={subjects} />}

      {tab === "quiz" && (
        <div className="animate-fade-up">
          <QuizRunner subjectId={firstSubjectId} />
        </div>
      )}

      {tab === "summary" && (
        <div className="animate-fade-up">
          <SummaryRunner subjectId={firstSubjectId} />
        </div>
      )}
    </div>
  );
}
