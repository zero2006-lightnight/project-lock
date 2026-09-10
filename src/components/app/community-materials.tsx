"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Download, FileText, Loader2, Trash2, UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toaster";
import { deleteMaterialAction, listMaterialsAction } from "@/lib/actions/community";
import { listItem } from "@/components/motion/variants";

type Material = { id: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string | null; by: string; own: boolean };

const FILTERS = [
  { id: undefined, label: "All" },
  { id: "pdf", label: "PDF" },
  { id: "word", label: "Documents" },
  { id: "image", label: "Images" },
] as const;

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function CommunityMaterials({ communityId, isAdmin }: { communityId: string; isAdmin: boolean }) {
  const { toast } = useToast();
  const [items, setItems] = React.useState<Material[]>([]);
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]["id"]>(undefined);
  const [uploading, setUploading] = React.useState(false);
  const [pct, setPct] = React.useState<number | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    const res = await listMaterialsAction(communityId, filter ?? undefined);
    if (res.ok) setItems(res.materials);
  }, [communityId, filter]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const upload = async (files: FileList | File[] | null) => {
    if (!files || uploading) return;
    const list = [...files].filter((f) => f.size > 0).slice(0, 5);
    if (!list.length) return;
    const tooBig = list.find((f) => f.size > 200 * 1024 * 1024);
    if (tooBig) {
      toast("error", "File too large", `${tooBig.name} is over the 200 MB limit.`);
      return;
    }
    setUploading(true);
    try {
      for (const f of list) {
        const form = new FormData();
        form.append("communityId", communityId);
        form.append("file", f, f.name);
        setPct(0);
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/community/materials");
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setPct(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => {
            const body = JSON.parse(xhr.responseText || "{}") as { ok: boolean; error?: string };
            if (xhr.status >= 200 && xhr.status < 300 && body.ok) resolve();
            else reject(new Error(body.error || `Upload failed (${xhr.status}).`));
          };
          xhr.onerror = () => reject(new Error("Network error during upload."));
          xhr.send(form);
        }).catch((e: Error) => {
          toast("error", `Couldn't share ${f.name}`, e.message);
        });
      }
      toast("success", "Material shared with the community");
      await load();
    } finally {
      setUploading(false);
      setPct(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (id: string, name: string) => {
    const res = await deleteMaterialAction(id);
    if (!res.ok) {
      toast("error", "Couldn't remove material", res.error);
      return;
    }
    toast("success", "Material removed");
    setItems((items) => items.filter((m) => m.id !== id));
    void name;
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void upload(e.dataTransfer.files);
        }}
        onClick={() => {
          if (!uploading) inputRef.current?.click();
        }}
        role="button"
        tabIndex={0}
        aria-label="Upload community materials (PDF, Word, images, up to 200 MB)"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !uploading) inputRef.current?.click();
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-[6px] border-2 border-dashed px-4 py-7 text-center transition-all",
          dragOver ? "border-ink bg-lime/30" : "border-ink/40 bg-muted/30",
        )}
      >
        <UploadCloud className={cn("h-6 w-6", uploading ? "animate-pulse text-primary" : "text-muted-foreground")} aria-hidden />
        <p className="text-[13px] font-semibold">{uploading ? "Sharing…" : "Drop files here or click to choose"}</p>
        <p className="text-[11px] text-muted-foreground">PDF · Word · Images — up to 200 MB each. Shared anonymously.</p>
        {uploading && pct !== null && (
          <div className="h-2 w-full max-w-xs overflow-hidden rounded-full border border-ink bg-card" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
            <div className="h-full bg-lime transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
        {uploading && <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />}
        <input ref={inputRef} type="file" className="hidden" multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif" onChange={(e) => void upload(e.target.files)} />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Material type filter">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={cn(
              "cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
              filter === f.id ? "bg-primary-soft/80 text-primary shadow-inset-sm ring-1 ring-inset ring-primary/30" : "bg-card text-muted-foreground shadow-raise-sm hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState
          compact
          icon={<FileText className="h-6 w-6" />}
          title="No materials yet"
          description="Share lecture slides, past papers or diagrams — every member can download them."
        />
      ) : (
        <motion.ul layout className="space-y-2">
          <AnimatePresence initial={false}>
            {items.map((m) => (
              <motion.li key={m.id} variants={listItem} initial="hidden" animate="show" exit="exit" layout>
                <Card>
                  <CardBody className="flex items-center gap-3 !px-4 !py-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border-2 border-ink bg-muted">
                      <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{m.fileName}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {formatSize(m.sizeBytes)} · Shared by {m.by}
                        {m.createdAt ? ` · ${new Date(m.createdAt).toLocaleDateString()}` : ""}
                      </span>
                    </span>
                    <a
                      href={`/api/community/material/${m.id}`}
                      download
                      aria-label={`Download ${m.fileName}`}
                      className="brutal-press rounded-[6px] border-2 border-ink bg-card p-2 shadow-brutal-sm"
                    >
                      <Download className="h-4 w-4" aria-hidden />
                    </a>
                    {(m.own || isAdmin) && (
                      <button
                        type="button"
                        onClick={() => void remove(m.id, m.fileName)}
                        aria-label={`Remove ${m.fileName}`}
                        className="cursor-pointer rounded-[6px] border-2 border-ink bg-card p-2 text-muted-foreground shadow-brutal-sm hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </CardBody>
                </Card>
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
    </div>
  );
}
