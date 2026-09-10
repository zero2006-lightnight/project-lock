"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste, FileUp, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";
import { commitSyllabusImportAction } from "@/lib/actions/import";

type ParsedTopic = { name: string; difficulty: number };
type ParsedUnit = { name: string; topics: ParsedTopic[] };
type ParsedSubject = { name: string; units: ParsedUnit[] };

const MAX_UNITS = 12;
const MAX_TOPICS_PER_UNIT = 40;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function newImportId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Multipart POST with real upload progress (fetch can't report it). */
function postParse(form: FormData, onUploadProgress: (pct: number) => void): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/syllabus/parse");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUploadProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      resolve(new Response(xhr.responseText, { status: xhr.status, headers: { "Content-Type": "application/json" } }));
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(form);
  });
}

/**
 * Syllabus import: upload → parse (AI or built-in engine) → review/edit
 * the preview → confirm. Nothing touches the database until "Import".
 */
export function SyllabusImport({
  subjects,
}: {
  subjects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  // Stable per file pick — retries with the same file reuse the same
  // importId, so the server resumes instead of re-parsing.
  const [importId, setImportId] = React.useState<string>(() => newImportId());
  const [parsing, setParsing] = React.useState(false);
  const [uploadPct, setUploadPct] = React.useState<number | null>(null);
  const [failedStage, setFailedStage] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<{
    token: string;
    source: "ai" | "heuristic";
    warning?: string;
    subjects: ParsedSubject[];
  } | null>(null);
  const [target, setTarget] = React.useState<string>(""); // "" = new subject
  const [importMode, setImportMode] = React.useState<"merge" | "replace">("merge");
  const [pastedText, setPastedText] = React.useState("");
  const [newSubjectName, setNewSubjectName] = React.useState("");
  const [committing, setCommitting] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setParsing(false);
    setCommitting(false);
    setUploadPct(null);
    setFailedStage(null);
    setImportId(newImportId());
    setTarget("");
    setImportMode("merge");
    setPastedText("");
    setNewSubjectName("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const pickFile = (f: File | null) => {
    setFile(f);
    setPreview(null);
    setFailedStage(null);
    setUploadPct(null);
    // New file → new processing lifecycle; same file re-picked keeps
    // working because the server dedupes by content hash anyway.
    setImportId(newImportId());
  };

  const parse = async () => {
    if (!file && !pastedText.trim()) return;
    if (parsing) return;
    if (!file && pastedText.trim()) {
      const blob = new Blob([pastedText], { type: "text/plain" });
      setFile(new File([blob], "pasted-syllabus.txt", { type: "text/plain" }));
    }
    const sourceFile = file ?? new File([pastedText], "pasted-syllabus.txt", { type: "text/plain" });
    if (sourceFile.size > MAX_FILE_BYTES) {
      toast("error", "File too large", "Syllabus files can be up to 20 MB.");
      return;
    }
    setParsing(true);
    setPreview(null);
    setFailedStage(null);
    setUploadPct(0);
    try {
      const form = new FormData();
      form.append("file", sourceFile, sourceFile.name);
      if (target) form.append("subjectId", target);
      form.append("importId", importId);
      const res = await postParse(form, setUploadPct);
      // Upload bytes are on the server now — remaining stages are parse/structure.
      setUploadPct(null);
      const body = (await res.json().catch(() => null)) as {
        ok: boolean;
        token?: string;
        syllabus?: { subjects: ParsedSubject[] };
        source?: "ai" | "heuristic";
        warning?: string;
        stage?: string;
        error?: string;
      } | null;
      if (!res.ok || !body?.ok) {
        setFailedStage(body?.stage ?? null);
        const hint =
          body?.stage === "analysis"
            ? "Parsing succeeded — retry to re-analyze without re-uploading."
            : (body?.error ?? "Couldn't read that file. Try a different PDF or paste topics manually.");
        toast("error", "Import failed", body?.error ?? hint);
        return;
      }
      setPreview({ token: body.token!, source: body.source!, warning: body.warning, subjects: body.syllabus!.subjects });
      const first = body.syllabus!.subjects[0]?.name ?? "";
      if (!target && !newSubjectName && first) setNewSubjectName(first.slice(0, 80));
      if (body && (body as { reused?: boolean }).reused) {
        toast("success", "Already processed", "This exact file was parsed before — showing the stored structure.");
      }
    } catch {
      toast("error", "Import failed", "Connection problem — retry without re-uploading; your file is kept.");
    } finally {
      setParsing(false);
      setUploadPct(null);
    }
  };

  const commit = async () => {
    if (!preview || committing) return;
    if (!target && !newSubjectName.trim()) {
      toast("error", "Choose a subject", "Pick an existing subject or name the new one.");
      return;
    }
    setCommitting(true);
    try {
      const res = await commitSyllabusImportAction({
        token: preview.token,
        subjectId: target || null,
        newSubjectName: target ? null : newSubjectName.trim(),
        syllabus: { subjects: preview.subjects },
        mode: importMode,
      });
      if (!res.ok) {
        toast("error", "Import failed", res.error);
        return;
      }
      toast("success", "Syllabus imported", `${res.topicCount} topic${res.topicCount === 1 ? "" : "s"} added — the planner will start scheduling them.`);
      close();
      router.refresh();
    } catch {
      toast("error", "Import failed", "Connection problem — try again.");
    } finally {
      setCommitting(false);
    }
  };

  const editSubject = (si: number, name: string) =>
    setPreview((p) => (p ? { ...p, subjects: p.subjects.map((s, i) => (i === si ? { ...s, name } : s)) } : p));
  const editUnit = (si: number, ui: number, name: string) =>
    setPreview((p) =>
      p ? { ...p, subjects: p.subjects.map((s, i) => (i === si ? { ...s, units: s.units.map((u, j) => (j === ui ? { ...u, name } : u)) } : s)) } : p,
    );
  const editTopic = (si: number, ui: number, ti: number, patch: Partial<ParsedTopic>) =>
    setPreview((p) =>
      p
        ? {
            ...p,
            subjects: p.subjects.map((s, i) =>
              i === si
                ? {
                    ...s,
                    units: s.units.map((u, j) =>
                      j === ui ? { ...u, topics: u.topics.map((t, k) => (k === ti ? { ...t, ...patch } : t)) } : u,
                    ),
                  }
                : s,
            ),
          }
        : p,
    );
  const removeTopic = (si: number, ui: number, ti: number) =>
    setPreview((p) =>
      p
        ? {
            ...p,
            subjects: p.subjects.map((s, i) =>
              i === si
                ? { ...s, units: s.units.map((u, j) => (j === ui ? { ...u, topics: u.topics.filter((_, k) => k !== ti) } : u)) }
                : s,
            ),
          }
        : p,
    );
  const removeUnit = (si: number, ui: number) =>
    setPreview((p) =>
      p ? { ...p, subjects: p.subjects.map((s, i) => (i === si ? { ...s, units: s.units.filter((_, j) => j !== ui) } : s)) } : p,
    );

  const totalTopics = preview?.subjects.reduce((a, s) => a + s.units.reduce((b, u) => b + u.topics.length, 0), 0) ?? 0;

  return (
    <div>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="cursor-pointer">
        <FileUp className="h-4 w-4" /> Import syllabus
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title="Import syllabus"
        description="Upload or paste a syllabus, review the structure, then merge or replace one subject."
      >
        <div className="space-y-4">
          {/* Step 1: file */}
          {!preview && (
            <div className="space-y-4">
              <Field label="Syllabus document" hint="PDF, Word, Excel, CSV, Markdown or text — up to 20 MB.">
                <div
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    pickFile(event.dataTransfer.files?.[0] ?? null);
                  }}
                  className="rounded-xl border-2 border-dashed border-ink/30 bg-muted/30 p-3 transition-colors hover:border-primary/60 hover:bg-primary-soft/30"
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".pdf,.docx,.xls,.xlsx,.csv,.json,.txt,.md,image/*"
                    onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                    className="block w-full cursor-pointer rounded-lg bg-transparent px-1 py-2 text-sm file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground file:shadow-raise-sm"
                  />
                  <p className="px-1 text-[11px] text-muted-foreground">Drop a file here or choose one. Images are accepted as an OCR-ready placeholder.</p>
                </div>
              </Field>
              <Field label="Or paste syllabus text" hint="Useful for copied course outlines and notes.">
                <div className="relative">
                  <ClipboardPaste className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-muted-foreground" />
                  <textarea value={pastedText} onChange={(e) => { setPastedText(e.target.value); if (e.target.value) setFile(null); }} placeholder="UNIT 1\n1. Introduction\n2. Core concepts" className="min-h-24 w-full rounded-[6px] border-2 border-ink bg-input px-3.5 py-3 pr-10 text-sm outline-none focus:shadow-[4px_4px_0_0_var(--brutal-focus)]" />
                </div>
              </Field>
              <Field label="Add topics to">
                <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">— Create a new subject —</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {!target && (
                <Field label="New subject name">
                  <Input value={newSubjectName} onChange={(e) => setNewSubjectName(e.target.value)} placeholder="e.g. Database Management Systems" />
                </Field>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={close} className="cursor-pointer">
                  Cancel
                </Button>
                <Button size="sm" disabled={(!file && !pastedText.trim()) || parsing} onClick={parse} className="cursor-pointer">
                  {parsing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Parsing…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" /> Parse document
                    </>
                  )}
                </Button>
              </div>
              {target && (
                <Field label="When topics already exist">
                  <Select value={importMode} onChange={(e) => setImportMode(e.target.value as "merge" | "replace")}>
                    <option value="merge">Merge missing units and topics</option>
                    <option value="replace">Replace this subject's syllabus</option>
                  </Select>
                </Field>
              )}
              {parsing && (
                <div className="space-y-1.5" role="status" aria-live="polite">
                  {uploadPct !== null ? (
                    <>
                      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={uploadPct} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${uploadPct}%` }} />
                      </div>
                      <p className="text-center text-xs text-muted-foreground">Uploading… {uploadPct}% (real transfer progress)</p>
                    </>
                  ) : (
                    <p className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Upload complete — parsing document and structuring topics…
                    </p>
                  )}
                </div>
              )}
              {!parsing && failedStage && (
                <p className="text-center text-xs text-muted-foreground" role="alert">
                  {failedStage === "analysis"
                    ? "Parsing succeeded but analysis failed — press Parse document again to retry analysis without re-uploading."
                    : "Parsing failed — check the file and try again."}
                </p>
              )}
            </div>
          )}

          {/* Step 2: review */}
          {preview && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={cn("rounded-full px-2.5 py-1 font-semibold", preview.source === "ai" ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground")}>
                  {preview.source === "ai" ? "AI-parsed" : "Engine-parsed"}
                </span>
                <span className="text-muted-foreground">
                  {totalTopics} topic{totalTopics === 1 ? "" : "s"} in {preview.subjects.reduce((a, s) => a + s.units.length, 0)} units — edit anything before importing.
                </span>
              </div>
              {preview.warning && (
                <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {preview.warning}
                </p>
              )}

              <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl bg-muted/30 p-3 shadow-inset-sm">
                {preview.subjects.map((s, si) => (
                  <div key={si} className="space-y-2">
                    <Input value={s.name} onChange={(e) => editSubject(si, e.target.value)} aria-label="Subject name" className="font-semibold" />
                    {s.units.slice(0, MAX_UNITS).map((u, ui) => (
                      <div key={ui} className="rounded-lg bg-muted/30 p-2.5">
                        <div className="flex items-center gap-2">
                          <Input value={u.name} onChange={(e) => editUnit(si, ui, e.target.value)} aria-label="Unit name" className="text-[13px]" />
                          <button
                            onClick={() => removeUnit(si, ui)}
                            aria-label={`Remove unit ${u.name}`}
                            className="shrink-0 text-xs font-semibold text-danger hover:underline cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                        <ul className="mt-2 space-y-1.5">
                          {u.topics.slice(0, MAX_TOPICS_PER_UNIT).map((t, ti) => (
                            <li key={ti} className="flex items-center gap-2">
                              <Input
                                value={t.name}
                                onChange={(e) => editTopic(si, ui, ti, { name: e.target.value })}
                                aria-label="Topic name"
                                className="h-8 text-[12.5px]"
                              />
                              <Select
                                value={t.difficulty}
                                onChange={(e) => editTopic(si, ui, ti, { difficulty: Number(e.target.value) })}
                                aria-label={`Difficulty of ${t.name}`}
                                className="h-8 w-20 shrink-0 text-[12px]"
                              >
                                {[1, 2, 3, 4, 5].map((d) => (
                                  <option key={d} value={d}>
                                    {"•".repeat(d)}
                                  </option>
                                ))}
                              </Select>
                              <button
                                onClick={() => removeTopic(si, ui, ti)}
                                aria-label={`Remove topic ${t.name}`}
                                className="shrink-0 rounded p-1 text-muted-foreground hover:text-danger cursor-pointer"
                              >
                                ✕
                              </button>
                            </li>
                          ))}
                          {u.topics.length === 0 && <li className="text-[11px] italic text-muted-foreground">No topics parsed in this unit.</li>}
                        </ul>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {!target && (
                <Field label="Import as subject">
                  <Input value={newSubjectName} onChange={(e) => setNewSubjectName(e.target.value)} />
                </Field>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => { setPreview(null); setFile(null); }} className="cursor-pointer">
                  Back
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={close} className="cursor-pointer">
                    Cancel
                  </Button>
                  <Button size="sm" disabled={committing || totalTopics === 0} onClick={commit} className="cursor-pointer">
                    {committing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Importing…
                      </>
                    ) : (
                      <>Import {totalTopics} topics</>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
