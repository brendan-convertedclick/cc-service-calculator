// src/components/briefs/EditBriefedTaskDialog.tsx
//
// Edit an already-briefed brief's task. The dialog reads the live values from
// ClickUp on open and writes edits straight back, so Conductor and ClickUp stay
// in sync.
//
// Lisa, 2026-09-10: "I need to be able to edit more field on a task, please
// enable editing of all fields that are originally on the brief as is pop out."
// It used to carry three — name, points, due date — which meant a task briefed
// to the wrong retainer, or with nobody on it, could only be fixed by hand in
// two systems. Re-filing the mis-attributed Trellidor tasks was exactly that.
//
// Two homes, and the split is the point:
//   ClickUp owns  name, points, due date, description, status, work stream,
//                 assignee.
//   Conductor owns billing type and which retainer the work is booked to —
//                 neither is a fact about the task, and neither is sent there.
//
// Deliberately NOT here: moving the task to another list, editing the checklist,
// attachments, and the procedure link. Those are creation-time decisions that a
// live task has already acted on, and redoing them from an edit box would
// re-stamp work somebody has started.

import { useEffect, useMemo, useState } from "react";
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
import { useBriefedTaskDetails, useUpdateBriefedTask } from "@/hooks/useBriefedTask";
import { useTeam } from "@/hooks/useTeam";
import { useDepartments } from "@/hooks/useDepartments";
import { useRetainers, isBillableRetainer } from "@/hooks/useRetainers";
import { errorMessage } from "@/lib/utils";

const UNASSIGNED = "__unassigned__";
// "With the client" is not a person: the ClickUp task stays unassigned and
// carries the list's waiting-on-client status. Same convention as the brief
// sheet, so nobody has to learn it twice.
const CLIENT = "__client__";
const NO_PROJECT = "__none__";
const LIST_DEFAULT = "__list_default__";

export interface EditableBrief {
  id: string;
  raw_subject: string | null;
  clickup_task_url: string | null;
  client_id?: string | null;
}

interface EditBriefedTaskDialogProps {
  /** Briefed brief to edit. null keeps the dialog mounted but closed. */
  brief: EditableBrief | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditBriefedTaskDialog({ brief, open, onOpenChange }: EditBriefedTaskDialogProps) {
  const details = useBriefedTaskDetails(brief?.id ?? null, open);
  const updateTask = useUpdateBriefedTask();
  const { data: team = [] } = useTeam();
  const { data: departments = [] } = useDepartments();
  const { data: allRetainers = [] } = useRetainers();

  const [name, setName] = useState("");
  const [points, setPoints] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>(UNASSIGNED);
  const [workStream, setWorkStream] = useState<string>("");
  const [status, setStatus] = useState<string>(LIST_DEFAULT);
  const [billingType, setBillingType] = useState<"retainer" | "adhoc" | "internal">("adhoc");
  const [projectId, setProjectId] = useState<string>(NO_PROJECT);

  // The client comes off the loaded task, falling back to the row the caller
  // already has, so the retainer list is right even from a list view that does
  // not carry client_id.
  const clientId = details.data?.client_id ?? brief?.client_id ?? null;
  const retainers = useMemo(
    () => allRetainers.filter((r) => clientId != null && r.client_id === clientId && isBillableRetainer(r)),
    [allRetainers, clientId],
  );

  // Seed the form from the live values once they arrive.
  useEffect(() => {
    if (!open || !details.data) return;
    const d = details.data;
    setName(d.task_name ?? "");
    setPoints(d.sprint_points != null ? String(d.sprint_points) : "");
    setDueDate(d.due_date ?? "");
    setDescription(d.description ?? "");
    setAssigneeId(d.assignee_member_id ?? UNASSIGNED);
    setWorkStream(d.work_stream ?? "");
    setStatus(d.status_label ?? LIST_DEFAULT);
    setBillingType(d.billing_type ?? "adhoc");
    setProjectId(d.parent_project_id ?? NO_PROJECT);
  }, [open, details.data]);

  const statuses = details.data?.available_statuses ?? [];
  // The ClickUp list's own options when we could read them, the Conductor
  // departments otherwise — never a hardcoded list. Work Stream is a dropdown
  // custom field and only an exact option name is accepted.
  const workStreamOptions = departments.map((d) => d.name);

  const handleSave = async () => {
    if (!brief) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Task name can't be empty");
      return;
    }
    const parsedPoints = points.trim() === "" ? undefined : Number(points);
    if (parsedPoints !== undefined && (!Number.isFinite(parsedPoints) || parsedPoints < 0)) {
      toast.error("Sprint points must be a positive number");
      return;
    }
    if (billingType === "retainer" && projectId === NO_PROJECT) {
      // Booking to a retainer without saying which one is how work lands in
      // "Retainer work, no retainer" and stops counting against any fee.
      toast.error("Pick which retainer this is booked to, or change the billing.");
      return;
    }

    const toClient = assigneeId === CLIENT;
    const selectedAssignee = assigneeId === UNASSIGNED || toClient ? null : assigneeId;
    const assigneeChanged = selectedAssignee !== (details.data?.assignee_member_id ?? null);

    try {
      await updateTask.mutateAsync({
        brief_id: brief.id,
        task_name: trimmedName,
        sprint_points: parsedPoints,
        due_date: dueDate.trim() === "" ? null : dueDate,
        description,
        // Only send what moved: each of these costs a ClickUp round trip, and
        // re-sending an unchanged work stream re-resolves a dropdown for nothing.
        ...(assigneeChanged || toClient ? { assignee_member_id: selectedAssignee } : {}),
        ...(toClient ? { with_client: true } : {}),
        ...(workStream && workStream !== (details.data?.work_stream ?? "")
          ? { work_stream: workStream }
          : {}),
        ...(status !== LIST_DEFAULT && status !== (details.data?.status_label ?? "")
          ? { status }
          : {}),
        billing_type: billingType,
        parent_project_id: billingType === "retainer" ? projectId : null,
      });
      toast.success("Task updated");
      onOpenChange(false);
    } catch (e) {
      toast.error(`Failed to update task: ${errorMessage(e)}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit briefed task</DialogTitle>
          <DialogDescription>
            Name, points, due date, description, status, work stream and assignee are saved to
            ClickUp. Billing and retainer stay in Conductor.
          </DialogDescription>
        </DialogHeader>

        {details.isLoading ? (
          <div className="py-8 text-center text-body-small text-m-on-surface-variant">
            Loading task from ClickUp…
          </div>
        ) : details.isError ? (
          <div className="py-6 text-center text-body-small text-destructive">
            {`Couldn't load the ClickUp task: ${errorMessage(details.error)}`}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-task-name">Task name</Label>
              <Input
                id="edit-task-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Task name…"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-task-desc">Task description</Label>
              <Textarea
                id="edit-task-desc"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What the task says in ClickUp…"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-task-points">Sprint points</Label>
                <Input
                  id="edit-task-points"
                  type="number"
                  min={0}
                  step={1}
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                  placeholder="e.g. 2"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-task-due">Due date</Label>
                <Input
                  id="edit-task-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-task-assignee">Assignee</Label>
                <Select value={assigneeId} onValueChange={setAssigneeId}>
                  <SelectTrigger id="edit-task-assignee">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                    <SelectItem value={CLIENT}>Client</SelectItem>
                    {team.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {assigneeId === CLIENT && (
                  <p className="text-label-small text-m-on-surface-variant">
                    Unassigns it and sets the list's waiting-on-client status.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-task-status">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger id="edit-task-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={LIST_DEFAULT}>— leave as is —</SelectItem>
                    {statuses.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-label-small text-m-on-surface-variant">
                  Closing a task is done in ClickUp, so closed statuses aren't offered here.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-task-ws">Work stream</Label>
              <Select value={workStream} onValueChange={setWorkStream}>
                <SelectTrigger id="edit-task-ws">
                  <SelectValue placeholder="Choose a work stream…" />
                </SelectTrigger>
                <SelectContent>
                  {workStreamOptions.map((w) => (
                    <SelectItem key={w} value={w}>
                      {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-label-small text-m-on-surface-variant">
                Sets the ClickUp dropdown and the invoice trail.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-task-billing">Billing</Label>
                <Select
                  value={billingType}
                  onValueChange={(v) => setBillingType(v as typeof billingType)}
                >
                  <SelectTrigger id="edit-task-billing">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="retainer">Retainer</SelectItem>
                    <SelectItem value="adhoc">Adhoc</SelectItem>
                    <SelectItem value="internal">Internal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {billingType === "retainer" && (
                <div className="space-y-2">
                  <Label htmlFor="edit-task-retainer">Retainer</Label>
                  <Select value={projectId} onValueChange={setProjectId}>
                    <SelectTrigger id="edit-task-retainer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PROJECT}>— not chosen</SelectItem>
                      {retainers.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {billingType === "retainer" && retainers.length === 0 && (
              <p className="text-label-small text-m-on-surface-variant">
                This client has no billable retainer to book against.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateTask.isPending || details.isLoading || details.isError}
          >
            {updateTask.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
