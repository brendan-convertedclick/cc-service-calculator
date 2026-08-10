// The two ends of a flow: where it starts and what it's for.
//
// These are DERIVED, not rows in process_steps — the system already stores
// both ("Trigger" and "Goal" on the Setup pane), so a real step row would only
// duplicate them and then need hours, an owner, a department, a ClickUp
// materialise mode and a place in every revision diff, none of which mean
// anything for a terminal. SystemCanvas computes one Start and one Goal per
// system and wires them to the graph's roots and leaves.
import { Flag, Play } from "lucide-react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { TERMINAL_SIZE } from "./useAutoLayout";

export type TerminalNodeData = { kind: "start" | "goal"; label: string };
export type TerminalNodeType = Node<TerminalNodeData, "terminal">;

export function SystemTerminalNode({ data }: NodeProps<TerminalNodeType>) {
  const isStart = data.kind === "start";
  const Icon = isStart ? Play : Flag;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border px-4 py-2 shadow-elev-1",
        isStart
          ? "border-m-outline-variant bg-m-surface-container-high"
          : "border-m-primary bg-m-primary-container"
      )}
      style={{ width: TERMINAL_SIZE.width, minHeight: TERMINAL_SIZE.height }}
    >
      <Icon
        className={cn("h-3.5 w-3.5 flex-none", isStart ? "text-m-on-surface-variant" : "text-m-on-primary-container")}
      />
      <div className="min-w-0">
        <div
          className={cn(
            "text-label-small uppercase tracking-wide",
            isStart ? "text-m-on-surface-variant" : "text-m-on-primary-container"
          )}
        >
          {isStart ? "Start" : "Goal"}
        </div>
        {/* trigger_text / goal_statement are free text and can run to a
            sentence — clamp rather than let one system stretch the pill. */}
        <div
          className={cn(
            "line-clamp-2 text-label-medium font-medium leading-tight",
            isStart ? "text-m-on-surface" : "text-m-on-primary-container"
          )}
        >
          {data.label}
        </div>
      </div>

      {/* One handle, the right way round, and not connectable: an edge drawn
          from a terminal would be written to process_step_edges with an id
          that has no matching row. */}
      {isStart ? (
        <Handle
          type="source"
          position={Position.Right}
          isConnectable={false}
          className="!h-2 !w-2 !border-none !bg-m-outline"
        />
      ) : (
        <Handle
          type="target"
          position={Position.Left}
          isConnectable={false}
          className="!h-2 !w-2 !border-none !bg-m-outline"
        />
      )}
    </div>
  );
}
