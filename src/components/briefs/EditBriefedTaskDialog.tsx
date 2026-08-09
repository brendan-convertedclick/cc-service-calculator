// src/components/briefs/EditBriefedTaskDialog.tsx
//
// Edit an already-briefed brief's ClickUp task: name, sprint points, due date.
// The task is the source of truth — the dialog reads the live values from
// ClickUp on open and writes edits straight back, so Conductor and ClickUp
// stay in sync.

import { useEffect, useState } from "react";
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
import { useBriefedTaskDetails, useUpdateBriefedTask } from "@/hooks/useBriefedTask";
import { errorMessage } from "@/lib/utils";

interface EditBriefedTaskDialogProps {
  /** Briefed brief to edit. null keeps the dialog mounted but closed. */
  brief: { id: string; raw_subject: string | null; clickup_task_url: string | null } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditBriefedTaskDialog({ brief, open, onOpenChange }: EditBriefedTaskDialogProps) {
  const details = useBriefedTaskDetails(brief?.id ?? null, open);
  const updateTask = useUpdateBriefedTask();

  const [name, setName] = useState("");
  const [points, setPoints] = useState("");
  const [dueDate, setDueDate] = useState("");

  // Seed the form from the live ClickUp values once they arrive.
  useEffect(() => {
    if (!open || !details.data) return;
    setName(details.data.task_name ?? "");
    setPoints(details.data.sprint_points != null ? String(details.data.sprint_points) : "");
    setDueDate(details.data.due_date ?? "");
  }, [open, details.data]);

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
    try {
      await updateTask.mutateAsync({
        brief_id: brief.id,
        task_name: trimmedName,
        sprint_points: parsedPoints,
        due_date: dueDate.trim() === "" ? null : dueDate,
      });
      toast.success("ClickUp task updated");
      onOpenChange(false);
    } catch (e) {
      toast.error(`Failed to update task: ${errorMessage(e)}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit briefed task</DialogTitle>
          <DialogDescription>
            Changes are saved straight to the linked ClickUp task.
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
            {updateTask.isPending ? "Saving…" : "Save to ClickUp"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
