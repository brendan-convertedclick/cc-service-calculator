import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useSystemDefinitions } from "@/hooks/useSystemDefinitions";

export const NO_WORKFLOW = "__none__";

/**
 * The checklist a workflow's steps become, one item per line. `materialise_as
 * = 'none'` steps (decision nodes, notes) are dropped — same rule
 * planMaterialisation applies on the quote path. Sub-steps aren't nested here:
 * ClickUp checklists are flat, and the picker only offers top-level steps.
 */
export function checklistFromSteps(
  steps: { title: string; materialise_as: string }[],
): string {
  return steps
    .filter((s) => s.materialise_as !== "none")
    .map((s) => s.title)
    .join("\n");
}

/**
 * Picks a Systems-library entry whose process steps become the ClickUp task's
 * checklist. Only systems that actually have steps are offered — one with none
 * would silently stamp an empty checklist.
 */
export function WorkflowSelect({
  id,
  value,
  onValueChange,
  label = "Service workflow",
  hint = "Optional — its process steps become the task's ClickUp checklist.",
}: {
  id: string;
  value: string;
  onValueChange: (v: string) => void;
  label?: string;
  hint?: string;
}) {
  const { data: systems = [] } = useSystemDefinitions();
  const withSteps = systems.filter((s) => s.step_count > 0);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="No workflow" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_WORKFLOW}>No workflow</SelectItem>
          {withSteps.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-label-small text-m-on-surface-variant">{hint}</p>
    </div>
  );
}

export default WorkflowSelect;
