import { useRef, useState } from "react";
import { Link2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  pointsFromHours,
  type PlacementTask,
} from "@/types/placement-tasks";
import type { LineTaskPatch } from "@/hooks/usePlacementTasks";

/** Trim a number for display (13 → "13", 1.5 → "1.5"). */
export const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Inline-editable number cell (hours / points). Formatted when idle, raw +
 * selected on focus so a keystroke replaces it; commits on blur / Enter.
 */
function NumField({
  value,
  onCommit,
  ariaLabel,
}: {
  value: number;
  onCommit: (n: number) => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={editing ? draft : fmt(value)}
      onFocus={() => {
        setDraft(fmt(value));
        requestAnimationFrame(() => ref.current?.select());
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const text = draft ?? "";
        setDraft(null);
        const n = parseFloat(text.replace(",", "."));
        if (Number.isFinite(n) && n >= 0) onCommit(Math.round(n * 100) / 100);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      className="w-14 rounded border border-transparent bg-transparent px-1 py-1 text-right text-body-small tabular-nums hover:border-m-outline-variant focus:border-m-primary focus:bg-m-surface focus:outline-none"
    />
  );
}

/** Editable task title — commits on blur. */
function TitleField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      value={draft ?? value}
      placeholder="Task name…"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onCommit(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="h-8"
    />
  );
}

function TaskRow({
  task,
  departments,
  onPatch,
  onDelete,
}: {
  task: PlacementTask;
  departments: { id: string; name: string }[];
  onPatch: (patch: LineTaskPatch) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <TitleField value={task.title} onCommit={(title) => onPatch({ title })} />
      </div>

      <Select
        value={task.department_id ?? undefined}
        onValueChange={(v) => onPatch({ department_id: v })}
      >
        <SelectTrigger className="h-8 w-40 shrink-0" aria-label="Department">
          <SelectValue placeholder="Department" />
        </SelectTrigger>
        <SelectContent>
          {departments.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              {d.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex shrink-0 items-center gap-1">
        <NumField
          value={task.hours}
          ariaLabel={`Hours for ${task.title || "task"}`}
          onCommit={(hours) =>
            onPatch({
              hours,
              // Re-seed points from hours unless the ops manager decoupled them.
              ...(task.points_overridden ? {} : { points: pointsFromHours(hours) }),
            })
          }
        />
        <span className="text-label-small text-m-on-surface-variant">h</span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <NumField
          value={task.points}
          ariaLabel={`Points for ${task.title || "task"}`}
          onCommit={(points) => onPatch({ points, points_overridden: true })}
        />
        <span className="text-label-small text-m-on-surface-variant">pt</span>
        {task.points_overridden && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Re-link points to hours (1pt = 15min)"
            aria-label="Re-link points to hours"
            onClick={() =>
              onPatch({ points: pointsFromHours(task.hours), points_overridden: false })
            }
          >
            <Link2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-m-on-surface-variant hover:text-destructive"
        aria-label={`Delete ${task.title || "task"}`}
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

/**
 * The team-facing task breakdown for a single quote line: the tasks (each with
 * a department, hours and sprint points) that will be scheduled in ClickUp.
 * Rendered inside a billable receipt line's expandable drop-down.
 */
export function PlacementTaskEditor({
  tasks,
  departments,
  onAdd,
  onPatch,
  onDelete,
}: {
  tasks: PlacementTask[];
  departments: { id: string; name: string }[];
  onAdd: () => void;
  onPatch: (taskId: string, patch: LineTaskPatch) => void;
  onDelete: (taskId: string) => void;
}) {
  const totalHours = tasks.reduce((s, t) => s + t.hours, 0);
  const totalPoints = tasks.reduce((s, t) => s + t.points, 0);

  return (
    <div className="rounded-lg border border-m-outline-variant bg-m-surface-container/30">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-label-small font-medium text-m-on-surface-variant">
          Team tasks · scheduled in ClickUp
        </span>
        <span className="text-label-small tabular-nums text-m-on-surface-variant">
          {fmt(totalHours)}h · {fmt(totalPoints)}pt
        </span>
      </div>

      {tasks.length > 0 && (
        <div className="divide-y divide-m-outline-variant/60 border-t border-m-outline-variant/60">
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              departments={departments}
              onPatch={(patch) => onPatch(t.id, patch)}
              onDelete={() => onDelete(t.id)}
            />
          ))}
        </div>
      )}

      <div className="border-t border-m-outline-variant/60 px-3 py-1.5">
        <Button variant="ghost" size="sm" className="gap-1" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          Add task
        </Button>
      </div>
    </div>
  );
}
