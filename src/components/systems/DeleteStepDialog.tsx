// Shared delete confirmation for a system step — mounted by both the Steps
// list (SystemDetail) and the canvas (SystemCanvas), because a step can be
// deleted from either and the consequences are the same either way.
//
// What actually goes with the row, confirmed against the FKs on process_steps:
//   process_steps.parent_id              ON DELETE CASCADE  → sub-steps go too
//   system_edges.source/target_step_id   ON DELETE CASCADE  → connections go too
//   process_step_instances.template_step_id  ON DELETE SET NULL
// That last one is why this doesn't warn about history: work already
// materialised into ClickUp keeps its instance rows, they just stop pointing
// at a template. Nothing here touches ClickUp.
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
import { useDeleteStep } from "@/hooks/useProcessSteps";
import type { Database } from "@/types/db";

type Step = Database["public"]["Tables"]["process_steps"]["Row"];

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function DeleteStepDialog({
  step,
  subStepCount,
  edgeCount,
  onClose,
  onDeleted,
}: {
  /** The step to delete; null keeps the dialog closed. */
  step: Step | null;
  subStepCount: number;
  edgeCount: number;
  onClose: () => void;
  onDeleted?: (stepId: string) => void;
}) {
  const remove = useDeleteStep();

  // Only ever claims what it can count. A confirm that says "0 sub-steps" and
  // then takes three is worse than one that doesn't mention them.
  const casualties = [
    subStepCount > 0 && plural(subStepCount, "sub-step"),
    edgeCount > 0 && plural(edgeCount, "connection"),
  ].filter(Boolean) as string[];

  return (
    <Dialog open={step != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{step?.title}”?</DialogTitle>
          <DialogDescription>
            {casualties.length > 0
              ? `This also removes its ${casualties.join(" and ")}. `
              : ""}
            Work already pushed to ClickUp is untouched — this only changes the process map.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => {
              if (!step) return;
              remove.mutate(
                { id: step.id },
                {
                  onSuccess: () => {
                    toast.success("Step deleted");
                    onDeleted?.(step.id);
                    onClose();
                  },
                  onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete step"),
                }
              );
            }}
          >
            {remove.isPending ? "Deleting…" : "Delete step"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
