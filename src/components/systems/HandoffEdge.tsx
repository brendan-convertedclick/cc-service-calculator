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
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
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
}: EdgeProps<HandoffEdgeType>) {
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
        className={cn(isHandoff ? "stroke-m-secondary" : "stroke-m-outline-variant")}
        style={{ strokeWidth: isHandoff ? 2 : 1.5, strokeDasharray: isHandoff ? "6 4" : undefined }}
      />
      {isHandoff && (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className="pointer-events-none absolute rounded-full bg-m-secondary-container px-2 py-0.5 text-label-small font-bold uppercase tracking-wide text-m-on-secondary-container"
          >
            ⇄ Handoff
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
