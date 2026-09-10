import { requireUser } from "@/lib/auth/actions";
import { getAppData } from "@/lib/services/data";
import { FocusTimer } from "@/components/app/focus-timer";

export const dynamic = "force-dynamic";

export default async function FocusPage({ searchParams }: { searchParams: Promise<{ autostart?: string }> }) {
  const user = await requireUser();
  const data = await getAppData(user.id);
  const params = await searchParams;
  const todayItems = (data.today?.items ?? []).filter((i) => i.kind !== "break");

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">Focus Mode</h1>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          One task. One timer. Everything else can wait — completed sessions update your plan, streak and analytics.
        </p>
      </div>
      <FocusTimer
        planItems={todayItems}
        subjects={data.subjects}
        defaultMinutes={data.user.focusMinutes}
        defaultBreak={data.user.breakMinutes}
        autoStart={params.autostart === "1"}
      />
    </div>
  );
}