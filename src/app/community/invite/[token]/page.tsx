import { requireUser } from "@/lib/auth/actions";
import { previewInviteAction } from "@/lib/actions/community";
import { InviteAccept } from "@/components/app/invite-accept";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await requireUser();
  void user;
  const preview = await previewInviteAction(token);
  return <InviteAccept token={token} preview={preview} />;
}
