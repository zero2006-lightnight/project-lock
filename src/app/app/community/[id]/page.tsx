import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/actions";
import { getCommunityAction } from "@/lib/actions/community";
import { CommunityWorkspace } from "@/components/app/community-workspace";

export const dynamic = "force-dynamic";

export default async function CommunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const res = await getCommunityAction(id);
  if (!res.ok) notFound();
  return <CommunityWorkspace community={res.community} />;
}
