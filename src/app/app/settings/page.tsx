import { requireUser } from "@/lib/auth/actions";
import { getProfileBundle } from "@/lib/services/data";
import { describeChain } from "@/lib/ai/provider";
import { SettingsManager } from "@/components/app/settings-manager";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const profile = await getProfileBundle(user.id);
  if (!profile) return null;

  // Multi-provider chain status (keys never leave the server): primary is
  // the first keyed member of AI_PRIORITY; display shows the failover order.
  const chain = describeChain().filter((m) => m.keyed);
  const aiStatus = {
    provider: chain.length ? chain.map((m) => m.id).join(" → ") : "local deterministic engine",
    configured: chain.length > 0,
    model: chain.length ? chain[0]!.model : "local deterministic engine",
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your profile, planning preferences and AI configuration.</p>
      </div>
      <SettingsManager profile={profile} aiStatus={aiStatus} />
    </div>
  );
}