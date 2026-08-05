// Pure dagre wrapper for the canvas's "Tidy up" action and for giving a step
// a sensible starting position the first time it's dragged onto the board.
//
// Cycles are permitted (spec: no cycle check — loops are real in marketing
// systems) and dagre lays them out fine without special-casing.
import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";

const BLOCK_SIZE = { width: 220, height: 100 };
const DECISION_SIZE = { width: 130, height: 56 };

// A fresh object per call, not the shared constant — dagre writes x/y/rank
// straight onto whatever label object you hand `setNode`, so passing the
// same BLOCK_SIZE/DECISION_SIZE reference for every node of that type makes
// them alias one object: the last node dagre visits silently overwrites
// every earlier same-type node's position with its own. Verified by a
// standalone dagre repro (two nodes sharing one object end up `===` after
// layout, both holding the last-written x/y).
function sizeOf(node: Node): { width: number; height: number } {
  return node.type === "decision" ? { ...DECISION_SIZE } : { ...BLOCK_SIZE };
}

// Lays out the whole graph left-to-right and returns a NEW node array with
// `position` replaced by the dagre result. Callers decide which of the
// returned positions to actually apply (e.g. only nodes that had no saved
// position yet) — this function always repositions everything it's given.
export function layoutNodes<N extends Node>(nodes: N[], edges: Pick<Edge, "source" | "target">[]): N[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 96 });

  for (const n of nodes) g.setNode(n.id, sizeOf(n));
  for (const e of edges) g.setEdge(e.source, e.target);

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    if (!pos) return n;
    const { width, height } = sizeOf(n);
    return { ...n, position: { x: pos.x - width / 2, y: pos.y - height / 2 } };
  });
}

// Named `useAutoLayout` (not a plain export) per the plan's component list —
// it has no internal state so it's a thin hook wrapper around the pure
// function above, not a "real" hook. Kept as a hook anyway for the naming
// convention / so it reads the same as the plan's "Tidy up calling
// useAutoLayout".
export function useAutoLayout() {
  return { layoutNodes };
}
