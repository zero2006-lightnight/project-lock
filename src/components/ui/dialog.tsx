"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { modalBackdrop, modalPanel } from "@/components/motion/variants";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // focus management
  React.useEffect(() => {
    if (open) {
      const panel = panelRef.current;
      const prev = document.activeElement as HTMLElement | null;
      panel?.focus();
      return () => prev?.focus?.();
    }
  }, [open ]);

  const maxW = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl" }[size];

  // Portals need document — never render on the server. (The pre-motion
  // phase machine returned null until "opening"; AnimatePresence covers
  // the client lifecycle, so this guard only skips SSR.)
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
        >
          <motion.div
            variants={modalBackdrop}
            initial="hidden"
            animate="show"
            exit="exit"
            className="absolute inset-0 bg-black/60"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            variants={modalPanel}
            initial="hidden"
            animate="show"
            exit="exit"
            className={cn(
              "relative z-10 max-h-[85vh] w-full overflow-hidden rounded-t-[12px] border-[3px] border-ink bg-card text-card-foreground shadow-brutal-lg outline-none sm:rounded-[8px]",
              maxW,
            )}
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-6">
              <div>
                <h2 id={titleId} className="font-brutal-display text-xl tracking-tight">{title}</h2>
                {description && <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">{description}</p>}
              </div>
              <button
                onClick={onClose}
                aria-label="Close dialog"
                className="brutal-press rounded-[6px] border-2 border-ink bg-card p-1.5 text-muted-foreground shadow-brutal-sm hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
            {footer && (
              <div className="flex items-center justify-end gap-2.5 border-t-2 border-ink px-6 py-4">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
