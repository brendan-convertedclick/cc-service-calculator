// Custom React Flow edge. Amber + dashed + "⇄ Handoff" label when the source
// and target steps belong to different departments.
//
// `isHandoff` is computed client-side in SystemCanvas.tsx from steps already
// loaded for the canvas, rather than querying the `system_handoffs` view —
// the view is pre-filtered to handoffs only, so rendering *every* edge
// (handoff or not) would still need the full system_edges list either way;
// computing the flag locally is the smaller diff, with identical semantics
// (`source.department_id is distinct from target.department_id` and plain
// `!==` agree on every null combination).
//
// No M3 "amber" role exists (tokens.css only has primary/secondary/tertiary/
// error) — SystemDetail.tsx's revision diff view hit the same gap and picked
// `secondary` as the closest neutral-but-distinct role rather than inventing
// a token or a hex. Same choice here for consistency.
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, type Edge, type EdgeProps } from "@xyflow/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type HandoffEdgeData = { isHandoff: boolean };
export type HandoffEdgeType = Edge<HandoffEdgeData, "handoff">;

export function HandoffEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
  selected,
}: EdgeProps<HandoffEdgeType>) {
  // deleteElements → triggerEdgeChanges → onEdgesChange even with no default
  // edges (verified in the dist build), which is the same path Backspace
  // takes — so the removal still routes through SystemCanvas's single
  // disconnect mutation rather than needing a second one wired through props.
  const { deleteElements } = useReactFlow();
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const isHandoff = data?.isHandoff ?? false;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        // `!` on the selected branch: React Flow's own stylesheet ships
        // `.react-flow__edge.selected .react-flow__edge-path { stroke: #555 }`,
        // which outranks a plain utility class on the path and would repaint
        // selection in a grey that isn't in the token set.
        className={cn(
          selected ? "!stroke-m-primary" : isHandoff ? "stroke-m-secondary" : "stroke-m-outline-variant"
        )}
        style={{
          strokeWidth: selected ? 2.5 : isHandoff ? 2 : 1.5,
          strokeDasharray: isHandoff ? "6 4" : undefined,
        }}
      />
      {/* Selected wins the midpoint: the × is the reason you clicked the line,
          and the handoff pill would sit on top of it. Drag either endpoint to
          re-target the connection — React Flow's own reconnect anchors, live
          because SystemCanvas passes onReconnect. */}
      {selected ? (
        <EdgeLabelRenderer>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void deleteElements({ edges: [{ id }] });
            }}
            title="Delete this connection"
            aria-label="Delete this connection"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className="nodrag nopan pointer-events-auto absolute grid h-5 w-5 place-items-center rounded-md border border-m-outline bg-m-surface text-m-error shadow-elev-2 hover:bg-m-error-container hover:text-m-on-error-container"
          >
            <X className="h-3 w-3" />
          </button>
        </EdgeLabelRenderer>
      ) : (
        isHandoff && (
          <EdgeLabelRenderer>
            <div
              style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
              className="pointer-events-none absolute rounded-md bg-m-secondary-container px-2 py-0.5 text-label-small font-bold uppercase tracking-wide text-m-on-secondary-container"
            >
              ⇄ Handoff
            </div>
          </EdgeLabelRenderer>
        )
      )}
    </>
  );
}
