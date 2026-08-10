// Custom React Flow node — one system step rendered as a block. Matches
// docs/2026-08-05-systems-canvas-visual-spec.html's block anatomy, translated
// to M3 tokens: department colour is real data (departments.color) so it's
// the one legitimate inline-style exception; everything else is `m-` classes.
import { useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn, errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateStep, useDeleteStep, useUpdateStep } from "@/hooks/useProcessSteps";
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
  // The owner's colour from the shared team palette (memberColors in
  // useTeam.ts) — same colour that person carries on the productivity Team
  // rail, so an avatar is recognisable at a glance instead of every block
  // wearing the same container tint.
  ownerColor?: string | null;
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
  const { step, department, owner, subSteps, dimmed, ownerColor, onAvatarClick, onSelectSubStep } = data;
  const [nestedOpen, setNestedOpen] = useState(false);
  const addSub = useCreateStep();
  const updateSub = useUpdateStep();
  const deleteSub = useDeleteStep();
  const unassigned = !department;
  const hasSubSteps = subSteps.length > 0;

  return (
    <>
      <div
        // Opens whether or not sub-steps exist: gating on hasSubSteps meant
        // the first sub-step could never be created, since this dialog is the
        // only place they're managed.
        onDoubleClick={(e) => {
          e.stopPropagation();
          setNestedOpen(true);
        }}
        className={cn(
          "min-w-[200px] max-w-[240px] rounded-xl border-l-[5px] bg-m-surface px-3 py-2.5 shadow-elev-1 transition-all hover:shadow-elev-3",
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
        {/* A second output so a step can fork without every branch leaving from
            the same point. Flow splits are real (a step that kicks off two
            parallel workstreams), not only decisions. */}
        <Handle
          id="branch"
          type="source"
          position={Position.Bottom}
          className="!h-2 !w-2 !border-none !bg-m-outline"
        />

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
                className={cn(
                  "grid h-6 w-6 flex-none cursor-pointer place-items-center rounded-full text-label-small font-bold leading-none",
                  ownerColor ? "text-white" : "bg-m-secondary-container text-m-on-secondary-container"
                )}
                style={ownerColor ? { background: ownerColor } : undefined}
                title={`Highlight ${owner.full_name}'s blocks`}
              >
                {initials(owner.full_name)}
              </span>
              {owner.full_name.split(/\s+/)[0]}
            </span>
          )}
          {step.estimated_hours != null && (
            <span className="rounded-md bg-m-surface-container-high px-2 py-0.5 font-mono text-label-small font-semibold text-m-primary">
              {step.estimated_hours}h
            </span>
          )}
          {hasSubSteps && (
            <span className="rounded-md bg-m-surface-container-high px-2 py-0.5 text-label-small font-semibold text-m-on-surface-variant">
              {subSteps.length} sub
            </span>
          )}
        </div>
      </div>

      <Dialog open={nestedOpen} onOpenChange={setNestedOpen}>
        {/* Every handler in here stops propagation. React portals (this Dialog
            renders into one) still bubble through the REACT tree, not just the
            DOM tree — without it a click continues past the Dialog/Portal
            boundary into React Flow's node-click wrapper (an ancestor in the
            React tree, even though physically it's nowhere near this portaled
            DOM node) and fires onNodeClick for the PARENT block. */}
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Inside: {step.title}</DialogTitle>
            <DialogDescription>
              Sub-steps materialise as checklist items on this step's ClickUp task — they carry no
              hours of their own. Rename one here, or open it in the inspector.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-1.5">
            {subSteps.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-lg bg-m-surface-container px-2.5 py-1.5 text-body-small text-m-on-surface"
              >
                <span className="w-5 flex-none text-center font-mono text-label-small text-m-on-surface-variant">
                  {s.ordinal}
                </span>
                <input
                  key={s.title}
                  defaultValue={s.title}
                  aria-label={`Sub-step ${s.ordinal} title`}
                  onBlur={(e) => {
                    const el = e.target;
                    const value = el.value.trim();
                    if (value === s.title) return;
                    if (!value) {
                      toast.error("A sub-step needs a title");
                      el.value = s.title;
                      return;
                    }
                    updateSub.mutate(
                      { id: s.id, patch: { title: value } },
                      {
                        onError: (err) => {
                          toast.error(`Could not rename sub-step: ${errorMessage(err)}`);
                          el.value = s.title;
                        },
                      }
                    );
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      e.currentTarget.value = s.title;
                      e.currentTarget.blur();
                    }
                  }}
                  className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1 py-0.5 outline-none hover:bg-m-surface-container-high focus:bg-m-surface focus:ring-1 focus:ring-m-primary"
                />
                <button
                  type="button"
                  aria-label={`Open "${s.title}" in the inspector`}
                  title="Open in the inspector"
                  onClick={() => {
                    onSelectSubStep?.(s);
                    setNestedOpen(false);
                  }}
                  className="inline-flex h-8 flex-none items-center rounded-md px-2.5 text-label-small text-m-on-surface-variant hover:bg-m-surface-container-high hover:text-m-on-surface"
                >
                  Inspect
                </button>
                <button
                  type="button"
                  aria-label={`Delete sub-step "${s.title}"`}
                  title="Delete this sub-step"
                  disabled={deleteSub.isPending}
                  onClick={() =>
                    deleteSub.mutate(
                      { id: s.id },
                      {
                        onSuccess: () => toast.success("Sub-step deleted"),
                        onError: (err) =>
                          toast.error(`Could not delete sub-step: ${errorMessage(err)}`),
                      }
                    )
                  }
                  className="grid h-8 w-8 flex-none place-items-center rounded-md text-m-on-surface-variant hover:bg-m-error-container hover:text-m-on-error-container"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {subSteps.length === 0 && (
              <li className="px-1 py-1 text-body-small text-m-on-surface-variant">
                No sub-steps yet.
              </li>
            )}
          </ol>
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1.5"
            disabled={addSub.isPending}
            onClick={() =>
              addSub.mutate(
                {
                  parent_id: step.id,
                  // Mirrors the parent's scope so siblings share one bucket of
                  // process_steps_ordinal_idx, and hours stay null per
                  // process_steps_substep_no_hours.
                  system_id: step.system_id,
                  service_id: step.service_id,
                  ordinal: subSteps.reduce((max, s) => Math.max(max, s.ordinal), 0) + 1,
                  title: "New sub-step",
                  estimated_hours: null,
                },
                {
                  onError: (err) =>
                    toast.error(`Could not add sub-step: ${errorMessage(err)}`),
                }
              )
            }
          >
            <Plus className="h-3.5 w-3.5" /> Add sub-step
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
