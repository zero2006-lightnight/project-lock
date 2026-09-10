"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, Users } from "lucide-react";
import { motion } from "motion/react";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { acceptInviteAction } from "@/lib/actions/community";
import { successPop } from "@/components/motion/variants";

type Preview =
  | { ok: true; community: { id: string; name: string; description: string; memberCount: number }; alreadyMember: boolean }
  | { ok: false; error: string };

export function InviteAccept({ token, preview }: { token: string; preview: Preview }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  const join = async () => {
    if (busy) return;
    setBusy(true);
    const res = await acceptInviteAction(token);
    setBusy(false);
    if (!res.ok) {
      toast("error", "Couldn't join", res.error);
      return;
    }
    toast("success", "Welcome to the community");
    router.push(`/app/community/${res.communityId}`);
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 py-10">
      <motion.div variants={successPop} initial="hidden" animate="show" className="w-full">
        <Card>
          <CardBody className="space-y-4 py-6 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[6px] border-2 border-ink bg-lime text-inkfill shadow-brutal-sm">
              <Link2 className="h-6 w-6" aria-hidden />
            </span>
            {!preview.ok ? (
              <>
                <h1 className="font-brutal-display text-xl">Invitation unavailable</h1>
                <p className="text-sm text-muted-foreground">{preview.error}</p>
                <Button variant="outline" onClick={() => router.push("/app/community")}>Go to Community Hub</Button>
              </>
            ) : (
              <>
                <p className="eyebrow text-muted-foreground">Private community invitation</p>
                <h1 className="font-brutal-display text-2xl leading-tight">{preview.community.name}</h1>
                <p className="text-sm text-muted-foreground">{preview.community.description || "A private study space."}</p>
                <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Users className="h-3.5 w-3.5" aria-hidden /> {preview.community.memberCount} member{preview.community.memberCount === 1 ? "" : "s"} · anonymous by default
                </p>
                {preview.alreadyMember ? (
                  <Link href={`/app/community/${preview.community.id}`}>
                    <Button>Open community</Button>
                  </Link>
                ) : (
                  <Button loading={busy} onClick={join}>Join community</Button>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </motion.div>
    </div>
  );
}
