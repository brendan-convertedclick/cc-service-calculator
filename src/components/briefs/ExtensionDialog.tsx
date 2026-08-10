// src/components/briefs/ExtensionDialog.tsx
//
// Request an extension on a briefed task: move the due date and/or add sprint
// points, with a required reason. If points are increased, the change can be
// flagged billable — the extra points are held and quoted to the client for
// sign-off before they're committed (see request-brief-extension).

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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useRequestExtension } from "@/hooks/useBriefExtensions";
import { errorMessage } from "@/lib/utils";

interface ExtensionDialogProps {
  brief: { id: string } | null;
  /** Current task values, to pre-fill and to detect what actually changed. */
  currentDueDate: string | null;
  currentPoints: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExtensionDialog({ brief, currentDueDate, currentPoints, open, onOpenChange }: ExtensionDialogProps) {
  const request = useRequestExtension();
  const [reason, setReason] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [points, setPoints] = useState("");
  const [billable, setBillable] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setDueDate(currentDueDate ?? "");
    setPoints(currentPoints != null ? String(currentPoints) : "");
    setBillable(false);
  }, [open, currentDueDate, currentPoints]);

  const parsedPoints = points.trim() === "" ? null : Number(points);
  const pointsIncreased =
    parsedPoints != null && Number.isFinite(parsedPoints) && parsedPoints > (currentPoints ?? 0);

  const handleSubmit = async () => {
    if (!brief) return;
    if (!reason.trim()) {
      toast.error("A reason for the extension is required");
      return;
    }
    const dueChanged = (dueDate.trim() || null) !== (currentDueDate ?? null);
    const pointsChanged =
      parsedPoints != null && Number.isFinite(parsedPoints) && parsedPoints !== (currentPoints ?? null);
    if (!dueChanged && !pointsChanged) {
      toast.error("Change the due date and/or the sprint points");
      return;
    }
    if (parsedPoints != null && (!Number.isFinite(parsedPoints) || parsedPoints < 0)) {
      toast.error("Sprint points must be a positive number");
      return;
    }
    try {
      await request.mutateAsync({
        brief_id: brief.id,
        reason: reason.trim(),
        ...(dueChanged ? { new_due_date: dueDate.trim() === "" ? null : dueDate } : {}),
        ...(pointsChanged ? { new_sprint_points: parsedPoints as number } : {}),
        ...(pointsChanged && billable ? { billable: true } : {}),
      });
      toast.success(
        pointsChanged && billable
          ? "Extension logged — extra points quoted to client for approval"
          : "Extension applied",
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(`Failed to record extension: ${errorMessage(e)}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request extension</DialogTitle>
          <DialogDescription>
            Move the due date and/or add sprint points. The original commitment is kept, so
            on-time / on-budget is still measured against what was first agreed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ext-reason">Reason</Label>
            <Textarea
              id="ext-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Client hasn't supplied the final assets yet…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ext-due">New due date</Label>
              <Input id="ext-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ext-points">Sprint points</Label>
              <Input
                id="ext-points"
                type="number"
                min={0}
                step={1}
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                placeholder={currentPoints != null ? String(currentPoints) : "e.g. 4"}
              />
            </div>
          </div>

          {pointsIncreased && (
            <label className="flex items-start gap-2.5 rounded-lg bg-m-surface-container-low p-3">
              <Checkbox
                checked={billable}
                onCheckedChange={(v) => setBillable(v === true)}
                className="mt-0.5"
              />
              <span className="text-body-small text-m-on-surface">
                Extra points are billable — quote the client for approval first.
                <span className="block text-label-small text-m-on-surface-variant">
                  The extra points are held and only committed to ClickUp once the client approves.
                </span>
              </span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={request.isPending}>
            {request.isPending ? "Saving…" : "Submit extension"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
