import { requireUser } from "@/lib/auth/actions";
import { ensureDemoData } from "@/lib/db/demo";
import { ensurePlan } from "@/lib/services/plan";
import { getStreaks, getUnreadNotifications } from "@/lib/services/data";
import { AppShell } from "@/components/app/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  await ensureDemoData();

  const profile = user;
  void profile;

  const [{ current }, unread] = await Promise.all([
    getStreaks(user.id),
    getUnreadNotifications(user.id),
  ]);
  await ensurePlan(user.id, 7);

  return (
    <AppShell
      user={{ id: user.id, name: user.name, email: user.email }}
      streak={current}
      unread={unread}
    >
      {children}
    </AppShell>
  );
}