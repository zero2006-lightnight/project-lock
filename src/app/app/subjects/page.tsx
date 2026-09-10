import { requireUser } from "@/lib/auth/actions";
import { getAppData } from "@/lib/services/data";
import { SubjectManager } from "@/components/app/subject-manager";

export const dynamic = "force-dynamic";

export default async function SubjectsPage() {
  const user = await requireUser();
  const data = await getAppData(user.id);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Subjects</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of everything you&apos;re studying — progress, exams and weak spots at a glance.
        </p>
      </div>
      <SubjectManager subjects={data.subjects} />
    </div>
  );
}