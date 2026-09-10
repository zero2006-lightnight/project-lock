"use client";

import * as React from "react";
import { FileImage, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { transcribeMaterialImageAction } from "@/lib/actions/assess";
import { MATERIAL_MIN } from "@/lib/assess/quiz";

/* Reusable study-material input: pasted text, or a photo of notes
   transcribed through the vision-capable provider (honest fallback). */

export function StudyMaterialInput({
  value,
  onChange,
  id = "study-material",
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
}) {
  const [transcribing, setTranscribing] = React.useState(false);
  const [imgError, setImgError] = React.useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const len = value.trim().length;
  const enough = len >= MATERIAL_MIN;

  // Client-side guard: the provider call can never hang the spinner —
  // after 30s we stop waiting and offer a retry (text is never lost).
  const withClientTimeout = <T,>(p: Promise<T>, ms = 30_000): Promise<T> =>
    Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

  React.useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const onFile = async (file: File | undefined) => {
    if (!file || transcribing) return;
    // Instant preview + dimensions while the transcription runs.
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setImgError(null);
    setTranscribing(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(((r.result as string) ?? "").split(",")[1] ?? "");
        r.onerror = () => reject(new Error("read failed"));
        r.readAsDataURL(file);
      });
      const r = await withClientTimeout(transcribeMaterialImageAction({ imageBase64: base64, mimeType: file.type }));
      if (!r.ok) {
        setImgError(r.error);
        return;
      }
      onChange(value ? `${value}\n\n${r.text}` : r.text);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    } catch {
      setImgError("Taking too long — the image is kept above. Retry, or paste the text instead.");
    } finally {
      setTranscribing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold">
          Study material
        </label>
        <span className={cn("text-xs tabular-nums", enough ? "text-success" : "text-muted-foreground")}>
          {len} / {MATERIAL_MIN} min chars
        </span>
      </div>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        maxLength={13000}
        placeholder="Paste your notes, textbook chapter, or key concepts here — the quiz and evaluation are built only from this material…"
        className="neo-inset-sm w-full resize-y rounded-2xl bg-muted/40 px-4 py-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring"
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          aria-label="Upload a photo of study material"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={transcribing}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          {transcribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileImage className="h-4 w-4" />}
          {transcribing ? "Reading photo…" : "Add from photo"}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-danger"
          >
            <X className="h-4 w-4" /> Clear
          </button>
        )}
      </div>
      {previewUrl && (
        <div className="flex items-center gap-3 rounded-xl bg-muted/40 p-2.5 shadow-inset-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Selected study material preview" className="h-16 w-16 shrink-0 rounded-lg border border-border object-cover" />
          <div className="min-w-0 text-xs text-muted-foreground">
            <p className="truncate font-medium text-foreground">Photo attached</p>
            <p>{transcribing ? "Reading your photo — transcribing every readable line…" : "Ready — transcribed text appears above."}</p>
          </div>
          {!transcribing && (
            <button type="button" onClick={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }} aria-label="Remove photo preview" className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:text-danger cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      {transcribing && !previewUrl && <p className="text-xs text-muted-foreground">Reading your photo — transcribing every readable line…</p>}
      {imgError && <p className="text-[13px] text-danger">{imgError}</p>}
      {!enough && len > 0 && (
        <p className="text-xs text-muted-foreground">Add a little more context so questions stay grounded in real material.</p>
      )}
    </div>
  );
}
