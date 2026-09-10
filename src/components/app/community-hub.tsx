"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Plus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toaster";
import { createCommunityAction, type MyCommunity } from "@/lib/actions/community";
import { listItem, staggerParent } from "@/components/motion/variants";

export function CommunityHub({ initial }: { initial: MyCommunity[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [communities, setCommunities] = React.useState(initial);
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const create = async () => {
    if (name.trim().length < 3 || busy) return;
    setBusy(true);
    const res = await createCommunityAction({ name: name.trim(), description: description.trim(), subject: subject.trim() || undefined });
    setBusy(false);
    if (!res.ok) {
      toast("error", "Couldn't create community", res.error);
      return;
    }
    toast("success", "Community created — you're the admin");
    setOpen(false);
    setName("");
    setDescription("");
    setSubject("");
    router.push(`/app/community/${res.id}`);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {communities.length} communit{communities.length === 1 ? "y" : "ies"} · private and anonymous by default
        </p>
        <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> New community
        </Button>
      </div>

      {communities.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="No communities yet"
          description="Create a private study space, invite classmates with a secure link, and prepare together."
          action={
            <Button onClick={() => setOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> Create community
            </Button>
          }
        />
      ) : (
        <motion.div variants={staggerParent} initial="hidden" animate="show" className="grid gap-4 md:grid-cols-2">
          {communities.map((c) => (
            <motion.div key={c.id} variants={listItem}>
              <Link href={`/app/community/${c.id}`}>
                <Card interactive>
                  <CardHeader>
                    <CardTitle className="line-clamp-1">{c.name}</CardTitle>
                    <Badge tone={c.role === "admin" ? "primary" : "neutral"}>{c.role === "admin" ? "Admin" : "Member"}</Badge>
                  </CardHeader>
                  <CardBody className="space-y-2">
                    {c.subject && <p className="text-xs font-semibold text-primary">{c.subject}</p>}
                    <p className="line-clamp-2 min-h-8 text-[13px] text-muted-foreground">{c.description || "Private learning community."}</p>
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                      <Users className="h-3.5 w-3.5" /> {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                    </p>
                  </CardBody>
                </Card>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New community"
        description="A private space — only invited members can see inside."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={busy} disabled={name.trim().length < 3} onClick={create}>Create</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Community name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Data Science Midterm Prep" autoFocus />
          </Field>
          <Field label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} placeholder="What will this group study together?" />
          </Field>
          <Field label="Subject (optional)">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={80} placeholder="e.g. Databases" />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
