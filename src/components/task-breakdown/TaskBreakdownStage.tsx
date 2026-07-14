import { useMemo, useRef, useState } from "react";
import { ChevronDown, Link2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useDepartments } from "@/hooks/useDepartments";
import { useScopeMapPlacements } from "@/hooks/useScopeMap";
import {
  useAddLineTask,
  useDeleteLineTask,
  useLineTasks,
  useUpdateLineTask,
  type LineTaskPatch,
} from "@/hooks/usePlacementTasks";
import { pointsFromHours, type PlacementTask } from "@/types/placement-tasks";
import { placementDisposition, type BriefTaskSowPlacement } from "@/types/sow-placements";

/** Trim a number for display (13 → "13", 1.5 → "1.5"). */
const fmt = (n: number) => String(Math.round(n * 100) / 100);

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
    <div className="flex items-center gap-2 px-4 py-2">
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

function PlacementAccordion({
  placement,
  tasks,
  departments,
  open,
  onToggle,
  onAdd,
  onPatch,
  onDelete,
}: {
  placement: BriefTaskSowPlacement;
  tasks: PlacementTask[];
  departments: { id: string; name: string }[];
  open: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onPatch: (taskId: string, patch: LineTaskPatch) => void;
  onDelete: (taskId: string) => void;
}) {
  const totalHours = tasks.reduce((s, t) => s + t.hours, 0);
  const totalPoints = tasks.reduce((s, t) => s + t.points, 0);
  const missingDept = tasks.some((t) => !t.department_id);

  return (
    <div className="overflow-hidden rounded-lg border border-m-outline-variant bg-m-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-m-surface-container/40"
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-m-on-surface-variant transition-transform",
            open && "rotate-180",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-body-medium text-m-on-surface">
          {placement.item_name ?? placement.task_ref}
        </span>
        <span className="shrink-0 text-label-small text-m-on-surface-variant">
          {tasks.length} task{tasks.length === 1 ? "" : "s"} · {fmt(totalHours)}h ·{" "}
          {fmt(totalPoints)}pt
        </span>
        {(tasks.length === 0 || missingDept) && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-label-small text-amber-800">
            {tasks.length === 0 ? "no tasks" : "needs dept"}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-m-outline-variant">
          {tasks.length > 0 && (
            <div className="divide-y divide-m-outline-variant/60">
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
          <div className="px-4 py-2">
            <Button variant="ghost" size="sm" className="gap-1" onClick={onAdd}>
              <Plus className="h-4 w-4" />
              Add task
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Stage 3 of the brief flow: for each billable quote item, break the work into
 * tasks (each with a department, time allocation and sprint points). Generated
 * by intake (future), reviewed/edited here by the ops manager, and the source
 * for ClickUp scheduling (future).
 */
export function TaskBreakdownStage({ briefId }: { briefId: string }) {
  const placementsQuery = useScopeMapPlacements(briefId);
  const tasksQuery = useLineTasks(briefId);
  const { data: departments } = useDepartments();
  const add = useAddLineTask(briefId);
  const update = useUpdateLineTask(briefId);
  const del = useDeleteLineTask(briefId);

  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});

  const billable = useMemo(
    () =>
      (placementsQuery.data ?? []).filter(
        (p) => placementDisposition(p) === "new_billable",
      ),
    [placementsQuery.data],
  );

  const tasksByPlacement = useMemo(() => {
    const m = new Map<string, PlacementTask[]>();
    for (const t of tasksQuery.data ?? []) {
      const arr = m.get(t.placement_id);
      if (arr) arr.push(t);
      else m.set(t.placement_id, [t]);
    }
    return m;
  }, [tasksQuery.data]);

  const deptOptions = useMemo(
    () => (departments ?? []).map((d) => ({ id: d.id, name: d.name })),
    [departments],
  );

  if (placementsQuery.isLoading || tasksQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    );
  }

  if (billable.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-m-outline-variant px-4 py-6 text-center text-body-small text-m-on-surface-variant">
        No billable quote items yet. Mark items as <strong>New</strong> in Step 1 to
        plan their tasks here.
      </p>
    );
  }

  const grandHours = billable.reduce(
    (s, p) => s + (tasksByPlacement.get(p.id) ?? []).reduce((a, t) => a + t.hours, 0),
    0,
  );
  const grandPoints = billable.reduce(
    (s, p) => s + (tasksByPlacement.get(p.id) ?? []).reduce((a, t) => a + t.points, 0),
    0,
  );

  const handlePatch = (id: string, patch: LineTaskPatch) => update.mutate({ id, patch });
  const handleDelete = (id: string) => del.mutate(id);
  const handleAdd = (placementId: string) => {
    const existing = tasksByPlacement.get(placementId) ?? [];
    add.mutate(
      { placement_id: placementId, title: "", sort_order: existing.length },
      { onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to add task") },
    );
    setOpenIds((prev) => ({ ...prev, [placementId]: true }));
  };

  return (
    <div className="space-y-4">
      <p className="text-body-small text-m-on-surface-variant">
        Break each billable item into tasks. Each task has one department, a time
        allocation and sprint points (1pt = 15min). This is what gets scheduled in
        ClickUp.
      </p>

      <div className="space-y-2">
        {billable.map((p) => (
          <PlacementAccordion
            key={p.id}
            placement={p}
            tasks={tasksByPlacement.get(p.id) ?? []}
            departments={deptOptions}
            open={openIds[p.id] !== false}
            onToggle={() => setOpenIds((prev) => ({ ...prev, [p.id]: prev[p.id] === false }))}
            onAdd={() => handleAdd(p.id)}
            onPatch={handlePatch}
            onDelete={handleDelete}
          />
        ))}
      </div>

      <div className="flex items-center justify-end gap-4 border-t border-m-outline-variant pt-3 text-body-medium">
        <span className="text-m-on-surface-variant">Total</span>
        <span className="font-medium tabular-nums text-m-on-surface">{fmt(grandHours)}h</span>
        <span className="font-medium tabular-nums text-m-on-surface">{fmt(grandPoints)}pt</span>
      </div>
    </div>
  );
}
