"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toastItem } from "@/components/motion/variants";

type ToastTone = "success" | "error" | "info";
type ToastItem = { id: number; tone: ToastTone; title: string; description?: string };

const ToastCtx = React.createContext<{
  toast: (tone: ToastTone, title: string, description?: string) => void;
} | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const counter = React.useRef(0);

  const toast = React.useCallback((tone: ToastTone, title: string, description?: string) => {
    const id = ++counter.current;
    setItems((prev) => [...prev.slice(-3), { id, tone, title, description }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const dismiss = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4 sm:items-end sm:right-4 sm:bottom-4 sm:inset-x-auto sm:px-0"
      >
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              variants={toastItem}
              initial="hidden"
              animate="show"
              exit="exit"
              layout
              className={cn(
                "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[6px] border-2 border-ink bg-card px-4 py-3 text-card-foreground shadow-brutal",
              )}
            >
            {t.tone === "success" && <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-success" />}
            {t.tone === "error" && <TriangleAlert className="mt-0.5 h-4.5 w-4.5 shrink-0 text-danger" />}
            {t.tone === "info" && <Info className="mt-0.5 h-4.5 w-4.5 shrink-0 text-info" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.description && <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{t.description}</p>}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

/** Imperative helper for contexts without the hook */
export function useToastApi() {
  return useToast().toast;
}
