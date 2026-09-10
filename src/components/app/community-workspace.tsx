"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, Copy, HelpCircle, Link2, Settings2, Trash2, UserMinus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";
import {
  deleteCommunityAction,
  generateInviteAction,
  listInvitesAction,
  listMembersAdminAction,
  removeMemberAction,
  revokeInviteAction,
} from "@/lib/actions/community";
import { branchReveal } from "@/components/motion/variants";
import { CommunityMaterials } from "./community-materials";
import { CommunityQA } from "./community-qa";

export type WorkspaceCommunity = {
  id: string;
  name: string;
  description: string;
  subject: string | null;
  role: "admin" | "member";
  memberCount: number;
};

function AdminPanel({ community }: { community: WorkspaceCommunity }) {
  const router = useRouter();
  const { toast } = useToast();
  const [invites, setInvites] = React.useState<{ id: string; createdAt: string | null; expiresAt: string | null; maxUses: number; useCount: number; revoked: boolean }[]>([]);
  const [members, setMembers] = React.useState<{ membershipId: string; label: string; role: string; self: boolean }[]>([]);
  const [lastToken, setLastToken] = React.useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteName, setDeleteName] = React.useState("");

  const load = React.useCallback(async () => {
    const [i, m] = await Promise.all([listInvitesAction(community.id), listMembersAdminAction(community.id)]);
    if (i.ok) setInvites(i.invites);
    if (m.ok) setMembers(m.members);
  }, [community.id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const invite = async () => {
    const res = await generateInviteAction(community.id, { expiresInDays: 7 });
    if (!res.ok) {
      toast("error", "Couldn't create invite", res.error);
      return;
    }
    setLastToken(res.token);
    await load();
  };

  const copy = async (token: string) => {
    const url = `${window.location.origin}/community/invite/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("success", "Invitation link copied");
    } catch {
      toast("error", "Copy failed", url);
    }
  };

  const revoke = async (id: string) => {
    const res = await revokeInviteAction(id);
    if (!res.ok) {
      toast("error", "Couldn't revoke", res.error);
      return;
    }
    setLastToken(null);
    await load();
  };

  const remove = async (membershipId: string) => {
    const res = await removeMemberAction(community.id, membershipId);
    if (!res.ok) {
      toast("error", "Couldn't remove member", res.error);
      return;
    }
    toast("success", "Member removed");
    await load();
  };

  const destroy = async () => {
    const res = await deleteCommunityAction(community.id, deleteName);
    if (!res.ok) {
      toast("error", "Couldn't delete community", res.error);
      return;
    }
    toast("success", "Community deleted");
    router.push("/app/community");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-muted-foreground" /> Invitation links
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <Button size="sm" onClick={invite}>Generate 7-day link</Button>
          {lastToken && (
            <div className="flex flex-wrap items-center gap-2 rounded-[6px] border-2 border-ink bg-lime/20 px-3 py-2">
              <code className="min-w-0 flex-1 truncate text-xs">{`${typeof window !== "undefined" ? window.location.origin : ""}/community/invite/${lastToken}`}</code>
              <Button size="xs" variant="outline" onClick={() => void copy(lastToken)} className="gap-1">
                <Copy className="h-3.5 w-3.5" /> Copy
              </Button>
            </div>
          )}
          <ul className="space-y-1.5">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-xs">
                <span className={cn("font-semibold", inv.revoked ? "text-muted-foreground line-through" : "")}>
                  Uses {inv.useCount}{inv.maxUses > 0 ? `/${inv.maxUses}` : ""} · {inv.revoked ? "revoked" : inv.expiresAt ? `expires ${new Date(inv.expiresAt).toLocaleDateString()}` : "no expiry"}
                </span>
                {!inv.revoked && (
                  <button type="button" onClick={() => void revoke(inv.id)} className="ml-auto cursor-pointer font-bold text-danger hover:underline">
                    Revoke
                  </button>
                )}
              </li>
            ))}
            {invites.length === 0 && <li className="text-xs text-muted-foreground">No links yet.</li>}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" /> Members ({members.length})
          </CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="space-y-1.5">
            {members.map((mem) => (
              <li key={mem.membershipId} className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-[13px]">
                <span className="font-medium">{mem.label}</span>
                <Badge tone={mem.role === "admin" ? "primary" : "neutral"}>{mem.role}</Badge>
                {!mem.self && mem.role !== "admin" && (
                  <button type="button" onClick={() => void remove(mem.membershipId)} aria-label={`Remove ${mem.label}`} className="ml-auto cursor-pointer rounded p-1.5 hover:text-danger">
                    <UserMinus className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-danger">
            <Trash2 className="h-4 w-4" /> Danger zone
          </CardTitle>
        </CardHeader>
        <CardBody>
          <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)} className="text-danger">
            Delete community…
          </Button>
        </CardBody>
      </Card>

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this community?"
        description="Members lose access immediately. Accounts and private data are never affected."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={destroy} disabled={deleteName.trim().toLowerCase() !== community.name.trim().toLowerCase()}>
              Delete permanently
            </Button>
          </>
        }
      >
        <Field label={`Type "${community.name}" to confirm`}>
          <Input value={deleteName} onChange={(e) => setDeleteName(e.target.value)} placeholder={community.name} />
        </Field>
      </Dialog>
    </div>
  );
}

export function CommunityWorkspace({ community }: { community: WorkspaceCommunity }) {
  const [tab, setTab] = React.useState<"materials" | "qa" | "settings">("materials");
  const isAdmin = community.role === "admin";

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{community.name}</h1>
          {isAdmin && <Badge tone="primary">Admin</Badge>}
        </div>
        {community.subject && <p className="mt-0.5 text-xs font-semibold text-primary">{community.subject}</p>}
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{community.description || "Private learning community."}</p>
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Users className="h-3.5 w-3.5" aria-hidden /> {community.memberCount} member{community.memberCount === 1 ? "" : "s"} · Private
        </p>
      </div>

      <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-[6px] border-2 border-ink bg-card p-1.5 shadow-brutal-sm" role="tablist" aria-label="Community sections">
        {(
          [
            { id: "materials", label: "Materials", icon: BookOpen },
            { id: "qa", label: "Q&A", icon: HelpCircle },
            ...(isAdmin ? [{ id: "settings", label: "Settings", icon: Settings2 }] : []),
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id as typeof tab)}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[6px] px-4 py-2 text-[13px] font-semibold transition-all",
              tab === t.id ? "border-2 border-ink bg-lime text-inkfill shadow-brutal-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-4 w-4" aria-hidden />
            {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} variants={branchReveal} initial="hidden" animate="show" exit="exit">
          {tab === "materials" && <CommunityMaterials communityId={community.id} isAdmin={isAdmin} />}
          {tab === "qa" && <CommunityQA communityId={community.id} isAdmin={isAdmin} />}
          {tab === "settings" && isAdmin && <AdminPanel community={community} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
