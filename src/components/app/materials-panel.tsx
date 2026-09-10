"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, FileSpreadsheet, FileImage, FileType2, Upload, Trash2, Loader2, RotateCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toaster";
import {
  uploadMaterialAction,
  listMaterialsAction,
  deleteMaterialAction,
} from "@/lib/actions/materials";

const KIND_ICON: Record<string, typeof FileText> = {
  pdf: FileType2,
  word: FileText,
  excel: FileSpreadsheet,
  text: FileText,
  image: FileImage,
};

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // hard limit — rejected immediately
const COMPRESS_OVER = 2 * 1024 * 1024; // images over 2 MB are downscaled
const UPLOAD_TIMEOUT_MS = 30_000;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

type PendingImage = {
  file: File;
  previewUrl: string;
  width: number | null;
  height: number | null;
};

/**
 * Multipart POST with real upload progress (fetch can't report it),
 * a hard 30 s timeout, and an AbortController so cancel actually
 * stops the transfer. Always settles — no hanging promises.
 */
function postMultipart(
  form: FormData,
  signal: AbortSignal,
  onUploadProgress: (pct: number) => void,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => xhr.abort(), UPLOAD_TIMEOUT_MS);
    xhr.open("POST", "/api/material/upload");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUploadProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText || "null");
      } catch {
        body = null;
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body });
    };
    xhr.onerror = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new Error("network"));
    };
    xhr.onabort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new Error("aborted"));
    };
    xhr.ontimeout = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new Error("timeout"));
    };
    xhr.send(form);
  });
}

export function MaterialsPanel({
  subjects,
}: {
  subjects: { id: string; name: string }[];
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [items, setItems] = React.useState<Awaited<ReturnType<typeof listMaterialsAction>>>([]);
  const [subjectId, setSubjectId] = React.useState<string>("");
  const [uploading, setUploading] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [uploadPct, setUploadPct] = React.useState<number | null>(null);
  const [pendingImage, setPendingImage] = React.useState<PendingImage | null>(null);
  const [lastFailed, setLastFailed] = React.useState<File | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async (filter: string) => {
    const rows = await listMaterialsAction(filter || undefined);
    setItems(rows);
  }, []);

  // Load once per distinct subject filter (ref-guarded, dedupes StrictMode).
  const loadedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (loadedFor.current === subjectId) return;
    loadedFor.current = subjectId;
    void load(subjectId);
  }, [subjectId, load]);

  // Revoke object URLs on unmount so previews never leak.
  React.useEffect(() => {
    return () => {
      setPendingImage((p) => {
        if (p) URL.revokeObjectURL(p.previewUrl);
        return null;
      });
    };
  }, []);

  // Images over 2 MB are downscaled client-side (max 1920px, PNG keeps
  // transparency; everything else compresses to WebP when beneficial).
  const prepareImage = async (file: File): Promise<File> => {
    if (!file.type.startsWith("image/") || file.size <= COMPRESS_OVER) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        bitmap.close();
        return file;
      }
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dims = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      // PNG stays PNG so transparency survives; other formats try WebP.
      const targetType = file.type === "image/png" ? "image/png" : "image/webp";
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, targetType, 0.85));
      if (!blob || blob.size >= file.size) return file;
      const ext = targetType === "image/png" ? "png" : "webp";
      const base = file.name.replace(/\.[a-z0-9]+$/i, "") || "image";
      void dims;
      return new File([blob], `${base}.${ext}`, { type: targetType });
    } catch {
      return file;
    }
  };

  /** Validate + stage an image: instant preview, dimensions, size. */
  const stageFile = async (file: File): Promise<boolean> => {
    if (file.type.startsWith("image/")) {
      if (!IMAGE_TYPES.includes(file.type)) {
        toast("error", "Unsupported image format", "Use PNG, JPG, WEBP or GIF.");
        return false;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast("error", "Image too large", `${file.name} is ${formatBytes(file.size)} — the limit is 10 MB.`);
        return false;
      }
      const previewUrl = URL.createObjectURL(file);
      let width: number | null = null;
      let height: number | null = null;
      try {
        const bitmap = await createImageBitmap(file);
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
      } catch {
        /* dimensions are best-effort */
      }
      setPendingImage((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return { file, previewUrl, width, height };
      });
      return true;
    }
    // Non-image documents upload directly (no preview stage).
    return runUpload(file);
  };

  const resetUploadState = () => {
    setUploading(false);
    setUploadPct(null);
    abortRef.current = null;
  };

  const runUpload = async (file: File): Promise<boolean> => {
    setUploading(true);
    setUploadPct(0);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const prepared = await prepareImage(file);
      if (prepared.type.startsWith("image/")) {
        // Multipart route: real progress + timeout + cancel.
        const form = new FormData();
        form.append("file", prepared, prepared.name);
        if (subjectId) form.append("subjectId", subjectId);
        const res = await postMultipart(form, controller.signal, setUploadPct);
        const body = (res.body ?? {}) as { ok?: boolean; error?: string; id?: string };
        if (!res.ok || !body.ok) {
          setLastFailed(file);
          toast("error", `Couldn't upload ${file.name}`, body.error ?? `Upload failed (${res.status}).`);
          return false;
        }
        setPendingImage((prev) => {
          if (prev) URL.revokeObjectURL(prev.previewUrl);
          return null;
        });
        setLastFailed(null);
        toast("success", `${file.name} uploaded`, "Stored — the preview now uses the saved copy.");
      } else {
        // Documents keep the base64 server-action path.
        const buffer = await prepared.arrayBuffer();
        let binary = "";
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        const res = await uploadMaterialAction({
          fileName: prepared.name,
          mimeType: prepared.type || "application/octet-stream",
          dataBase64: btoa(binary),
          subjectId: subjectId || undefined,
        });
        if (!res.ok) {
          setLastFailed(file);
          toast("error", `Couldn't upload ${prepared.name}`, res.error);
          return false;
        }
        setLastFailed(null);
        toast(
          "success",
          `${prepared.name} ready`,
          res.warning ??
            `Extracted ${res.charCount.toLocaleString()} characters — Pilot now answers from this material.`,
        );
      }
      await load(subjectId);
      router.refresh();
      return true;
    } catch (err) {
      setLastFailed(file);
      const message =
        err instanceof Error && err.message === "aborted"
          ? "Upload canceled."
          : err instanceof Error && err.message === "timeout"
            ? "Upload timed out after 30 seconds — retry when ready."
            : "Connection problem during upload.";
      toast("error", `Upload failed — ${file.name}`, message);
      return false;
    } finally {
      resetUploadState();
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length || uploading) return;
    for (const file of Array.from(files).slice(0, 5)) {
      const ok = await stageFile(file);
      if (!ok) break; // validation failure or error stops the batch
    }
  };

  const cancelUpload = () => {
    abortRef.current?.abort();
  };

  const retry = () => {
    if (lastFailed && !uploading) void runUpload(lastFailed);
  };

  const clearPending = () => {
    setPendingImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-3">
      {/* Pending image preview — shown instantly, uploaded on confirm */}
      {pendingImage && !uploading && (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted/40 p-3 shadow-inset-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pendingImage.previewUrl}
            alt="Selected image preview"
            className="h-16 w-16 shrink-0 rounded-xl border border-border object-cover"
          />
          <div className="min-w-0 flex-1 text-xs">
            <p className="truncate font-semibold text-foreground">{pendingImage.file.name}</p>
            <p className="text-muted-foreground">
              {pendingImage.width && pendingImage.height
                ? `${pendingImage.width}×${pendingImage.height} · `
                : ""}
              {formatBytes(pendingImage.file.size)}
            </p>
          </div>
          <button
            onClick={clearPending}
            aria-label="Remove selected image"
            className="rounded-lg p-1.5 text-muted-foreground hover:text-danger cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              const f = pendingImage.file;
              clearPending();
              void runUpload(f);
            }}
            className="rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-raise-sm transition-transform active:translate-y-px cursor-pointer"
          >
            Upload
          </button>
        </div>
      )}

      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files);
        }}
        onPaste={(e) => {
          const files = e.clipboardData?.files;
          if (files?.length) upload(files);
        }}
        className={cn(
          "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-7 text-center transition-colors",
          dragging ? "border-primary bg-primary-soft/50" : "border-border bg-muted/30",
        )}
      >
        <Upload className={cn("mb-2 h-5 w-5", uploading ? "animate-pulse text-primary" : "text-muted-foreground")} />
        <p className="text-[13px] font-semibold">
          {uploading ? "Uploading…" : "Drop study files here, paste an image, or"}
        </p>
        {!uploading && (
          <button
            onClick={() => inputRef.current?.click()}
            className="mt-1 text-[13px] font-semibold text-primary hover:underline cursor-pointer"
          >
            browse files
          </button>
        )}
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          PDF · Word · Excel · text · images — up to 100 MB (images 10 MB). Pilot reads them to answer, quiz and build flashcards.
        </p>
        {uploading && uploadPct !== null && (
          <div className="mt-2 w-full max-w-xs space-y-1" role="status" aria-live="polite">
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={uploadPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
            >
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${uploadPct}%` }} />
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{uploadPct}%</span>
              <button onClick={cancelUpload} className="font-semibold text-danger hover:underline cursor-pointer">
                Cancel
              </button>
            </div>
          </div>
        )}
        {uploading && uploadPct === null && <Loader2 className="mt-2 h-4 w-4 animate-spin text-primary" />}
        {lastFailed && !uploading && (
          <button
            onClick={retry}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted cursor-pointer"
          >
            <RotateCw className="h-3.5 w-3.5" /> Retry upload
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.json,.txt,.md,image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => upload(e.target.files)}
        />
      </div>

      {/* Subject filter */}
      {subjects.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setSubjectId("")}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer",
              !subjectId ? "bg-primary-soft text-primary shadow-inset-sm ring-1 ring-inset ring-primary/25" : "bg-card text-muted-foreground shadow-raise-sm hover:text-foreground",
            )}
          >
            All
          </button>
          {subjects.map((s) => (
            <button
              key={s.id}
              onClick={() => setSubjectId(subjectId === s.id ? "" : s.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer",
                subjectId === s.id ? "bg-primary-soft text-primary shadow-inset-sm ring-1 ring-inset ring-primary/25" : "bg-card text-muted-foreground shadow-raise-sm hover:text-foreground",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* List */}
      {items.length === 0 ? (
        <p className="rounded-xl bg-muted/40 px-4 py-5 text-center text-[12px] text-muted-foreground">
          No materials yet. Upload lecture slides, past papers or notes — then ask Pilot
          <span className="font-semibold text-foreground"> “Quiz me from my materials”</span> or
          <span className="font-semibold text-foreground"> “Make flashcards from my PDF”</span>.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((m) => {
            const Icon = KIND_ICON[m.kind] ?? FileText;
            const isStoredImage = m.kind === "image";
            return (
              <li key={m.id} className="group flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5 shadow-inset-sm">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted overflow-hidden">
                  {isStoredImage ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={`/api/material/${m.id}`} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{m.fileName}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {m.subjectName ?? "No subject"} ·{" "}
                    {m.charCount > 0 ? `${m.charCount.toLocaleString()} chars read` : isStoredImage ? "image stored" : "stored (no text extracted)"}
                  </span>
                </span>
                <button
                  onClick={async () => {
                    await deleteMaterialAction(m.id);
                    await load(subjectId);
                    router.refresh();
                  }}
                  aria-label={`Delete ${m.fileName}`}
                  className="rounded-lg p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger group-hover:opacity-100 cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
