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

/** Sprint points a procedure is worth, from the hours already estimated on its
 *  steps. 1 point = 15 minutes, the same conversion the retainers use.
 *
 *  Lisa, 2026-09-11: "can you autopopulate the sprint points based on the
 *  Procedure that is selected?" — the estimate exists, it was just being retyped
 *  from memory into a box that defaulted to 1, which is how a 6-hour job gets
 *  briefed as 15 minutes.
 *
 *  Returns null when nothing on the procedure carries an estimate (15 of 167 do
 *  not). Null means "leave what the operator has" — writing a confident 0, or a
 *  silent 1, is worse than not answering. `materialise_as = 'none'` steps are
 *  decision nodes and notes, dropped here exactly as they are from the
 *  checklist. */
export function pointsFromSteps(
  steps: { materialise_as: string; estimated_hours: number | null }[],
): number | null {
  const hours = steps
    .filter((s) => s.materialise_as !== "none")
    .reduce((n, s) => n + Number(s.estimated_hours ?? 0), 0);
  if (!(hours > 0)) return null;
  return Math.max(1, Math.round(hours / 0.25));
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
  hint,
  required = false,
}: {
  id: string;
  value: string;
  onValueChange: (v: string) => void;
  label?: string;
  hint?: string;
  /** Drops the "No workflow" escape hatch. Offering an option the form then
   *  refuses to submit is a trap, so a required picker simply doesn't have one
   *  and sits on its placeholder until somebody chooses. */
  required?: boolean;
}) {
  const { data: systems = [] } = useSystemDefinitions();
  const withSteps = systems.filter((s) => s.step_count > 0);
  const hintText =
    hint ??
    (required
      ? "Required — its steps become the task's checklist and set the sprint points."
      : "Optional — its process steps become the task's ClickUp checklist.");

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {/* Radix only renders the placeholder for an EMPTY value. A required
          picker holds NO_WORKFLOW until somebody chooses, and that string
          matches no item, so the trigger came up blank with no prompt at all.
          Hand it undefined instead and the placeholder does its job. */}
      <Select
        value={required && value === NO_WORKFLOW ? undefined : value}
        onValueChange={onValueChange}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={required ? "Choose a procedure…" : "No workflow"} />
        </SelectTrigger>
        <SelectContent>
          {!required && <SelectItem value={NO_WORKFLOW}>No workflow</SelectItem>}
          {withSteps.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-label-small text-m-on-surface-variant">{hintText}</p>
    </div>
  );
}

export default WorkflowSelect;
