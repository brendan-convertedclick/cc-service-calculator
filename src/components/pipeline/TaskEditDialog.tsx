// src/components/pipeline/TaskEditDialog.tsx
//
// The planner card's settings dialog: a task's title, description, group,
// row, department, assignee and estimate. Saves through update_school_task
// (0190). "Also change it in the template" rewrites the template task and
// every other school's copy in the same call; the RPC explains why that
// cannot be two browser writes.
//
// Explicit Save, never save-on-blur, and closing with unsaved changes asks
// first (the confirm is built into the dialog, not window.confirm).

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/utils";
import { useDepartments } from "@/hooks/useDepartments";
import { useTeam } from "@/hooks/useTeam";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { useUpdateSchoolTask, type SchoolTaskEdit, type SchoolYearTask } from "@/hooks/useSchoolYear";

const NONE = "__none__";

/** Group and row names already on the board, offered as suggestions. */
export interface PlacementOption {
  group: string;
  rows: string[];
}

function fromTask(t: SchoolYearTask): SchoolTaskEdit {
  return {
    label: t.label,
    description: t.description,
    plan_group: t.plan_group,
    plan_row: t.plan_row,
    department_id: t.department_id,
    assignee_id: t.assignee_id,
    est_hours: t.est_hours,
  };
}

export function TaskEditDialog({
  task,
  yearId,
  placements,
  open,
  onOpenChange,
}: {
  task: SchoolYearTask;
  yearId: string;
  placements: PlacementOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: departments } = useDepartments();
  const { data: team } = useTeam();
  const { role } = useCurrentRole();
  const update = useUpdateSchoolTask();
  const [draft, setDraft] = useState<SchoolTaskEdit>(() => fromTask(task));
  const [hours, setHours] = useState(task.est_hours == null ? "" : String(task.est_hours));
  const [applyToTemplate, setApplyToTemplate] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  // Reopening starts from the task as it is now, not the last draft.
  useEffect(() => {
    if (!open) return;
    setDraft(fromTask(task));
    setHours(task.est_hours == null ? "" : String(task.est_hours));
    setApplyToTemplate(false);
    setConfirmingDiscard(false);
  }, [open, task]);

  const canEditTemplate = role === "admin" || role === "owner";
  const ours = task.side === "us";
  const original = fromTask(task);
  const parsedHours = hours.trim() === "" ? null : Number(hours);
  const hoursValid = parsedHours === null || (Number.isFinite(parsedHours) && parsedHours >= 0);
  const current = { ...draft, est_hours: hoursValid ? parsedHours : draft.est_hours };
  const dirty = JSON.stringify(current) !== JSON.stringify(original) || applyToTemplate;
  const titleValid = draft.label.trim().length > 0;
  const rowOptions = placements.find((p) => p.group === draft.plan_group)?.rows ?? [];

  function set<K extends keyof SchoolTaskEdit>(key: K, value: SchoolTaskEdit[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function requestClose(next: boolean) {
    if (next) return onOpenChange(true);
    if (dirty && !update.isPending) setConfirmingDiscard(true);
    else onOpenChange(false);
  }

  function save() {
    if (!titleValid || !hoursValid) return;
    update.mutate(
      { yearId, taskId: task.id, edit: current, applyToTemplate },
      {
        onSuccess: () => {
          toast.success(applyToTemplate ? "Saved here and in the template" : "Saved");
          onOpenChange(false);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="max-w-lg" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>
            {ours ? "Ours" : "The school's"} · M{task.month_no}
          </DialogDescription>
        </DialogHeader>

        <form
          id={`task-edit-${task.id}`}
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`title-${task.id}`}>Title</Label>
            <Input id={`title-${task.id}`} value={draft.label} onChange={(e) => set("label", e.target.value)} autoFocus />
            <p className="text-label-small text-m-on-surface-variant">
              The thing, then its state: "Landing page built". Two to five words, no dash, no month or cadence.
            </p>
            {!titleValid ? <p className="text-label-small text-m-error">A task needs a title.</p> : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`desc-${task.id}`}>Description</Label>
            <Textarea
              id={`desc-${task.id}`}
              rows={3}
              value={draft.description ?? ""}
              onChange={(e) => set("description", e.target.value || null)}
              placeholder="Why it matters, and what done looks like."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`group-${task.id}`}>Group</Label>
              <Input
                id={`group-${task.id}`}
                list={`groups-${task.id}`}
                value={draft.plan_group ?? ""}
                onChange={(e) => set("plan_group", e.target.value || null)}
              />
              <datalist id={`groups-${task.id}`}>
                {placements.map((p) => (
                  <option key={p.group} value={p.group} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`row-${task.id}`}>Channel</Label>
              <Input
                id={`row-${task.id}`}
                list={`rows-${task.id}`}
                value={draft.plan_row ?? ""}
                placeholder="General"
                onChange={(e) => set("plan_row", e.target.value || null)}
              />
              <datalist id={`rows-${task.id}`}>
                {rowOptions.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>
          </div>

          {ours ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor={`dept-${task.id}`}>Department</Label>
                <Select value={draft.department_id ?? NONE} onValueChange={(v) => set("department_id", v === NONE ? null : v)}>
                  <SelectTrigger id={`dept-${task.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not set</SelectItem>
                    {(departments ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`assignee-${task.id}`}>Assignee</Label>
                <Select value={draft.assignee_id ?? NONE} onValueChange={(v) => set("assignee_id", v === NONE ? null : v)}>
                  <SelectTrigger id={`assignee-${task.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Unassigned</SelectItem>
                    {(team ?? []).map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`hours-${task.id}`}>Estimate (hours)</Label>
                <Input
                  id={`hours-${task.id}`}
                  inputMode="decimal"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder="Not estimated"
                />
                {!hoursValid ? <p className="text-label-small text-m-error">Hours must be a number, 0 or more.</p> : null}
              </div>
            </div>
          ) : null}

          <label className="flex items-start gap-2 rounded-md border border-m-outline-variant p-3">
            <Checkbox
              checked={applyToTemplate}
              disabled={!canEditTemplate}
              onCheckedChange={(v) => setApplyToTemplate(v === true)}
              className="mt-0.5"
            />
            <span className="grid gap-0.5">
              <span className="text-label-large">Also change it in the template</span>
              <span className="text-label-small text-m-on-surface-variant">
                {canEditTemplate
                  ? "The title, description, group, channel and department go to the template and every other school's copy. Assignee and hours stay with this school."
                  : "Only an admin or owner can change the template."}
              </span>
            </span>
          </label>
        </form>

        {confirmingDiscard ? (
          <div className="flex items-center justify-between gap-3 rounded-md bg-m-error-container px-3 py-2 text-label-large text-m-on-error-container">
            <span>Discard your changes?</span>
            <span className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmingDiscard(false)}>
                Keep editing
              </Button>
              <Button size="sm" variant="destructive" onClick={() => onOpenChange(false)}>
                Discard
              </Button>
            </span>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => requestClose(false)} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={`task-edit-${task.id}`} disabled={!dirty || !titleValid || !hoursValid || update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
