import { requireUser } from "@/lib/auth/actions";
import { getAppData } from "@/lib/services/data";
import { SyllabusManager } from "@/components/app/syllabus-manager";
import { MaterialsPanel } from "@/components/app/materials-panel";
import { SyllabusImport } from "@/components/app/syllabus-import";
import { Card, CardBody } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function SyllabusPage() {
  const user = await requireUser();
  const data = await getAppData(user.id);
  const subjectOptions = data.subjects.map((s) => ({ id: s.id, name: s.name }));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Syllabus</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your curriculum, mapped topic by topic. Mark progress as you go — the planner and Pilot react instantly.
          </p>
        </div>
        <SyllabusImport subjects={subjectOptions} />
      </div>
      <Card>
        <CardBody className="space-y-4">
          <div>
            <h2 className="text-base font-bold tracking-tight">Study materials</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Upload your files once — Pilot answers, quizzes and flashcards draw from them first.
            </p>
          </div>
          <MaterialsPanel subjects={subjectOptions} />
        </CardBody>
      </Card>
      <SyllabusManager subjects={data.subjects} />
    </div>
  );
}
