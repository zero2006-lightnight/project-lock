import type { Variants } from "motion/react";
import { fast, normal } from "./transitions";

/* ──────────────────────────────────────────────────────────────
   Shared motion variants — every animated surface uses these.
   No ad-hoc initial/animate/exit objects in feature components.
   Each variant answers: what happened, where am I going, what
   changed. Decorative-only motion does not get a variant.
   ────────────────────────────────────────────────────────────── */

/** Route-level soft entrance (used with key={pathname}). */
export const pageEnter: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

/** Stagger parent for major section grids (dashboard) — max ~6 children. */
export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

/** Stagger child — calm rise, no rotation or scale play. */
export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

/** Dialog / sheet panel: soft scale + fade, 3px-shadow stays put. */
export const modalPanel: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 10 },
  show: { opacity: 1, scale: 1, y: 0, transition: normal },
  exit: { opacity: 0, scale: 0.97, y: 6, transition: fast },
};

/** Overlay backdrop fade. */
export const modalBackdrop: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: fast },
  exit: { opacity: 0, transition: fast },
};

/** Toast enter/exit. */
export const toastItem: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: normal },
  exit: { opacity: 0, scale: 0.96, transition: fast },
};

/** Quiz / assessment question transition — subtle lateral move. */
export const quizQuestion: Variants = {
  hidden: { opacity: 0, x: 24 },
  show: { opacity: 1, x: 0, transition: normal },
  exit: { opacity: 0, x: -24, transition: fast },
};

/** Flashcard flip is handled with rotateY on the card itself (Phase 7);
 *  this is the recall-controls reveal after the answer shows. */
export const recallReveal: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: normal },
};

/** Mind-map branch expand/collapse (height handled by layout). */
export const branchReveal: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: fast },
  exit: { opacity: 0, transition: fast },
};

/** Success confirmation — single small pop, never a celebration. */
export const successPop: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  show: { opacity: 1, scale: 1, transition: normal },
};

/** Error nudge — one gentle lateral move, not a shake loop. */
export const errorNudge: Variants = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0, transition: fast },
};

/** List item enter/exit for meaningful additions and removals. */
export const listItem: Variants = {
  hidden: { opacity: 0, y: -6 },
  show: { opacity: 1, y: 0, transition: fast },
  exit: { opacity: 0, transition: fast },
};
