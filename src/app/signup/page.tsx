import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { googleConfig } from "@/lib/auth/google";
import { ensureDemoData } from "@/lib/db/demo";
import { AuthForm } from "@/components/auth/auth-form";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  await ensureDemoData();
  const user = await getSessionUser();
  if (user) redirect(user.onboarded ? "/app" : "/onboarding");

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
      <AuthForm mode="signup" googleConfigured={googleConfig().configured} />
    </div>
  );
}