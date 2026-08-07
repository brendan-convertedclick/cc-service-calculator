// Custom React Flow node — diamond-shaped decision block, e.g. "Won?".
//
// There's no `is_decision` column and the plan says not to add one. The
// simplest existing signal: a step whose title ends in "?" (matching the
// visual spec's own example, "◇ Won?"). SystemCanvas.tsx makes that call when
// choosing node types; this component just renders whatever step it's given.
//
// The diamond is a rotated square with an UNrotated label sitting on top —
// clip-path would give the shape but can't carry a border, and rotating the
// text with the box makes it unreadable.
//
// Three source handles (right, bottom, top) because a decision is where flow
// splits: one outgoing point would force every branch through the same edge
// origin and the fork would be unreadable.
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/db";

type Step = Database["public"]["Tables"]["process_steps"]["Row"];

export type DecisionNodeData = { step: Step; dimmed?: boolean };
export type DecisionNodeType = Node<DecisionNodeData, "decision">;

const SIZE = 104;

export function SystemDecisionNode({ data, selected }: NodeProps<DecisionNodeType>) {
  return (
    <div
      className={cn("relative transition-opacity", data.dimmed && "opacity-25")}
      style={{ width: SIZE, height: SIZE }}
    >
      {/* the shape */}
      <div
        className={cn(
          "absolute inset-[14%] rotate-45 border border-dashed border-m-outline bg-m-surface shadow-elev-1",
          selected && "border-solid border-m-primary ring-2 ring-m-primary"
        )}
      />
      {/* the label, kept upright */}
      <div className="absolute inset-0 flex items-center justify-center px-3 text-center">
        <span className="line-clamp-3 text-label-large font-semibold leading-tight text-m-on-surface">
          {data.step.title}
        </span>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-none !bg-m-outline"
        style={{ left: 2 }}
      />
      {/* Branch outputs. Distinct ids so an edge remembers which way it left. */}
      <Handle
        id="yes"
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-none !bg-m-primary"
        style={{ right: 2 }}
      />
      <Handle
        id="no"
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-none !bg-m-primary"
        style={{ bottom: 2 }}
      />
      <Handle
        id="alt"
        type="source"
        position={Position.Top}
        className="!h-2 !w-2 !border-none !bg-m-primary"
        style={{ top: 2 }}
      />
    </div>
  );
}
