// Pure dagre wrapper for the canvas's "Tidy up" action and for giving a step
// a sensible starting position the first time it's dragged onto the board.
//
// Cycles are permitted (spec: no cycle check — loops are real in marketing
// systems) and dagre lays them out fine without special-casing.
import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";

const BLOCK_SIZE = { width: 220, height: 100 };
const DECISION_SIZE = { width: 130, height: 56 };
// Start/Goal pills. Never laid out by dagre (they're synthetic — see
// SystemCanvas's terminals memo), but the canvas positions them relative to
// the graph's roots and leaves and needs the same numbers the node renders at.
export const TERMINAL_SIZE = { width: 190, height: 56 };

// A fresh object per call, not the shared constant — dagre writes x/y/rank
// straight onto whatever label object you hand `setNode`, so passing the
// same BLOCK_SIZE/DECISION_SIZE reference for every node of that type makes
// them alias one object: the last node dagre visits silently overwrites
// every earlier same-type node's position with its own. Verified by a
// standalone dagre repro (two nodes sharing one object end up `===` after
// layout, both holding the last-written x/y).
// Exported so callers (e.g. the canvas's post-tidy fitBounds) can compute an
// exact bounding box from a node array without waiting on @xyflow's own
// internal per-node size measurement, which can still be catching up to a
// batch position update by the time a fit is requested.
export function sizeOf(node: Node): { width: number; height: number } {
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

const TERMINAL_GAP_X = 80;

/**
 * Where the Start and Goal pills go, and what they connect to. Start feeds
 * every node with no incoming edge; every node with no outgoing edge feeds
 * Goal. A pure cycle has neither (loops are allowed here), so both fall back
 * to the whole graph and the pills sit either side of it unwired.
 *
 * Pure and position-only so the canvas can recompute it on every render —
 * terminals are derived, never rows in process_steps.
 */
export function terminalAnchors<N extends Pick<Node, "id" | "position">>(
  nodes: N[],
  edges: Pick<Edge, "source" | "target">[]
): { roots: N[]; leaves: N[]; start: { x: number; y: number }; goal: { x: number; y: number } } {
  const hasIncoming = new Set(edges.map((e) => e.target));
  const hasOutgoing = new Set(edges.map((e) => e.source));
  const roots = nodes.filter((n) => !hasIncoming.has(n.id));
  const leaves = nodes.filter((n) => !hasOutgoing.has(n.id));

  const anchor = (group: N[], dx: number) => {
    const from = group.length > 0 ? group : nodes;
    const xs = from.map((n) => n.position.x);
    const ys = from.map((n) => n.position.y);
    return {
      x: (dx < 0 ? Math.min(...xs) : Math.max(...xs)) + dx,
      // Half a block down, so a pill lines up with a block's middle rather
      // than its top edge.
      y: ys.reduce((a, b) => a + b, 0) / ys.length + (BLOCK_SIZE.height - TERMINAL_SIZE.height) / 2,
    };
  };

  return {
    roots,
    leaves,
    start: anchor(roots, -(TERMINAL_SIZE.width + TERMINAL_GAP_X)),
    goal: anchor(leaves, BLOCK_SIZE.width + TERMINAL_GAP_X),
  };
}

// Named `useAutoLayout` (not a plain export) per the plan's component list —
// it has no internal state so it's a thin hook wrapper around the pure
// function above, not a "real" hook. Kept as a hook anyway for the naming
// convention / so it reads the same as the plan's "Tidy up calling
// useAutoLayout".
export function useAutoLayout() {
  return { layoutNodes };
}
