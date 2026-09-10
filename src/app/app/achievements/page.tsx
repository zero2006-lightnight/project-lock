import { Lock, Sparkles, Trophy } from "lucide-react";
import { requireUser } from "@/lib/auth/actions";
import { getAppData } from "@/lib/services/data";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = {
  streak: "Streaks",
  tasks: "Tasks",
  study: "Study time",
  focus: "Focus",
  consistency: "Consistency",
  subject: "Syllabus",
  milestone: "Milestones",
};

export default async function AchievementsPage() {
  const user = await requireUser();
  const data = await getAppData(user.id);

  const groups = new Map<string, typeof data.achievements>();
  for (const a of data.achievements) {
    groups.set(a.category, [...(groups.get(a.category) ?? []), a]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Achievements</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Earned from real effort — streaks, completed tasks, focus sessions and finished syllabi.
          </p>
        </div>
        <Badge tone="accent" className="gap-2 px-3.5 py-1.5 text-sm">
          <Trophy className="h-4 w-4" /> {data.unlockedCount}/{data.achievements.length} unlocked
        </Badge>
      </div>

      {data.achievements.length === 0 ? (
        <Card>
          <CardBody className="py-16 text-center">
            <Sparkles className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-base font-semibold">No achievements defined yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Start studying — the first ones unlock quickly.</p>
          </CardBody>
        </Card>
      ) : (
        [...groups.entries()].map(([category, list]) => (
          <div key={category}>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{CATEGORY_LABEL[category] ?? category}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((a) => (
                <Card key={a.code} className={cn(!a.unlocked && "opacity-80")}>
                  <CardBody className="py-4">
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                          a.unlocked ? "bg-accent-soft text-accent" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {a.unlocked ? <Sparkles className="h-5 w-5" /> : <Lock className="h-4.5 w-4.5" />}
                      </span>
                      <div className="min-w-0">
                        <p className={cn("text-sm font-semibold leading-tight", a.unlocked ? "text-accent" : "text-foreground")}>
                          {a.title}
                        </p>
                        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{a.description}</p>
                      </div>
                    </div>
                    <div className="mt-3.5">
                      <div className="mb-1 flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">
                          {a.unlocked ? "Unlocked" : `${Math.min(a.progress, a.target)}/${a.target}`}
                        </span>
                        {a.unlocked ? (
                          <span className="font-semibold text-success">✓</span>
                        ) : (
                          <span className="font-semibold tabular-nums text-muted-foreground">
                            {Math.min(100, Math.round((a.progress / a.target) * 100))}%
                          </span>
                        )}
                      </div>
                      <Progress value={Math.min(100, (a.progress / a.target) * 100)} tone={a.unlocked ? "accent" : "primary"} />
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}