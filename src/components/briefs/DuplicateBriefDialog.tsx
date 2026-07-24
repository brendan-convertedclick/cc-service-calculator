// src/components/briefs/DuplicateBriefDialog.tsx
//
// "Duplicate brief" modal (ClickUp's Duplicate-task pattern, Conductor
// styling): pre-filled from the source brief, every field editable before
// the copy is created. The duplicate starts fresh at status "new" /
// source "manual" so it re-enters the pipeline from the top.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateBrief } from "@/hooks/useBriefs";
import { useClients } from "@/hooks/useClients";
import { useTeam } from "@/hooks/useTeam";
import { BILLING_LABEL, type BillingType } from "@/lib/brief-routing";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

const UNASSIGNED = "__unassigned__";
const NO_CLIENT = "__none__";

interface DuplicateBriefDialogProps {
  /** Source brief to copy. null keeps the dialog mounted but closed. */
  brief: Pick<
    Brief,
    "id" | "raw_subject" | "raw_body" | "client_id" | "billing_type" | "assignee_id" | "sender_email"
  > | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DuplicateBriefDialog({ brief, open, onOpenChange }: DuplicateBriefDialogProps) {
  const navigate = useNavigate();
  const { data: clients = [] } = useClients();
  const { data: team = [] } = useTeam();
  const createBrief = useCreateBrief();

  const [name, setName] = useState("");
  const [clientId, setClientId] = useState<string>(NO_CLIENT);
  const [billing, setBilling] = useState<BillingType>("retainer");
  const [assigneeId, setAssigneeId] = useState<string>(UNASSIGNED);
  const [body, setBody] = useState("");

  // Re-seed the form each time the dialog opens on a (possibly different) brief.
  useEffect(() => {
    if (!open || !brief) return;
    setName(brief.raw_subject ?? "");
    setClientId(brief.client_id ?? NO_CLIENT);
    setBilling(brief.billing_type === "adhoc" ? "adhoc" : "retainer");
    setAssigneeId(brief.assignee_id ?? UNASSIGNED);
    setBody(brief.raw_body ?? "");
  }, [open, brief]);

  const handleDuplicate = async () => {
    if (!brief) return;
    try {
      const created = await createBrief.mutateAsync({
        raw_subject: name.trim() || "(no subject)",
        raw_body: body,
        client_id: clientId === NO_CLIENT ? null : clientId,
        billing_type: billing,
        assignee_id: assigneeId === UNASSIGNED ? null : assigneeId,
        sender_email: brief.sender_email,
        source: "manual",
        status: "new",
        raw_attachments: null,
      });
      toast.success("Brief duplicated");
      onOpenChange(false);
      // Land the user on the fresh copy rather than leaving them on the source.
      if (created?.id) navigate(`/briefs/${created.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to duplicate brief");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Duplicate brief</DialogTitle>
          <DialogDescription>
            The copy starts as a new brief at the top of the pipeline. Adjust
            anything below before creating it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dup-name">New brief name</Label>
            <Input
              id="dup-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Brief name…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLIENT}>No client</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Billing</Label>
              <Select value={billing} onValueChange={(v) => setBilling(v as BillingType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(BILLING_LABEL) as BillingType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {BILLING_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Assignee</Label>
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {team.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dup-body">Brief body</Label>
            <Textarea
              id="dup-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              className="max-h-64"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleDuplicate} disabled={createBrief.isPending}>
            {createBrief.isPending ? "Duplicating…" : "Duplicate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
