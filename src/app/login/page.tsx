import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { googleConfig } from "@/lib/auth/google";
import { ensureDemoData } from "@/lib/db/demo";
import { AuthForm } from "@/components/auth/auth-form";

export const dynamic = "force-dynamic";

const AUTH_ERRORS: Record<string, string> = {
  google_denied: "You cancelled Google sign-in. Try again or use email instead.",
  google_state: "That Google sign-in link was invalid or expired. Please try again.",
  google_token: "Google sign-in failed on our side. Please try again in a moment.",
  google_email: "We couldn't verify your Google email address.",
  not_configured: "Google sign-in is not configured yet — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then restart the app.",
};

/** google_rate:<minutes> carries the retry window from the callback limiter. */
function resolveAuthError(raw: string | null): string | null {
  if (!raw) return null;
  const rateMatch = raw.match(/^google_rate:(\d+)$/);
  if (rateMatch) {
    const m = Number(rateMatch[1]);
    return `Too many Google sign-in attempts from this network. Try again in ${m} minute(s).`;
  }
  return AUTH_ERRORS[raw] ?? null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await ensureDemoData();
  const user = await getSessionUser();
  if (user) redirect(user.onboarded ? "/app" : "/onboarding");
  const sp = await searchParams;
  const error = resolveAuthError(sp.error ?? null);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="absolute inset-x-0 top-0 flex justify-between p-5">
        <Link href="/" className="flex items-center gap-2 text-sm font-bold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <span className="text-xs">✈</span>
          </span>
          Study<span className="text-gradient">Pilot</span>
        </Link>
        <Link href="/" className="text-sm font-medium text-muted-foreground hover:text-foreground">
          ← Back home
        </Link>
      </div>
      {error && (
        <div className="mb-4 w-full max-w-md rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] font-medium text-danger" role="alert">
          {error}
        </div>
      )}
      <AuthForm mode="login" googleConfigured={googleConfig().configured} />
    </div>
  );
}
