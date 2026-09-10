import { requireUser } from "@/lib/auth/actions";
import { FlashcardsStudio } from "@/components/app/flashcards-studio";
import { getFlashcardsAction, getStudySignalsAction } from "@/lib/actions/study";

export const dynamic = "force-dynamic";

export default async function FlashcardsPage() {
  await requireUser();
  const [saved, signals] = await Promise.all([getFlashcardsAction(), getStudySignalsAction()]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Flashcards</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Recall, not re-reading — Pilot writes teacher-quality cards from your syllabus or any topic, then spaces them by how well you remember.
        </p>
      </div>
      <FlashcardsStudio initialSaved={saved} signals={signals} />
    </div>
  );
}
