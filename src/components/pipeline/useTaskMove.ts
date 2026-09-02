// src/components/pipeline/useTaskMove.ts
//
// The single state machine behind BOTH input paths on the planner
// (/pipeline/:yearId): HTML5 drag-and-drop and click-to-pick-then-click-a-
// column. One instance lives on the planner page and is threaded down to
// every TaskCard and PlannerColumn, so there is exactly one "what is
// currently picked up" and exactly one aria-live announcer — two instances
// would mean a dragged card and a clicked card could disagree about what is
// in the air.
//
// moveLegality (pipeline-move.ts) is the affordance check, mirroring
// tg_school_tasks_guard; it is never the last word — the mutation this hook
// calls can still come back refused, and the caller's onError path handles
// that. See 0150_school_pipeline.sql "Delta B" for why the real gate lives
// in the DB and not here.

import { useCallback, useEffect, useMemo, useState } from "react";
import { moveLegality, type MonthLike, type MoveVerdict } from "@/lib/pipeline-move";

export interface MovableTask {
  id: string;
  label: string;
  month_no: number;
  state: "planned" | "scheduled" | "done";
}

export interface TaskMoveApi {
  /** The task currently picked up (by click or by drag) — null when nothing is in the air. */
  pickedId: string | null;
  isPicked: (taskId: string) => boolean;
  /**
   * Pick a task up. Pure — always sets `pickedId` to this one, never toggles.
   * The toggle-to-cancel-on-a-second-click behaviour belongs to the caller
   * (TaskCard's onClick), because pickUp is also what drag-start calls, and a
   * drag on an already-picked card must keep it picked, not cancel it.
   */
  pickUp: (taskId: string) => void;
  /** Esc, a failed drop, or clicking the same task again. */
  cancel: () => void;
  /** Click a column, or drop on one — both end here. Refuses (and announces why) if illegal. */
  commit: (toMonth: number) => void;
  /** What a given month would mean for the picked task right now — column styling reads this. */
  legalFor: (toMonth: number) => MoveVerdict;
  /**
   * The keyboard's placement ring: while something is picked, arrow keys move
   * this across the legal months (Enter commits, Esc cancels) — the fallback
   * for a user who can pick a task up with the keyboard but has no pointer to
   * click a column with.
   */
  ringMonth: number | null;
  /** One polite region's text — screen readers get every pick, refusal and move. */
  announcement: string;
}

export function useTaskMove({
  tasks,
  months,
  onMove,
}: {
  tasks: MovableTask[];
  months: MonthLike[];
  onMove: (taskId: string, toMonth: number) => void;
}): TaskMoveApi {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [ringIndex, setRingIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");

  const pickedTask = useMemo(() => tasks.find((t) => t.id === pickedId) ?? null, [tasks, pickedId]);

  const legalFor = useCallback(
    (toMonth: number): MoveVerdict => {
      if (!pickedTask) return { ok: false, reason: "Nothing is picked up." };
      return moveLegality(pickedTask, toMonth, months);
    },
    [pickedTask, months],
  );

  const legalMonths = useMemo(() => {
    if (!pickedTask) return [];
    return Array.from({ length: 12 }, (_, i) => i + 1).filter((n) => legalFor(n).ok);
  }, [pickedTask, legalFor]);

  const ringMonth = pickedId ? (legalMonths[ringIndex % Math.max(legalMonths.length, 1)] ?? null) : null;

  const pickUp = useCallback(
    (taskId: string) => {
      const t = tasks.find((x) => x.id === taskId);
      setPickedId(taskId);
      setRingIndex(0);
      setAnnouncement(
        t
          ? `Picked up "${t.label}". Use arrow keys to choose a month, Enter to move it, Escape to cancel.`
          : "Picked up.",
      );
    },
    [tasks],
  );

  const cancel = useCallback(() => {
    if (!pickedId) return;
    setPickedId(null);
    setAnnouncement("Move cancelled.");
  }, [pickedId]);

  const commit = useCallback(
    (toMonth: number) => {
      if (!pickedId) return;
      const verdict = legalFor(toMonth);
      if (!verdict.ok) {
        setAnnouncement(verdict.reason);
        return;
      }
      onMove(pickedId, toMonth);
      setAnnouncement(`Moved to month ${toMonth}.`);
      setPickedId(null);
    },
    [pickedId, legalFor, onMove],
  );

  // The arrow-key ring only exists while something is picked, so the
  // listener is scoped to that window rather than living for the page's
  // whole life.
  useEffect(() => {
    if (!pickedId) return;
    function onKey(e: KeyboardEvent) {
      // Never steal a keystroke another handler already claimed (a "Move
      // here" button's own Enter, TaskCard's own Enter on the picked card),
      // and never steal typing from a real form control — the "+ Add a
      // service" search box sits on the same page while a task can be
      // picked. The picked TaskCard is a div[role=button], not a <button>,
      // so this does not swallow its own Enter/Escape.
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [contenteditable=true]")) return;

      if (e.key === "Escape") {
        cancel();
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setRingIndex((i) => (legalMonths.length ? (i + 1) % legalMonths.length : 0));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setRingIndex((i) => (legalMonths.length ? (i - 1 + legalMonths.length) % legalMonths.length : 0));
      } else if ((e.key === "Enter" || e.key === " ") && ringMonth !== null) {
        e.preventDefault();
        commit(ringMonth);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickedId, legalMonths.length, ringMonth, cancel, commit]);

  return {
    pickedId,
    isPicked: (taskId: string) => taskId === pickedId,
    pickUp,
    cancel,
    commit,
    legalFor,
    ringMonth,
    announcement,
  };
}
