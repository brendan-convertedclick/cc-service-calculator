// Custom React Flow node — one system step rendered as a block. Matches
// docs/2026-08-05-systems-canvas-visual-spec.html's block anatomy, translated
// to M3 tokens: department colour is real data (departments.color) so it's
// the one legitimate inline-style exception; everything else is `m-` classes.
import { useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Database } from "@/types/db";

type Step = Database["public"]["Tables"]["process_steps"]["Row"];
type DeptRow = Database["public"]["Tables"]["departments"]["Row"];
type TeamRow = Database["public"]["Tables"]["team_members"]["Row"];

export type BlockNodeData = {
  step: Step;
  department: DeptRow | null;
  owner: TeamRow | null;
  // Full sub-step rows (title/ordinal), not just a count — sub-steps carry
  // no hours (process_steps_substep_no_hours), so that's all there is to
  // show in the nested view.
  subSteps: Step[];
  // "Highlight by person" — set on every node from SystemCanvas.tsx's render
  // overlay when someone's avatar is toggled on; dims blocks that aren't
  // theirs. Not persisted, view-only.
  dimmed?: boolean;
  onAvatarClick?: (ownerId: string) => void;
  // Lets a nested sub-step row point the BlockInspector at itself (the only
  // way a sub-step becomes selectable — sub-steps have no canvas node of
  // their own).
  onSelectSubStep?: (subStep: Step) => void;
};
export type BlockNodeType = Node<BlockNodeData, "block">;

export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

export function SystemBlockNode({ data, selected }: NodeProps<BlockNodeType>) {
  const { step, department, owner, subSteps, dimmed, onAvatarClick, onSelectSubStep } = data;
  const [nestedOpen, setNestedOpen] = useState(false);
  const unassigned = !department;
  const hasSubSteps = subSteps.length > 0;

  return (
    <>
      <div
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (hasSubSteps) setNestedOpen(true);
        }}
        className={cn(
          "min-w-[200px] max-w-[240px] rounded-md border-l-[5px] bg-m-surface px-3 py-2.5 shadow-elev-1 transition-all hover:shadow-elev-3",
          unassigned
            ? "border border-dashed border-m-error bg-m-error-container"
            : "border border-m-outline-variant",
          selected && "ring-2 ring-m-primary ring-offset-1",
          dimmed && "opacity-35"
        )}
        style={department?.color ? { borderLeftColor: department.color } : undefined}
      >
        <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-none !bg-m-outline" />
        <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-none !bg-m-outline" />

        {unassigned ? (
          <p className="text-label-small font-bold uppercase tracking-wide text-m-error">
            ⚠ Nobody owns this
          </p>
        ) : (
          <p
            className="text-label-small font-bold uppercase tracking-wide"
            style={department?.color ? { color: department.color } : undefined}
          >
            {department.name}
          </p>
        )}

        <p
          className={cn(
            "mt-0.5 text-title-small",
            unassigned ? "text-m-on-error-container" : "text-m-on-surface"
          )}
        >
          {step.title}
        </p>

        {(step.goal_statement || step.description) && (
          <p
            className={cn(
              "mt-0.5 italic text-label-small",
              unassigned ? "text-m-on-error-container/85" : "text-m-on-surface-variant"
            )}
          >
            {step.goal_statement || step.description}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {owner && (
            <span className="flex items-center gap-1 text-label-small font-semibold text-m-on-surface">
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onAvatarClick?.(owner.id);
                }}
                className="grid h-6 w-6 flex-none cursor-pointer place-items-center rounded-full bg-m-secondary-container text-label-small font-bold leading-none text-m-on-secondary-container"
                title={`Highlight ${owner.full_name}'s blocks`}
              >
                {initials(owner.full_name)}
              </span>
              {owner.full_name.split(/\s+/)[0]}
            </span>
          )}
          {step.estimated_hours != null && (
            <span className="rounded-sm bg-m-surface-container-high px-1.5 py-0.5 font-mono text-label-small font-semibold text-m-primary">
              {step.estimated_hours}h
            </span>
          )}
          {hasSubSteps && (
            <span className="rounded-sm bg-m-surface-container-high px-1.5 py-0.5 text-label-small font-semibold text-m-on-surface-variant">
              {subSteps.length} sub
            </span>
          )}
        </div>
      </div>

      <Dialog open={nestedOpen} onOpenChange={setNestedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inside: {step.title}</DialogTitle>
            <DialogDescription>
              Sub-steps materialise as checklist items on this step's ClickUp task — they carry no
              hours of their own. Click one to edit it in the inspector.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-1.5">
            {subSteps.map((s) => (
              <li
                key={s.id}
                onClick={(e) => {
                  // React portals (this Dialog renders into one) still
                  // bubble through the REACT tree, not just the DOM tree —
                  // without this, the click continues past Dialog/Portal
                  // boundaries up into React Flow's own node-click wrapper
                  // (an ancestor of this component in the React tree, even
                  // though physically it's nowhere near this portaled DOM
                  // node), firing onNodeClick for the PARENT block right
                  // after this one selects the sub-step, clobbering it.
                  e.stopPropagation();
                  onSelectSubStep?.(s);
                  setNestedOpen(false);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md bg-m-surface-container px-2.5 py-1.5 text-body-small text-m-on-surface hover:bg-m-surface-container-high"
              >
                <span className="w-5 flex-none text-center font-mono text-label-small text-m-on-surface-variant">
                  {s.ordinal}
                </span>
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
