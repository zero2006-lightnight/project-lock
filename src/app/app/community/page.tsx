import { requireUser } from "@/lib/auth/actions";
import { listMyCommunitiesAction } from "@/lib/actions/community";
import { CommunityHub } from "@/components/app/community-hub";

export const dynamic = "force-dynamic";

export default async function CommunityPage() {
  await requireUser();
  const mine = await listMyCommunitiesAction();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Learning Community</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Private study spaces — share materials, ask questions, and prepare together. Members stay anonymous.
        </p>
      </div>
      <CommunityHub initial={mine} />
    </div>
  );
}
