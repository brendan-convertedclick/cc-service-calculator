// src/components/pipeline/TaskCard.tsx
//
// One task on the planner (/pipeline/:yearId). The title is the draggable,
// pickable element — it wires HTML5 drag-and-drop and the click-to-pick
// fallback into the one useTaskMove instance the page owns, so a screen-reader
// user who tabs to a card and presses Enter is doing exactly what a mouse
// user's drag does.
//
// Under the title sits one footer strip, every piece of it hoverable:
// M (ours) or S (the school's), the Year results link, deliverable or task,
// the clock, and the arrow that opens the rest. The footer is a SIBLING of the
// role="button" title, never inside it: a control nested in another element's
// button role is invalid ARIA and unreachable through that button.
//
// The description and everything that used to crowd the card face
// (department, assignee, hours, state, moved-from) live in the dropdown.

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ListChecks, Package, Settings2 } from "lucide-react";
import { cn, errorMessage, formatHours } from "@/lib/utils";
import { todayISO } from "@/lib/dates";
import { clockLabel, taskClock } from "@/lib/task-clock";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSetTaskDeliverable, type SchoolYearMonth, type SchoolYearTask } from "@/hooks/useSchoolYear";
import type { TaskMoveApi } from "@/components/pipeline/useTaskMove";
import { TaskResultsLink } from "@/components/pipeline/TaskResultsLink";
import { TaskEditDialog, type PlacementOption } from "@/components/pipeline/TaskEditDialog";
import type { TaskLink } from "@/hooks/useResults";
import type { GroupColourClasses } from "@/components/results/groupColours";

const iconButton =
  "grid h-6 w-6 place-items-center rounded-md transition-colors motion-reduce:transition-none hover:bg-m-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function stop(e: React.SyntheticEvent) {
  e.stopPropagation();
}

export function TaskCard({
  task,
  months,
  move,
  locked = false,
  clientId,
  yearId,
  resultsLink,
  tint = null,
  placements = [],
}: {
  task: SchoolYearTask;
  /** The year's months — the clock reads their starts_on. */
  months: SchoolYearMonth[];
  move: TaskMoveApi;
  /** This task's own month is closed, or the task is done — no drag, no pick-up. */
  locked?: boolean;
  clientId: string;
  yearId: string;
  resultsLink?: TaskLink;
  /** The colour of the group the card sits in. Null in "Not placed yet", which gets the neutral surface. */
  tint?: GroupColourClasses | null;
  /** Group and row names on the board, suggested in the edit dialog. */
  placements?: PlacementOption[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const setDeliverable = useSetTaskDeliverable();
  const picked = move.isPicked(task.id);
  const moved = task.month_no !== task.home_month_no;
  const ours = task.side === "us";
  const clock = taskClock(task, months, todayISO());

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
    // fires cancel() when the drag ended some other way.
    if (move.isPicked(task.id)) move.cancel();
  }

  function toggleDeliverable() {
    setDeliverable.mutate(
      { yearId, taskId: task.id, isDeliverable: !task.is_deliverable },
      { onError: (e) => toast.error(errorMessage(e)) },
    );
  }

  const whoLabel = ours ? "Ours" : "The school's";
  const kindLabel = task.is_deliverable
    ? "Deliverable: something the school receives. Click to make it a task."
    : "Task: work behind the scenes. Click to make it a deliverable.";

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-lg p-2 transition-colors motion-reduce:transition-none",
        // Ours is a filled card in its group's colour; the school's is an empty
        // card with a dashed edge, so whose move it is reads before the text.
        ours
          ? cn("border border-transparent", tint ? tint.bgSoft : "bg-m-surface-container-high")
          : cn("border-2 border-dashed bg-m-surface", tint ? tint.border : "border-m-outline"),
        picked && "border-transparent bg-m-primary-container ring-2 ring-m-primary",
        locked && "opacity-60",
        !locked && !picked && "hover:shadow-elev-1",
      )}
    >
      <div
        draggable={!locked}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={() => {
          if (locked) return;
          // Mouse click toggles: a second click on the same card backs out.
          if (picked) move.cancel();
          else move.pickUp(task.id);
        }}
        onKeyDown={(e) => {
          if (locked) return;
          if (e.key !== "Enter" && e.key !== " ") return;
          // Already picked: let this bubble to useTaskMove's window listener,
          // which commits to the keyboard ring. Only picking up is handled here.
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
          "rounded text-label-large leading-snug text-m-on-surface",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          locked ? "cursor-not-allowed" : "cursor-grab",
        )}
      >
        {task.label}
      </div>

      <div className="flex items-center gap-0.5" onClick={stop} onKeyDown={stop} draggable={false}>
        <Tip label={whoLabel}>
          <span
            tabIndex={0}
            aria-label={whoLabel}
            className={cn(
              "mr-0.5 grid h-5 w-5 flex-none place-items-center rounded-full text-[10px] font-bold leading-none transition-transform motion-reduce:transition-none hover:scale-110",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              ours
                ? cn(tint ? tint.swatch : "bg-m-primary", "text-white")
                : cn("border border-dashed", tint ? cn(tint.border, tint.text) : "border-m-outline text-m-on-surface-variant"),
            )}
          >
            {ours ? "M" : "S"}
          </span>
        </Tip>

        <TaskResultsLink clientId={clientId} yearId={yearId} taskId={task.id} link={resultsLink} compact />

        <Tip label={kindLabel}>
          <button
            type="button"
            onClick={toggleDeliverable}
            aria-label={kindLabel}
            className={cn(iconButton, task.is_deliverable ? "text-m-on-surface" : "text-m-on-surface-variant")}
          >
            {task.is_deliverable ? <Package className="h-3.5 w-3.5" /> : <ListChecks className="h-3.5 w-3.5" />}
          </button>
        </Tip>

        <span className="flex-1" />

        {clock ? (
          <Tip label={clock.kind === "rot" ? "Past its date and not done" : "Days left before it is due"}>
            <span
              tabIndex={0}
              className={cn(
                "rounded-full px-1.5 py-0.5 text-label-small font-semibold tabular-nums transition-shadow motion-reduce:transition-none hover:shadow-elev-1",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                clock.kind === "rot"
                  ? "bg-m-error-container text-m-on-error-container"
                  : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
              )}
            >
              {clockLabel(clock)}
            </span>
          </Tip>
        ) : null}

        <Tip label={locked ? "This task is locked" : "Edit task"}>
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={locked}
            aria-label="Edit task"
            className={cn(iconButton, "text-m-on-surface-variant disabled:opacity-40 disabled:hover:bg-transparent")}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </Tip>

        <Tip label={open ? "Hide details" : "Show details"}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Hide details" : "Show details"}
            className={cn(iconButton, "text-m-on-surface-variant")}
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
          </button>
        </Tip>
      </div>

      {open ? (
        <div className="flex flex-col gap-1.5 border-t border-m-outline-variant pt-1.5">
          {task.description ? <p className="text-body-small text-m-on-surface">{task.description}</p> : null}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-label-small">
            <dt className="text-m-on-surface-variant">Department</dt>
            <dd className="min-w-0 truncate">{ours ? (task.departmentName ?? "Not set") : "The school"}</dd>
            {ours ? (
              <>
                <dt className="text-m-on-surface-variant">Assignee</dt>
                <dd className="min-w-0 truncate">{task.assigneeName ?? "Unassigned"}</dd>
              </>
            ) : null}
            {task.est_hours != null ? (
              <>
                <dt className="text-m-on-surface-variant">Estimate</dt>
                <dd className="font-mono tabular-nums">{formatHours(task.est_hours)}</dd>
              </>
            ) : null}
            <dt className="text-m-on-surface-variant">State</dt>
            <dd className="capitalize">
              {task.state}
              {task.due_date ? `, due ${task.due_date}` : ""}
            </dd>
            {moved ? (
              <>
                <dt className="text-m-on-surface-variant">Moved</dt>
                <dd className="min-w-0 truncate">
                  From M{task.home_month_no}
                  {task.movedByName ? ` by ${task.movedByName}` : ""}
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}

      <TaskEditDialog task={task} yearId={yearId} placements={placements} open={editing} onOpenChange={setEditing} />
    </div>
  );
}
