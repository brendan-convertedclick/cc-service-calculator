// src/components/pipeline/TaskCard.tsx
//
// One task on the planner (/pipeline/:yearId). Draggable AND pickable — the
// same element wires HTML5 drag-and-drop and the click-to-pick fallback into
// the one useTaskMove instance the page owns, so a screen-reader user who
// tabs to a card and presses Enter is doing exactly what a mouse user's drag
// does, not a parallel, easier-to-forget path.

import { GripVertical, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatHours } from "@/lib/utils";
import { todayISO } from "@/lib/dates";
import { initials } from "@/components/systems/SystemBlockNode";
import type { SchoolYearTask } from "@/hooks/useSchoolYear";
import type { TaskMoveApi } from "@/components/pipeline/useTaskMove";

export function TaskCard({
  task,
  move,
  colorById,
  locked = false,
}: {
  task: SchoolYearTask;
  move: TaskMoveApi;
  /** Assignee avatar colour — shared team palette (memberColors), owned by the caller. */
  colorById?: Map<string, string>;
  /** This task's own month is closed, or the task is done — no drag, no pick-up. */
  locked?: boolean;
}) {
  const picked = move.isPicked(task.id);
  const moved = task.month_no !== task.home_month_no;

  function handleDragStart(e: React.DragEvent) {
    if (locked) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task.id); // Firefox refuses to drag without data set
    // pickUp is pure (never toggles) — a drag started on an already-picked
    // card (click-picked, then dragged) must keep it picked, not cancel it.
    if (!picked) move.pickUp(task.id);
  }

  function handleDragEnd() {
    // A successful drop already cleared pickedId via commit(); this only
    // fires cancel() when the drag ended some other way (dropped nowhere,
    // dropped on an illegal column, Esc mid-drag).
    if (move.isPicked(task.id)) move.cancel();
  }

  return (
    <div
      draggable={!locked}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={() => {
        if (locked) return;
        // Mouse click toggles: a second click on the same card backs out
        // without reaching for Escape.
        if (picked) move.cancel();
        else move.pickUp(task.id);
      }}
      onKeyDown={(e) => {
        if (locked) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        // Already picked: let this bubble to useTaskMove's window listener,
        // which commits to the keyboard ring — the announcement's own
        // promise ("Enter to move it"). Only the first Enter (picking up)
        // is handled here.
        if (picked) return;
        e.preventDefault();
        move.pickUp(task.id);
      }}
      role="button"
      tabIndex={locked ? -1 : 0}
      aria-pressed={picked}
      aria-disabled={locked}
      aria-label={`${task.label}${moved ? `, moved from month ${task.home_month_no}` : ""}${locked ? ", locked" : ""}`}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-2.5 text-left transition-colors motion-reduce:transition-none",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        locked
          ? "cursor-not-allowed border-m-outline-variant bg-m-surface-container opacity-60"
          : picked
            ? "cursor-grab border-transparent bg-m-primary-container ring-2 ring-m-primary"
            : "cursor-grab border-m-outline-variant bg-m-surface hover:shadow-elev-1",
      )}
    >
      <div className="flex items-start gap-1.5">
        {!locked ? <GripVertical className="mt-0.5 h-3.5 w-3.5 flex-none text-m-on-surface-variant/60" aria-hidden /> : null}
        <p className="min-w-0 flex-1 text-label-large leading-snug text-m-on-surface">{task.label}</p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={task.side === "school" ? "warning" : "muted"}>{task.side === "school" ? "Theirs" : "Ours"}</Badge>
        {task.state === "planned" ? <Badge variant="outline">Planned</Badge> : null}
        {task.state === "scheduled" && task.due_date ? (
          <span
            className={cn(
              "text-label-small tabular-nums",
              task.due_date < todayISO() ? "text-m-error" : "text-m-on-surface-variant",
            )}
          >
            Due {task.due_date}
          </span>
        ) : null}
        {task.state === "done" ? <Badge variant="success">Done</Badge> : null}
        {moved ? (
          <Badge variant="outline" title={task.movedByName ? `Moved by ${task.movedByName}` : undefined}>
            from M{task.home_month_no}
          </Badge>
        ) : null}
        {task.est_hours != null ? (
          <span className="ml-auto font-mono text-label-small tabular-nums text-m-on-surface-variant">
            {formatHours(task.est_hours)}
          </span>
        ) : null}
      </div>

      {task.departmentName || task.assigneeName ? (
        <div className="flex items-center gap-1.5 text-label-small text-m-on-surface-variant">
          {task.assigneeName ? (
            <span
              title={task.assigneeName}
              className="grid h-5 w-5 flex-none place-items-center rounded-full text-[10px] font-bold leading-none text-white"
              style={{ background: colorById?.get(task.assignee_id ?? "") ?? "var(--mcolor-secondary)" }}
            >
              {initials(task.assigneeName)}
            </span>
          ) : (
            <User className="h-3 w-3 flex-none" aria-hidden />
          )}
          <span className="truncate">{task.departmentName ?? "No department"}</span>
        </div>
      ) : null}
    </div>
  );
}
