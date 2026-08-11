// The drag-and-drop canvas for one system's steps. Lane-free per
// docs/2026-08-05-systems-canvas-visual-spec.html: department is a colour on
// the block, not a container around it.
//
// Loaded via React.lazy from SystemDetail.tsx so @xyflow/react never enters
// the main bundle. Only this file (and its lazy-loaded siblings) pull in the
// library, so the CSS import lives here too, not in index.css/main.tsx.
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeTypes,
  type FinalConnectionState,
  type NodeTypes,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import { Diamond, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";
import { useSystemSteps } from "@/hooks/useProcessSteps";
import { useDepartments } from "@/hooks/useDepartments";
import { memberColors, useTeam } from "@/hooks/useTeam";
import { useSystemRevisions } from "@/hooks/useSystemRevisions";
import {
  useConnectSteps,
  useDisconnectSteps,
  useReconnectEdge,
  useSaveStepPosition,
  useSystemEdges,
  useSystemSubSteps,
} from "@/hooks/useSystemCanvas";
import { SystemBlockNode, type BlockNodeType } from "./SystemBlockNode";
import { SystemDecisionNode, type DecisionNodeType } from "./SystemDecisionNode";
import { SystemTerminalNode, type TerminalNodeType } from "./SystemTerminalNode";
import { HandoffEdge, type HandoffEdgeType } from "./HandoffEdge";
import { BlockInspector } from "./BlockInspector";
import { DeleteStepDialog } from "./DeleteStepDialog";
import { DeptRollup } from "./DeptRollup";
import { sizeOf, terminalAnchors, useAutoLayout } from "./useAutoLayout";
import type { Database } from "@/types/db";

type Step = Database["public"]["Tables"]["process_steps"]["Row"];
type DeptRow = Database["public"]["Tables"]["departments"]["Row"];

// Terminals are in the union because React Flow renders them, but never in
// `nodes` state — see the terminals memo below.
type CanvasNode = BlockNodeType | DecisionNodeType | TerminalNodeType;

// Module-level constants — nodeTypes/edgeTypes must not be recreated every
// render, or React Flow remounts every node/edge.
const nodeTypes: NodeTypes = {
  block: SystemBlockNode,
  decision: SystemDecisionNode,
  terminal: SystemTerminalNode,
};
const edgeTypes: EdgeTypes = { handoff: HandoffEdge };

const POSITION_SAVE_DEBOUNCE_MS = 800;

// Position writes deliberately bypass useSaveStepPosition (see that hook's
// comment): N concurrent .mutate() calls on one useMutation instance only run
// the last one's callbacks, which would strand ids in `pendingIds` forever.
// A supabase builder is lazy — it only issues the request when `then` is
// called — so this must return the promise, never the bare builder.
function savePos(id: string, x: number, y: number): PromiseLike<unknown> {
  return supabase
    .from("process_steps")
    .update({ pos_x: Math.round(x), pos_y: Math.round(y) })
    .eq("id", id)
    .then((r) => r);
}

// A step "is a decision" when its title reads like one — matches the visual
// spec's own example ("◇ Won?") and needs no new column: the plan explicitly
// says not to add one if an existing signal will do.
function isDecisionTitle(title: string): boolean {
  return title.trim().endsWith("?");
}

// Vertical drop for a step added after the initial layout, so it lands below
// the existing graph and inside the viewport rather than stacking at 0,0.
const NEW_NODE_GAP_Y = 140;

// Half a block, so setCenter lands on the block's middle rather than its
// top-left corner.
const NODE_CENTRE_X = 90;
const NODE_CENTRE_Y = 45;

// Synthetic node/edge ids for the Start and Goal terminals. The "__" prefix is
// what tells the edge-remove handler these aren't process_step_edges rows.
const SYNTHETIC_PREFIX = "__";
const TERMINAL_START_ID = "__start__";
const TERMINAL_GOAL_ID = "__goal__";

function buildNode(step: Step): CanvasNode {
  const position = { x: step.pos_x ?? 0, y: step.pos_y ?? 0 };
  // Seed with a minimal, correct-typed placeholder — the renderNodes overlay
  // below fills in real department/owner/subSteps/dimmed on every render, so
  // this shape only needs to satisfy the type, never to be visually correct.
  if (isDecisionTitle(step.title)) {
    return { id: step.id, type: "decision", position, data: { step } };
  }
  return {
    id: step.id,
    type: "block",
    position,
    data: { step, department: null, owner: null, subSteps: [] },
  };
}

/**
 * Creates one step and (optionally) the edge that reaches it. Owned by
 * SystemDetail because only that page knows the system's service_id and the
 * next ordinal — the canvas just supplies where the line was dropped.
 */
export type CreateStepFn = (opts: {
  pos_x?: number;
  pos_y?: number;
  connectFrom?: string | null;
  sourceHandle?: string | null;
  /** Seeds the title. A "?" ending is what makes it render as a diamond. */
  title?: string;
}) => Promise<unknown>;

type CanvasProps = {
  systemId: string;
  systemName: string;
  /** kind='process': blocks describe a stage and carry 0..N procedures. */
  isProcess?: boolean;
  /** system.trigger_text — labels the Start terminal. */
  triggerText?: string | null;
  /** system.goal_statement, PLACEHOLDER_GOAL already blanked by the caller. */
  goalStatement?: string | null;
  onPropose: () => void;
  onCreateStep: CreateStepFn;
  /** Step to select and centre — bumped when a Steps-list row is clicked. */
  focusStepId?: { id: string; nonce: number } | null;
  /** Viewer without write permission (system_* RLS is admin/owner for writes,
   *  read for everyone). Keeps pan/zoom/selection — the diagram is the point —
   *  and drops every gesture and button that would write. */
  readOnly?: boolean;
};

export function SystemCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <SystemCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function SystemCanvasInner({
  systemId,
  systemName,
  isProcess = false,
  triggerText,
  goalStatement,
  onPropose,
  onCreateStep,
  focusStepId,
  readOnly = false,
}: CanvasProps) {
  const { data: topSteps = [], isLoading: stepsLoading } = useSystemSteps(systemId);
  const { data: depts = [] } = useDepartments();
  const { data: team = [] } = useTeam();
  // Same query key SystemDetail.tsx already fetches — reused from cache, not
  // a second network round-trip, for the bar's "— draft rev 2" and the
  // inspector's "Revision" field.
  const { data: revisions = [] } = useSystemRevisions(systemId);

  const topLevelIds = useMemo(() => topSteps.map((s) => s.id), [topSteps]);
  const { data: subSteps = [], isLoading: subStepsLoading } = useSystemSubSteps(topLevelIds);
  const { data: edgeRows = [], isLoading: edgesLoading } = useSystemEdges(systemId);

  const deptById = useMemo(() => new Map(depts.map((d) => [d.id, d])), [depts]);
  const teamById = useMemo(() => new Map(team.map((t) => [t.id, t])), [team]);
  const colorByOwner = useMemo(() => memberColors(team), [team]);
  const topStepById = useMemo(() => new Map(topSteps.map((s) => [s.id, s])), [topSteps]);
  const subStepsByParent = useMemo(() => {
    const m = new Map<string, Step[]>();
    for (const s of subSteps) {
      if (!s.parent_id) continue;
      const arr = m.get(s.parent_id);
      if (arr) arr.push(s);
      else m.set(s.parent_id, [s]);
    }
    return m;
  }, [subSteps]);

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  // Guards the seeding effect below to "once per system", not "once per
  // steps value" — see the effect's own comment and useSystemCanvas.ts's
  // note on useSaveStepPosition never invalidating.
  const seededFor = useRef<string | null>(null);

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Step | null>(null);
  // Edges are derived from the query, never held in state, so their selection
  // flag has to live somewhere — see the edges useMemo for why it's needed.
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(new Set());
  const [highlightedOwnerId, setHighlightedOwnerId] = useState<string | null>(null);
  // Steps with a position write in flight or queued behind the drag debounce
  // — a Set (not a boolean) so two overlapping drags don't clear the
  // "Unsaved" indicator the moment either one settles.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const markPending = useCallback((id: string) => setPendingIds((prev) => new Set(prev).add(id)), []);
  const clearPending = useCallback(
    (id: string) =>
      setPendingIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    []
  );

  const savePosition = useSaveStepPosition();
  const connect = useConnectSteps(systemId);
  const disconnect = useDisconnectSteps(systemId);
  const reconnect = useReconnectEdge(systemId);
  const { layoutNodes } = useAutoLayout();

  const edges: HandoffEdgeType[] = useMemo(() => {
    return edgeRows.map((e) => {
      const source = topStepById.get(e.source_step_id);
      const target = topStepById.get(e.target_step_id);
      // Matches `is distinct from` in every null combination: both null →
      // false, one null → true, both set and equal → false, else → true.
      const isHandoff = (source?.department_id ?? null) !== (target?.department_id ?? null);
      return {
        id: e.id,
        source: e.source_step_id,
        target: e.target_step_id,
        type: "handoff",
        markerEnd: { type: MarkerType.ArrowClosed },
        // React Flow is fully controlled here, and in controlled mode its
        // store only *reports* selection changes — it never writes them back
        // (`triggerEdgeChanges` guards `setEdges` on `hasDefaultEdges`). The
        // Backspace handler then does `edges.filter(selected)`, so without
        // carrying selection ourselves no edge is ever deletable and the
        // "remove" branch of onEdgesChange below is dead code.
        selected: selectedEdgeIds.has(e.id),
        // Restore the branch this edge left from, or a split collapses on reload.
        sourceHandle: e.source_handle ?? undefined,
        data: { isHandoff },
      };
    });
  }, [edgeRows, topStepById, selectedEdgeIds]);

  // Seed local node state once per system (on identity, not on every steps/
  // edges refetch): the position mutation never invalidates ["process_steps"]
  // precisely so drags don't get raced by a refetch, so re-running this on
  // every data change would be the only other way a save could get clobbered
  // mid-session. A route change to a different system resets the guard.
  useEffect(() => {
    if (stepsLoading || subStepsLoading || edgesLoading) return;
    if (seededFor.current === systemId) return;
    seededFor.current = systemId;

    let built = topSteps.map(buildNode);
    const missingIds = new Set(topSteps.filter((s) => s.pos_x == null || s.pos_y == null).map((s) => s.id));
    if (missingIds.size > 0) {
      const laidOut = layoutNodes(
        built,
        edgeRows.map((e) => ({ source: e.source_step_id, target: e.target_step_id }))
      );
      const laidOutById = new Map(laidOut.map((n) => [n.id, n]));
      built = built.map((n) => (missingIds.has(n.id) ? laidOutById.get(n.id) ?? n : n));
      for (const n of built) {
        if (missingIds.has(n.id)) {
          savePosition.mutate({ id: n.id, pos_x: Math.round(n.position.x), pos_y: Math.round(n.position.y) });
        }
      }
    }
    setNodes(built);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, stepsLoading, subStepsLoading, edgesLoading]);

  // Reconcile steps added or deleted AFTER the seed. The seed above runs once
  // per system so a refetch can't clobber an in-flight drag — which also meant
  // a newly added step never became a node and simply didn't render (the
  // rollup strip still counted it, since that reads the query data). This adds
  // and removes nodes only, never touching an existing node's position.
  useEffect(() => {
    if (stepsLoading || seededFor.current !== systemId) return;
    setNodes((cur) => {
      const known = new Set(cur.map((n) => n.id));
      const live = new Set(topSteps.map((s) => s.id));
      const added = topSteps.filter((s) => !known.has(s.id));
      const kept = cur.filter((n) => live.has(n.id));
      if (added.length === 0 && kept.length === cur.length) return cur;

      // A new step has no stored position. Drop it below the lowest block so it
      // lands in view rather than stacking at the origin, and persist that so
      // the next load agrees with what was just shown.
      let nextY = kept.reduce((m, n) => Math.max(m, n.position.y), 0);
      const placed = added.map((s) => {
        const node = buildNode(s);
        if (s.pos_x == null || s.pos_y == null) {
          nextY += NEW_NODE_GAP_Y;
          node.position = { x: 0, y: nextY };
        }
        return node;
      });
      return [...kept, ...placed];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topSteps, systemId, stepsLoading]);

  // Persist positions for steps that arrived without one. Kept out of the
  // setNodes updater above: React may invoke an updater twice (StrictMode),
  // and a mutation is not something to fire twice. The ref is load-bearing —
  // savePosition deliberately does NOT invalidate ["process_steps"], so the
  // cached row keeps its null pos_x and this would otherwise re-fire on every
  // nodes change forever.
  const positionSeeded = useRef(new Set<string>());
  useEffect(() => {
    for (const n of nodes) {
      const step = topStepById.get(n.id);
      if (!step || positionSeeded.current.has(n.id)) continue;
      if (step.pos_x == null || step.pos_y == null) {
        positionSeeded.current.add(n.id);
        // savePos, not savePosition.mutate — several new steps can seed at once
        // and concurrent .mutate() calls on one useMutation only run the last
        // one's callbacks (see savePos's comment above).
        void savePos(n.id, n.position.x, n.position.y);
      }
    }
     
  }, [nodes, topStepById]);

  // Clicking a row in SystemDetail's Steps list selects that block and centres
  // it. Keyed on a nonce, not the id, so clicking the same row twice re-centres
  // instead of doing nothing.
  const { setCenter, screenToFlowPosition } = useReactFlow();
  useEffect(() => {
    if (!focusStepId) return;
    const node = nodes.find((n) => n.id === focusStepId.id);
    if (!node) return;
    setSelectedStepId(focusStepId.id);
    setCenter(node.position.x + NODE_CENTRE_X, node.position.y + NODE_CENTRE_Y, {
      zoom: 1,
      duration: 400,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusStepId?.id, focusStepId?.nonce, nodes.length]);

  const handleAvatarClick = useCallback((ownerId: string) => {
    setHighlightedOwnerId((cur) => (cur === ownerId ? null : ownerId));
  }, []);

  const handleSelectSubStep = useCallback((subStep: Step) => {
    setSelectedStepId(subStep.id);
  }, []);

  // Content (title/department/owner/hours/subSteps/dimmed) is derived fresh
  // from query data on every render; `nodes` above only owns position, which
  // is why a step edited from BlockInspector shows up on the block without
  // waiting for a reload, while an in-progress drag is never overwritten by
  // a background refetch.
  const renderNodes: CanvasNode[] = useMemo(() => {
    return nodes.map((n): CanvasNode => {
      const step = topStepById.get(n.id);
      if (!step) return n;
      if (isDecisionTitle(step.title)) {
        const decisionNode: DecisionNodeType = {
          ...n,
          type: "decision",
          data: { step, dimmed: highlightedOwnerId != null && step.owner_id !== highlightedOwnerId },
        };
        return decisionNode;
      }
      const department = step.department_id ? deptById.get(step.department_id) ?? null : null;
      const owner = step.owner_id ? teamById.get(step.owner_id) ?? null : null;
      const dimmed = highlightedOwnerId != null && owner?.id !== highlightedOwnerId;
      const blockNode: BlockNodeType = {
        ...n,
        type: "block",
        data: {
          step,
          department,
          owner,
          subSteps: subStepsByParent.get(step.id) ?? [],
          dimmed,
          ownerColor: owner ? colorByOwner.get(owner.id) ?? null : null,
          onAvatarClick: handleAvatarClick,
          onSelectSubStep: handleSelectSubStep,
        },
      };
      return blockNode;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, topStepById, deptById, teamById, colorByOwner, subStepsByParent, highlightedOwnerId]);

  // Start and Goal. Derived every render from live node positions (so they
  // follow drags and Tidy up) and from edgeRows: Start feeds every block with
  // no incoming edge, every block with no outgoing edge feeds Goal. A pure
  // cycle has neither, in which case the pills just sit either side unwired.
  //
  // Deliberately NOT part of `nodes` state — the seed/reconcile/position
  // effects all assume a node id is a process_steps id, and savePos would 404
  // on these. They're appended at render time instead.
  const terminals = useMemo(() => {
    if (nodes.length === 0) return { nodes: [] as CanvasNode[], edges: [] as HandoffEdgeType[] };
    const { roots, leaves, start, goal } = terminalAnchors(
      nodes,
      edgeRows.map((e) => ({ source: e.source_step_id, target: e.target_step_id }))
    );

    const terminalNodes: CanvasNode[] = [
      {
        id: TERMINAL_START_ID,
        type: "terminal",
        position: start,
        data: { kind: "start", label: triggerText?.trim() || "Whatever kicks this off" },
        draggable: false,
        selectable: false,
        deletable: false,
      },
      {
        id: TERMINAL_GOAL_ID,
        type: "terminal",
        position: goal,
        data: { kind: "goal", label: goalStatement?.trim() || "No goal set" },
        draggable: false,
        selectable: false,
        deletable: false,
      },
    ];

    const terminalEdges: HandoffEdgeType[] = [
      ...roots.map((n) => ({ id: `${TERMINAL_START_ID}${n.id}`, source: TERMINAL_START_ID, target: n.id })),
      ...leaves.map((n) => ({ id: `${TERMINAL_GOAL_ID}${n.id}`, source: n.id, target: TERMINAL_GOAL_ID })),
    ].map((e) => ({
      ...e,
      type: "handoff" as const,
      markerEnd: { type: MarkerType.ArrowClosed },
      selectable: false,
      deletable: false,
      data: { isHandoff: false },
    }));

    return { nodes: terminalNodes, edges: terminalEdges };
  }, [nodes, edgeRows, triggerText, goalStatement]);

  const allNodes = useMemo(() => [...renderNodes, ...terminals.nodes], [renderNodes, terminals]);
  const allEdges = useMemo(() => [...edges, ...terminals.edges], [edges, terminals]);

  const allStepsById = useMemo(() => {
    const m = new Map<string, Step>();
    for (const s of topSteps) m.set(s.id, s);
    for (const s of subSteps) m.set(s.id, s);
    return m;
  }, [topSteps, subSteps]);
  const selectedStep = selectedStepId ? allStepsById.get(selectedStepId) ?? null : null;

  const incomingLabel = useMemo(() => {
    if (!selectedStep) return null;
    if (selectedStep.parent_id) return "Sub-step — no direct connections";
    const incoming = edges.filter((e) => e.target === selectedStep.id);
    if (incoming.length === 0) return "No incoming connection";
    const handoff = incoming.find((e) => e.data?.isHandoff);
    if (!handoff) return "Continues within department";
    const fromDeptId = topStepById.get(handoff.source)?.department_id ?? null;
    const fromDeptName = fromDeptId ? deptById.get(fromDeptId)?.name ?? "Unknown" : "Unassigned";
    return `⇄ Handoff from ${fromDeptName}`;
  }, [selectedStep, edges, topStepById, deptById]);

  const latestRevision = revisions[0] ?? null;
  const revisionBarLabel = latestRevision ? `${latestRevision.state} rev ${latestRevision.revision}` : null;
  const revisionInspectorLabel = latestRevision
    ? `Rev ${latestRevision.revision} ${latestRevision.state}`
    : "No revisions yet";

  const rollup = useMemo(() => {
    const byDept = new Map<string, { dept: DeptRow; hours: number }>();
    let unassignedCount = 0;
    let totalHours = 0;
    for (const s of topSteps) {
      const hours = s.estimated_hours ?? 0;
      totalHours += hours;
      const dept = s.department_id ? deptById.get(s.department_id) ?? null : null;
      if (!dept) {
        unassignedCount += 1;
        continue;
      }
      const entry = byDept.get(dept.id);
      if (entry) entry.hours += hours;
      else byDept.set(dept.id, { dept, hours });
    }
    return { items: Array.from(byDept.values()), unassignedCount, totalHours };
  }, [topSteps, deptById]);

  // Queued drag saves: the timer plus the position it is going to write.
  const dragTimers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; x: number; y: number }>());
  // Measured for Tidy up's post-layout re-centre — see handleTidyUp.
  const flowWrapperRef = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      // FLUSH on unmount, don't just clear. A debounce that drops its timers
      // when the component goes away silently loses the very last drag
      // (navigate off the page inside the 800ms window and the position is
      // gone) — the exact opposite of this phase's "drag → reload → identical"
      // bar. clearPending is skipped here on purpose: we're unmounting.
      for (const [id, p] of dragTimers.current) {
        clearTimeout(p.timer);
        void savePos(id, p.x, p.y);
      }
      dragTimers.current.clear();
    },
    []
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, node: CanvasNode) => {
      const existing = dragTimers.current.get(node.id);
      if (existing) clearTimeout(existing.timer);
      markPending(node.id);
      const { x, y } = node.position;
      const timer = setTimeout(() => {
        dragTimers.current.delete(node.id);
        void savePos(node.id, x, y).then(() => clearPending(node.id));
      }, POSITION_SAVE_DEBOUNCE_MS);
      dragTimers.current.set(node.id, { timer, x, y });
    },
    [markPending, clearPending]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      // A step pointing at itself draws nothing and means nothing; the DB
      // would happily store it.
      if (!connection.source || !connection.target || connection.source === connection.target) return;
      connect.mutate(
        {
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle,
        },
        { onError: (e) => toast.error(`Could not connect those steps: ${errorMessage(e)}`) }
      );
    },
    [connect]
  );

  // Let go of a connection over empty canvas → that's a request for a step
  // that doesn't exist yet. `isValid` is null (not false) on a void drop, so
  // this must test truthiness, never `=== false`, or it misses the only case
  // it exists for.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode) return;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      const dropped = screenToFlowPosition({ x: point.clientX, y: point.clientY });
      // A node's position is its top-left, so drop the block centred on the
      // cursor rather than hanging below-right of it.
      void onCreateStep({
        pos_x: dropped.x - NODE_CENTRE_X,
        pos_y: dropped.y - NODE_CENTRE_Y,
        connectFrom: state.fromNode.id,
        sourceHandle: state.fromHandle?.id ?? null,
      });
    },
    [screenToFlowPosition, onCreateStep]
  );

  // Drag either end of an existing edge onto a different handle. The edges
  // here are derived from query data, so a rejected move needs no undo — the
  // mutation's onSettled invalidate is what snaps the line back.
  const onReconnect = useCallback(
    (oldEdge: HandoffEdgeType, connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return;
      reconnect.mutate(
        {
          id: oldEdge.id,
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle,
        },
        {
          onError: (e) =>
            toast.error(
              (e as { code?: string })?.code === "23505"
                ? "Those two steps are already connected."
                : "Could not move that connection"
            ),
        }
      );
    },
    [reconnect]
  );

  const onEdgesChange: OnEdgesChange<HandoffEdgeType> = useCallback(
    (changes) => {
      for (const c of changes) {
        if (c.type !== "remove") continue;
        // Start/Goal edges have no row behind them — deleting one would send a
        // synthetic id to process_step_edges. They're deletable:false already;
        // this is the belt to that pair of braces.
        if (c.id.startsWith(SYNTHETIC_PREFIX)) continue;
        // No confirm — a connection is one drag to redraw, unlike a step. But
        // it does get announced: Backspace over a selected edge otherwise
        // removes it with no feedback at all, and you don't notice until the
        // line you were relying on isn't there.
        disconnect.mutate(c.id, {
          onSuccess: () => toast.success("Connection removed"),
          onError: (e) => toast.error(`Could not remove that connection: ${errorMessage(e)}`),
        });
      }
      const selects = changes.filter((c) => c.type === "select" || c.type === "remove");
      if (selects.length === 0) return;
      setSelectedEdgeIds((prev) => {
        const next = new Set(prev);
        for (const c of selects) {
          if (c.type === "select" && c.selected) next.add(c.id);
          else next.delete(c.id);
        }
        return next;
      });
    },
    [disconnect]
  );

  // Backspace/Delete on a selected block asks to delete the step. The change
  // is NOT forwarded to local state: the confirm decides, and dropping the
  // node first would leave a half-deleted canvas if it's cancelled. Keyed on
  // the change's own id rather than `selectedStepId`, which can be pointing at
  // a sub-step (no canvas node of its own) and would name the wrong row.
  const handleNodesChange: OnNodesChange<CanvasNode> = useCallback(
    (changes) => {
      const removed = changes.find((c) => c.type === "remove");
      if (removed) {
        const step = topStepById.get(removed.id);
        if (step) setDeleteTarget(step);
      }
      onNodesChange(changes.filter((c) => c.type !== "remove"));
    },
    [onNodesChange, topStepById]
  );

  const onNodeClick = useCallback((_event: unknown, node: CanvasNode) => {
    // A terminal has no step row to inspect — clicking one shouldn't blank the
    // inspector or point it at an id that doesn't exist.
    if (node.id.startsWith(SYNTHETIC_PREFIX)) return;
    setSelectedStepId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedStepId(null);
  }, []);

  const handleTidyUp = useCallback(() => {
    // Layout + set local state first; mutate calls happen after, not inside
    // the setNodes updater — a side effect inside a state updater runs twice
    // under StrictMode.
    const laidOut = layoutNodes(
      nodes,
      edges.map((e) => ({ source: e.source, target: e.target }))
    );
    setNodes(laidOut);
    // Cancel any drag save still sitting in its debounce window: it holds the
    // pre-tidy position and would fire *after* these writes, leaving the DB
    // disagreeing with what's on screen until the next reload.
    for (const [id, p] of dragTimers.current) {
      clearTimeout(p.timer);
      clearPending(id);
    }
    dragTimers.current.clear();
    for (const n of laidOut) {
      markPending(n.id);
      void savePos(n.id, n.position.x, n.position.y).then(() => clearPending(n.id));
    }
    // Re-lay-out can make the graph wider (or shift it) than whatever the
    // viewport happened to be showing, so without this the blocks move but
    // the visible window doesn't follow — it looks like the button did
    // nothing when it actually repositioned everything just off-screen.
    // setCenter + a manually computed zoom, NOT fitView/fitBounds: fitView
    // reads each node's *measured* size from @xyflow's internal store, which
    // lags a render or two behind a batch position update (fits a stale,
    // too-small box right after Tidy up); fitBounds resolves its promise
    // `true` but — verified empirically, this @xyflow version — never
    // actually applies the viewport transform when called here. setCenter is
    // the one viewport helper already proven reliable in this file (the
    // Steps-list-row-click focus above uses it), so compute the same
    // {x, y, zoom} ourselves from `laidOut` + the wrapper's measured size.
    if (laidOut.length > 0 && flowWrapperRef.current) {
      const sizes = laidOut.map(sizeOf);
      const left = Math.min(...laidOut.map((n) => n.position.x));
      const top = Math.min(...laidOut.map((n) => n.position.y));
      const right = Math.max(...laidOut.map((n, i) => n.position.x + sizes[i].width));
      const bottom = Math.max(...laidOut.map((n, i) => n.position.y + sizes[i].height));
      const boundsWidth = Math.max(right - left, 1);
      const boundsHeight = Math.max(bottom - top, 1);
      const { width: paneWidth, height: paneHeight } = flowWrapperRef.current.getBoundingClientRect();
      const PADDING_FACTOR = 0.8; // leaves ~20% breathing room around the graph
      const zoom = Math.min(
        1, // never zoom PAST 100% just because a small graph would allow it
        (paneWidth / boundsWidth) * PADDING_FACTOR,
        (paneHeight / boundsHeight) * PADDING_FACTOR
      );
      setCenter((left + right) / 2, (top + bottom) / 2, { zoom, duration: 400 });
    }
  }, [layoutNodes, edges, nodes, setNodes, markPending, clearPending, setCenter]);

  const isUnsaved = pendingIds.size > 0 || connect.isPending || disconnect.isPending || reconnect.isPending;

  return (
    <div className="flex h-[680px] w-full flex-col overflow-hidden">
      {/* Window bar — breadcrumb-ish title, Unsaved indicator, Tidy up,
          Propose. Matches docs/2026-08-05-systems-canvas-visual-spec.html's
          `.winbar`. Rendered unconditionally (ahead of the loading/empty
          states below) so it doesn't flicker in and out. */}
      <div className="flex flex-none items-center gap-2 border-b border-m-outline-variant bg-m-surface-container-high px-3 py-2">
        <span className="min-w-0 truncate text-label-medium font-semibold text-m-on-surface">
          Procedures <span className="text-m-on-surface-variant">›</span> {systemName}
          {revisionBarLabel && (
            <span className="ml-1.5 font-normal text-m-on-surface-variant">— {revisionBarLabel}</span>
          )}
        </span>
        <div className="ml-auto flex flex-none items-center gap-2">
          {isUnsaved && <Badge variant="warning">Unsaved</Badge>}
          {!readOnly && (
            <>
              {/* The diamond is title-driven — a step ending in "?" renders as
                  one (isDecisionTitle). That's cheap but invisible, so this
                  button is the discoverable way in: it seeds the "?" for you. */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void onCreateStep({ title: "Decision?" })}
                className="gap-1.5"
                title="A block that splits the flow — rename it to the question being asked. Its branches can loop back."
              >
                <Diamond className="h-3.5 w-3.5" /> Add decision
              </Button>
              <Button size="sm" variant="outline" onClick={handleTidyUp} className="gap-1.5">
                <LayoutGrid className="h-3.5 w-3.5" /> Tidy up
              </Button>
              <Button size="sm" onClick={onPropose}>
                Propose
              </Button>
            </>
          )}
        </div>
      </div>

      {stepsLoading || subStepsLoading || edgesLoading ? (
        <div className="flex flex-1 items-center justify-center text-body-medium text-m-on-surface-variant">
          Loading canvas…
        </div>
      ) : topSteps.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 border-t border-dashed border-m-outline-variant text-center text-body-medium text-m-on-surface-variant">
          No steps yet — add steps to this system to see them on the canvas.
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1">
            <div ref={flowWrapperRef} className="min-w-0 flex-1 bg-m-surface-container-low">
              <ReactFlow
                nodes={allNodes}
                edges={allEdges}
                onNodesChange={handleNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onConnectEnd={onConnectEnd}
                onReconnect={onReconnect}
                onNodeDragStop={onNodeDragStop}
                onNodeClick={onNodeClick}
                onPaneClick={onPaneClick}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                nodesDraggable={!readOnly}
                nodesConnectable={!readOnly}
                edgesReconnectable={!readOnly}
                fitView
                proOptions={{ hideAttribution: true }}
                // Default @xyflow behaviour maps trackpad two-finger scroll to
                // zoom, not pan — a long step chain then has no way to reach
                // via trackpad except pinch-zooming out. panOnScroll switches
                // scroll to free-direction panning (so a horizontal swipe
                // reaches steps off to the side); zoomOnPinch keeps pinch-to-
                // zoom working, and the Controls zoom buttons still work too.
                panOnScroll
                panOnScrollMode={PanOnScrollMode.Free}
                zoomOnScroll={false}
                zoomOnPinch
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={16}
                  size={1}
                  color="hsl(var(--mcolor-outline-variant))"
                />
                <Controls />
              </ReactFlow>
            </div>
            <BlockInspector
              step={selectedStep}
              systemId={systemId}
              isProcess={isProcess}
              depts={depts}
              team={team}
              incomingLabel={incomingLabel}
              revisionLabel={revisionInspectorLabel}
              onDelete={readOnly ? undefined : () => selectedStep && setDeleteTarget(selectedStep)}
              readOnly={readOnly}
            />
          </div>
          <DeptRollup items={rollup.items} unassignedCount={rollup.unassignedCount} totalHours={rollup.totalHours} />
        </>
      )}

      <DeleteStepDialog
        step={deleteTarget}
        subStepCount={deleteTarget ? (subStepsByParent.get(deleteTarget.id) ?? []).length : 0}
        edgeCount={
          deleteTarget
            ? edges.filter((e) => e.source === deleteTarget.id || e.target === deleteTarget.id).length
            : 0
        }
        onClose={() => setDeleteTarget(null)}
        onDeleted={(stepId) => {
          setSelectedStepId((cur) => (cur === stepId ? null : cur));
          setNodes((cur) => cur.filter((n) => n.id !== stepId));
        }}
      />
    </div>
  );
}
