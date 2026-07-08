import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTeam } from "@/hooks/useTeam";
import { useDepartments } from "@/hooks/useDepartments";
import { useCreateQuickBriefTask } from "@/hooks/useCreateQuickBriefTask";
import { draftFromSuggestion, type QuickTaskSuggestion } from "@/lib/quick-brief-suggestion";
import { errorMessage } from "@/lib/utils";

const UNASSIGNED = "__unassigned__";

export interface QuickBriefSheetBrief {
  id: string;
  client_id: string | null;
  intent_type: string | null;
  raw_subject: string | null;
  quick_task_suggestion: QuickTaskSuggestion | null;
}

export interface QuickBriefSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brief: QuickBriefSheetBrief;
}

/**
 * Confirm sheet for briefing a quick task straight to ClickUp without scoping.
 * Prefilled from the AI's `quick_task_suggestion`; every field stays editable so
 * the operator can override before the task is created.
 */
export function QuickBriefSheet({ open, onOpenChange, brief }: QuickBriefSheetProps) {
  const { data: team = [] } = useTeam();
  const { data: departments = [] } = useDepartments();
  const createTask = useCreateQuickBriefTask();

  const [taskName, setTaskName] = useState("");
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);
  const [sprintPoints, setSprintPoints] = useState(1);
  const [workStream, setWorkStream] = useState("");
  const [dueDate, setDueDate] = useState("");

  // Prefill each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    const draft = draftFromSuggestion(brief.quick_task_suggestion, brief.raw_subject ?? "");
    setTaskName(draft.task_name);
    setAssignee(UNASSIGNED);
    setSprintPoints(draft.sprint_points);
    setWorkStream(draft.work_stream);
    setDueDate(draft.due_date ?? "");
  }, [open, brief.quick_task_suggestion, brief.raw_subject]);

  const hasClient = Boolean(brief.client_id);
  // A valid work stream must match a real department name — the AI's guess can
  // be empty or a stale/mismatched string that would otherwise flow straight
  // into the ClickUp "Work Stream" dropdown + BRIEF:: audit/invoice trail.
  const workStreamValid = departments.some((d) => d.name === workStream);
  const saving = createTask.isPending;

  const handleCreate = async () => {
    try {
      const { clickup_task_url } = await createTask.mutateAsync({
        brief_id: brief.id,
        task_name: taskName.trim() || "Untitled task",
        assignee_member_id: assignee === UNASSIGNED ? null : assignee,
        sprint_points: Math.max(1, Math.round(sprintPoints)),
        work_stream: workStream,
        due_date: dueDate || null,
      });
      toast.success("Task created in ClickUp", {
        action: clickup_task_url
          ? { label: "Open", onClick: () => window.open(clickup_task_url, "_blank") }
          : undefined,
      });
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Brief as-is</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 py-4">
          {!hasClient && (
            <p className="rounded-md border border-m-outline-variant bg-m-surface-container px-3 py-2 text-body-small text-m-on-surface-variant">
              Assign a client first.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="qb-task-name">Task name</Label>
            <Input
              id="qb-task-name"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="What needs doing?"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="qb-assignee">Assignee</Label>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger id="qb-assignee">
                <SelectValue placeholder="Unassigned" />
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="qb-points">Sprint points</Label>
              <Input
                id="qb-points"
                type="number"
                min={1}
                step={1}
                value={sprintPoints}
                onChange={(e) => setSprintPoints(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qb-due">Due date</Label>
              <Input
                id="qb-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="qb-work-stream">Work stream</Label>
            <Select value={workStream} onValueChange={setWorkStream}>
              <SelectTrigger id="qb-work-stream">
                <SelectValue placeholder="Choose a work stream…" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.name}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!workStreamValid && (
              <p className="text-body-small text-m-on-surface-variant">
                Pick a work stream — it sets the ClickUp dropdown and the invoice trail.
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={saving || !hasClient || !workStreamValid} onClick={handleCreate}>
              {saving ? "Creating…" : "Create task"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default QuickBriefSheet;
