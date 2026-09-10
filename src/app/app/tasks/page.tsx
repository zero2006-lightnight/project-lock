import { requireUser } from "@/lib/auth/actions";
import { getAppData } from "@/lib/services/data";
import { TaskManager } from "@/components/app/task-manager";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const user = await requireUser();
  const data = await getAppData(user.id);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Assignments, labs, quizzes and projects — everything with a deadline, in one place.
        </p>
      </div>
      <TaskManager tasks={data.tasks} subjects={data.subjects.map((s) => ({ id: s.id, name: s.name }))} />
    </div>
  );
}