import { redirect } from "next/navigation";
import { Rocket } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { OnboardingWizard } from "@/components/app/onboarding-wizard";
import { ensureDemoData } from "@/lib/db/demo";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  await ensureDemoData();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.onboarded) redirect("/app");

  return (
    <div className="min-h-dvh bg-background px-4 py-10">
      <div className="mx-auto mb-8 flex max-w-2xl items-center justify-between">
        <span className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Rocket className="h-4.5 w-4.5" />
          </span>
          <span className="text-base font-bold tracking-tight">
            Study<span className="text-gradient">Pilot</span>
          </span>
        </span>
      </div>
      <OnboardingWizard />
    </div>
  );
}