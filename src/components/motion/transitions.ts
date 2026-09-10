import type { Transition } from "motion/react";

/* ──────────────────────────────────────────────────────────────
   Motion timing — one scale for the whole product.
   fast   ≈ quick interaction feedback (press, chip, toggle)
   normal ≈ smooth state change (dialog, toast, question)
   slow   ≈ page / complex visual transition (entrance only)
   ────────────────────────────────────────────────────────────── */
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const fast: Transition = { duration: 0.15, ease: EASE };
export const normal: Transition = { duration: 0.3, ease: EASE };
export const slow: Transition = { duration: 0.5, ease: EASE };
