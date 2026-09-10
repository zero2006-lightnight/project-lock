"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { getStudySyllabusAction } from "@/lib/actions/study";

/* Shared Study Intelligence selectors — one syllabus path for Quiz,
   Flashcards, and Mind Maps. No duplicated retrieval logic. */

export type SyllabusTree = {
  id: string;
  name: string;
  units: { id: string; name: string; topics: { id: string; name: string; status: string }[] }[];
};

export function SourceToggle({
  value,
  onChange,
}: {
  value: "syllabus" | "general";
  onChange: (v: "syllabus" | "general") => void;
}) {
  return (
    <div className="neo-inset-sm flex w-fit rounded-xl bg-muted/40 p-1" role="group" aria-label="Study source">
      {(["syllabus", "general"] as const).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={cn(
            "cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-all",
            value === s ? "neo-raise-sm bg-card text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

export function useSyllabusTree() {
  const [tree, setTree] = React.useState<SyllabusTree[] | null>(null);
  React.useEffect(() => {
    let live = true;
    void getStudySyllabusAction().then((t) => {
      if (live) setTree(t);
    });
    return () => {
      live = false;
    };
  }, []);
  return tree;
}

const selectCls = "neo-inset-sm h-10 w-full rounded-xl bg-muted/40 px-3 text-sm outline-none disabled:opacity-50";

export function SyllabusScopePicker({
  tree,
  subject,
  unit,
  topic,
  onSubject,
  onUnit,
  onTopic,
}: {
  tree: SyllabusTree[];
  subject: string;
  unit: string;
  topic: string;
  onSubject: (id: string) => void;
  onUnit: (id: string) => void;
  onTopic: (id: string) => void;
}) {
  const units = tree.find((s) => s.id === subject)?.units ?? [];
  const topics = units.find((u) => u.id === unit)?.topics ?? [];
  if (!tree.length) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No syllabus yet — add subjects in Syllabus first, or switch to a General prompt.
      </p>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="space-y-1.5">
        <span className="block text-xs font-semibold text-muted-foreground">Subject</span>
        <select value={subject} onChange={(e) => onSubject(e.target.value)} className={selectCls}>
          {tree.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1.5">
        <span className="block text-xs font-semibold text-muted-foreground">Unit (optional)</span>
        <select value={unit} onChange={(e) => onUnit(e.target.value)} className={selectCls}>
          <option value="">Whole subject</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1.5">
        <span className="block text-xs font-semibold text-muted-foreground">Topic (optional)</span>
        <select value={topic} onChange={(e) => onTopic(e.target.value)} disabled={!unit} className={selectCls}>
          <option value="">Whole {unit ? "unit" : "subject"}</option>
          {topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
