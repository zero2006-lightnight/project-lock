"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw, Rocket, Home } from "lucide-react";

/**
 * Route-segment error boundary. Catches any render/server error below the
 * root layout and shows a branded recovery screen instead of the default
 * Next.js error page.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the real error in server/browser logs for diagnosis.
    console.error("[studypilot] route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center px-4 py-16 text-center">
      <span className="neo-float mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-primary text-primary-foreground">
        <Rocket className="h-8 w-8" aria-hidden />
      </span>
      <h1 className="text-2xl font-bold tracking-tight">Turbulence hit</h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        Something went wrong on our side. Your study data is safe — pick up
        right where you left off.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-muted-foreground/70">Error ID: {error.digest}</p>
      )}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="shadow-raise-sm tactile inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground cursor-pointer"
        >
          <RotateCcw className="h-4 w-4" /> Try again
        </button>
        <Link
          href="/app"
          className="shadow-raise-sm tactile inline-flex items-center gap-2 rounded-xl bg-card px-5 py-2.5 text-sm font-semibold text-foreground"
        >
          <Home className="h-4 w-4" /> Go to dashboard
        </Link>
      </div>
    </div>
  );
}
