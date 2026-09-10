"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, GraduationCap, Layers, Plus, Target, Trash2, Zap } from "lucide-react";
import { format } from "date-fns";
import { parseISO } from "date-fns";
import { cn, formatMinutes } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress, Ring } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toaster";
import { addExamAction, deleteExamAction } from "@/lib/actions/curriculum";
import type { ExamAgg } from "@/lib/services/types";

function ExamCard({ exam, onDelete }: { exam: ExamAgg; onDelete: () => void }) {
  const [open, setOpen] = React.useState(false);
  const d = exam.daysLeft;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{exam.examName}</CardTitle>
            {exam.subjectName && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-inset-sm">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: exam.subjectColor ?? "var(--color-muted-foreground)" }} />
                {exam.subjectName}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {format(parseISO(exam.examDate), "EEE, MMM d, yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={d <= 3 ? "danger" : d <= 7 ? "warning" : "primary"} className="gap-1.5">
            <CalendarClock className="h-3 w-3" /> {d} day{d === 1 ? "" : "s"} left
          </Badge>
          <Button size="icon-sm" variant="ghost" aria-label={`Delete ${exam.examName}`} className="text-danger" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardBody>
        <div className="flex items-center gap-5">
          <Ring
            value={exam.readiness}
            size={92}
            stroke={8}
            tone={exam.readiness >= 80 ? "success" : exam.readiness >= 50 ? "primary" : "warning"}
            label={`${exam.readiness}%`}
            sublabel="ready"
          />
          <div className="min-w-0 flex-1 space-y-2.5">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Syllabus covered</span>
                <span className="font-semibold tabular-nums">{exam.syllabusPercent}%</span>
              </div>
              <Progress value={exam.syllabusPercent} tone={exam.syllabusPercent >= 80 ? "success" : "primary"} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5" /> {exam.recommendedSessions} recommended sessions
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" /> {formatMinutes(exam.remainingMinutes)} of work left
              </span>
            </div>
            {exam.weakTopics.length > 0 && (
              <div className="rounded-xl bg-warning-soft/50 px-3 py-2">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-warning">
                  <Zap className="h-3 w-3" /> Focus here first
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{exam.weakTopics.map((w) => w.name).join(", ")}</p>
              </div>
            )}
          </div>
        </div>

        {/* phases */}
        <div className="mt-5">            <button
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-xl bg-muted/50 px-3.5 py-2.5 text-[13px] font-semibold shadow-inset-sm transition-colors hover:bg-muted cursor-pointer"
            aria-expanded={open}
          >
            Exam roadmap
            <span className={cn("transition-transform", open && "rotate-180")}>▾</span>
          </button>
          {open && (
            <ol className="mt-3 space-y-2.5">
              {exam.phases.map((p, i) => (
                <li key={p.key} className="relative flex gap-3 pl-1">
                  <div className="flex flex-col items-center">
                    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", i === exam.phases.length - 1 ? "bg-success text-white shadow-raise-sm" : "bg-card text-primary shadow-raise-sm")}>
                      {i + 1}
                    </span>
                    {i < exam.phases.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
                  </div>
                  <div className="pb-1">
                    <p className="text-[13px] font-semibold">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {format(parseISO(p.from), "MMM d")} – {format(parseISO(p.to), "MMM d")}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{p.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

export function ExamManager({ exams, subjects }: { exams: ExamAgg[]; subjects: { id: string; name: string }[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [subjectId, setSubjectId] = React.useState(subjects[0]?.id ?? "");
  const [date, setDate] = React.useState(() => {
    const d = new Date(Date.now() + 14 * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [importance, setImportance] = React.useState(2);
  const [busy, setBusy] = React.useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {exams.length} exam{exams.length === 1 ? "" : "s"} · countdowns and readiness computed live from your syllabus
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add exam
        </Button>
      </div>

      {exams.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="h-6 w-6" />}
          title="No exams yet"
          description="Add your exams and StudyPilot will build a learning → practice → revision → mock roadmap for each one."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Add exam
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {exams.map((e) => (
            <ExamCard
              key={e.examId}
              exam={e}
              onDelete={async () => {
                await deleteExamAction(e.examId);
                toast("success", "Exam deleted");
                router.refresh();
              }}
            />
          ))}
        </div>
      )}

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add an exam"
        description="The engine will fold its syllabus into your plan automatically."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={!name.trim() || !date}
              onClick={async () => {
                setBusy(true);
                const res = await addExamAction({ name, subjectId: subjectId || null, date, importance });
                setBusy(false);
                if (res.ok) {
                  setAddOpen(false);
                  setName("");
                  toast("success", "Exam added — roadmap generated");
                  router.refresh();
                } else {
                  toast("error", "Could not add exam", res.error);
                }
              }}
            >
              Add exam
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Exam name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. DBMS Mid-Term" autoFocus />
          </Field>
          <Field label="Subject">
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">No subject (general exam)</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Exam date" required>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Importance">
              <Select value={importance} onChange={(e) => setImportance(Number(e.target.value))}>
                <option value={1}>Low</option>
                <option value={2}>Medium</option>
                <option value={3}>High</option>
              </Select>
            </Field>
          </div>
        </div>
      </Dialog>
    </div>
  );
}