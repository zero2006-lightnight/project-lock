import { requireUser } from "@/lib/auth/actions";
import { fetchTuningState } from "@/lib/tuning/state";
import { TuningDashboard } from "@/components/app/tuning-dashboard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tuning · Personal AI",
};

export default async function TuningPage() {
  const user = await requireUser();
  const initial = await fetchTuningState(user.id);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">Tuning</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Upload your PDFs per subject and Pilot answers from <em>your</em> materials — your vocabulary, your
          emphasis, your progress. Knowledge stays private to you and never mixes across subjects.
        </p>
      </div>
      <TuningDashboard initial={initial} />
    </div>
  );
}
