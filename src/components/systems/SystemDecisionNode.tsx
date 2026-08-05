// Custom React Flow node — pill-shaped decision block, e.g. "◇ Won?".
//
// There's no `is_decision` column and the plan says not to add one. The
// simplest existing signal: a step whose title ends in "?" (matching the
// visual spec's own example, "◇ Won?"). SystemCanvas.tsx makes that call when
// choosing node types; this component just renders whatever step it's given.
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/db";

type Step = Database["public"]["Tables"]["process_steps"]["Row"];

export type DecisionNodeData = { step: Step };
export type DecisionNodeType = Node<DecisionNodeData, "decision">;

export function SystemDecisionNode({ data, selected }: NodeProps<DecisionNodeType>) {
  return (
    <div
      className={cn(
        "flex min-w-[120px] items-center justify-center rounded-full border border-dashed border-m-outline bg-m-surface px-4 py-2 text-center shadow-elev-1",
        selected && "ring-2 ring-m-primary ring-offset-1"
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-none !bg-m-outline" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-none !bg-m-outline" />
      <span className="text-title-small font-semibold text-m-on-surface">◇ {data.step.title}</span>
    </div>
  );
}
