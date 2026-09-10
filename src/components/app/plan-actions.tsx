"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { regeneratePlanAction, rescheduleMissedAction } from "@/lib/actions/planning";

export function RescheduleButton({ count }: { count: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  return (
    <Button
      size="sm"
      variant="warning"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        const res = await rescheduleMissedAction();
        setBusy(false);
        if (res.ok) {
          toast(
            "success",
            res.moved > 0 ? `Redistributed ${res.moved} session${res.moved === 1 ? "" : "s"}` : "Nothing to reschedule",
            res.summary.slice(0, 2).join(" · "),
          );
          router.refresh();
        }
      }}
    >
      <CalendarClock className="h-4 w-4" />
      Reschedule {count > 0 ? `(${count})` : ""}
    </Button>
  );
}

export function RegenerateButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  return (
    <Button
      size={compact ? "icon" : "sm"}
      variant="outline"
      loading={busy}
      title="Regenerate the upcoming week's plan"
      onClick={async () => {
        setBusy(true);
        const res = await regeneratePlanAction();
        setBusy(false);
        toast("success", `Plan regenerated`, `${res.count} blocks scheduled for the week`);
        router.refresh();
      }}
    >
      <RefreshCw className="h-4 w-4" />
      {!compact && "Regenerate week"}
    </Button>
  );
}

/** Today page header cluster: contextual plan maintenance buttons. */
export function PlanActions({
  missedCount,
  hasPlan,
  todayDone,
}: {
  missedCount: number;
  hasPlan: boolean;
  todayDone: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      {missedCount > 0 && <RescheduleButton count={missedCount} />}
      {!todayDone && (hasPlan || missedCount > 0) && <RegenerateButton />}
    </div>
  );
}