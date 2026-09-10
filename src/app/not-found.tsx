import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-16 text-center">
      <span className="neo-float mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-primary text-primary-foreground">
        <Compass className="h-8 w-8" aria-hidden />
      </span>
      <h1 className="text-2xl font-bold tracking-tight">Off the flight path</h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        That page doesn&apos;t exist — it may have moved, or the link is off.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/app"
          className="shadow-raise-sm inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:translate-y-[-1px]"
        >
          Go to dashboard
        </Link>
        <Link
          href="/"
          className="shadow-raise-sm tactile inline-flex items-center gap-2 rounded-xl bg-card px-5 py-2.5 text-sm font-semibold text-foreground"
        >
          Back home
        </Link>
      </div>
    </div>
  );
}
