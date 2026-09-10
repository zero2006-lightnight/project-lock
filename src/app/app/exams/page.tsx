import { requireUser } from "@/lib/auth/actions";
import { getAppData } from "@/lib/services/data";
import { ExamsWorkspace } from "@/components/app/exams-workspace";

export const dynamic = "force-dynamic";

export default async function ExamsPage() {
  const user = await requireUser();
  const data = await getAppData(user.id);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Exams</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Am I ready? Readiness blends syllabus coverage with whether the remaining work fits your available time — then
          prove it in the Quiz and Summary Practice workspace.
        </p>
      </div>
      <ExamsWorkspace
        exams={data.exams}
        subjects={data.subjects.map((s) => ({ id: s.id, name: s.name }))}
      />
    </div>
  );
}