import { requireUser } from "@/lib/auth/actions";
import { MindmapStudio } from "@/components/app/mindmap-studio";

export const dynamic = "force-dynamic";

export default async function MindmapsPage() {
  await requireUser();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mind Maps</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          See the structure — Pilot organizes your syllabus or any topic into a readable map of concepts and relationships.
        </p>
      </div>
      <MindmapStudio />
    </div>
  );
}
