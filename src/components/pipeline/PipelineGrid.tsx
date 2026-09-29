// src/components/pipeline/PipelineGrid.tsx
//
// The planner laid out like Year results (/results/:clientId): groups and
// rows down the side, the school year's twelve months across. A task's place
// is part of the plan (0184's plan_group/plan_row, from the template), not a
// side effect of Year results; see buildGroups for the order of precedence.
//
// Moving is still by month only. Every cell of a month column is a drop
// target for that month; the row a task sits in is its results link, changed
// from the card's chart icon, never by dragging. Legality (closed month, done
// task) is useTaskMove's moveLegality as affordance; tg_school_tasks_guard is
// the actual gate.

import { Fragment, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronRight, ChevronsUpDown, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CountPill, ExpandToggle } from "@/components/results/GridControls";
import { useGridExpansion } from "@/hooks/useGridExpansion";
import { cn, errorMessage, formatHours } from "@/lib/utils";
import { useServices } from "@/hooks/useServices";
import { useAddServiceToMonth, type SchoolYearMonth, type SchoolYearTask } from "@/hooks/useSchoolYear";
import { useGroupStyles, type GroupStyle, type ResultsPickerGroup, type TaskLink } from "@/hooks/useResults";
import { GROUP_COLOUR_CLASSES, type GroupColourClasses } from "@/components/results/groupColours";
import { GROUP_COLOURS, type GroupColour } from "@/lib/results-grid";
import { GroupStylePicker } from "@/components/results/GroupStylePicker";
import { TaskCard } from "@/components/pipeline/TaskCard";
import type { TaskMoveApi } from "@/components/pipeline/useTaskMove";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const UNPLACED = "unplaced";

interface GridRow {
  id: string;
  name: string;
  tasks: SchoolYearTask[];
}

interface GridGroup {
  id: string;
  name: string;
  /** Null only for "Not placed yet", which gets the neutral surface. */
  tint: GroupColourClasses | null;
  colour: GroupColour | null;
  icon: string | null;
  /** The results group behind it, where its style is saved; null for a planner-only group. */
  resultsGroupId: string | null;
  rows: GridRow[];
}

const GENERAL = "General";

/**
 * Where each task sits, in this order:
 *  1. its Year results link (0180), the explicit "this feeds that number";
 *  2. its planned group and row (0184), matched to the client's results
 *     groups by name so a shared group takes its colour and its row order;
 *  3. nowhere yet: one neutral "Not placed yet" group, a row per department
 *     and one for the school, so an ad hoc service added to a month still
 *     shows up.
 * Results groups come first in their own order, planned-only groups after
 * (Running the account), then the unplaced.
 */
function buildGroups(
  tasks: SchoolYearTask[],
  groups: ResultsPickerGroup[],
  links: Map<string, TaskLink>,
  styles: Map<string, GroupStyle>,
): GridGroup[] {
  const out: GridGroup[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    tint: GROUP_COLOUR_CLASSES[g.colour],
    colour: g.colour,
    icon: g.icon,
    resultsGroupId: g.id,
    rows: g.rows.map((r) => ({ id: r.id, name: r.name, tasks: [] })),
  }));
  const rowById = new Map(out.flatMap((g) => g.rows.map((r) => [r.id, r] as const)));

  function groupNamed(name: string): GridGroup {
    const found = out.find((g) => g.name.toLowerCase() === name.toLowerCase());
    if (found) return found;
    const made: GridGroup = { id: `plan:${name}`, name, tint: null, colour: null, icon: null, resultsGroupId: null, rows: [] };
    out.push(made);
    return made;
  }

  function rowNamed(group: GridGroup, name: string): GridRow {
    const found = group.rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (found) return found;
    const made: GridRow = { id: `${group.id}:${name}`, name, tasks: [] };
    // Work that belongs to the whole group reads first, above its channels.
    if (name === GENERAL) group.rows.unshift(made);
    else group.rows.push(made);
    return made;
  }

  const unplaced: SchoolYearTask[] = [];
  for (const t of tasks) {
    const linked = rowById.get(links.get(t.id)?.rowId ?? "");
    if (linked) linked.tasks.push(t);
    else if (t.plan_group) rowNamed(groupNamed(t.plan_group), t.plan_row ?? GENERAL).tasks.push(t);
    else unplaced.push(t);
  }

  // Planned-only groups (no Year results counterpart) follow the results
  // groups alphabetically, so their order does not depend on which task
  // happened to come first.
  const resultsCount = groups.length;
  const planned = out.splice(resultsCount).sort((a, b) => a.name.localeCompare(b.name));
  // A planned-only group wears the style chosen for it (0192), or else a
  // colour no results group is using.
  const used = new Set<GroupColour>(groups.map((g) => g.colour));
  for (const g of planned) {
    const chosen = styles.get(g.name)?.colour;
    if (chosen) used.add(chosen);
  }
  const spare = GROUP_COLOURS.filter((c) => !used.has(c));
  let next = 0;
  for (const g of planned) {
    const style = styles.get(g.name);
    g.colour = style?.colour ?? spare[next++] ?? "violet";
    g.icon = style?.icon ?? null;
    g.tint = GROUP_COLOUR_CLASSES[g.colour];
  }
  out.push(...planned);

  if (unplaced.length) {
    const byDept = new Map<string, SchoolYearTask[]>();
    for (const t of unplaced) {
      const key = t.side === "school" ? "The school" : (t.departmentName ?? "No department");
      byDept.set(key, [...(byDept.get(key) ?? []), t]);
    }
    const names = [...byDept.keys()].sort((a, b) => {
      // The school's row goes last, under our own departments.
      if (a === "The school") return 1;
      if (b === "The school") return -1;
      return a.localeCompare(b);
    });
    out.push({
      id: UNPLACED,
      name: "Not placed yet",
      tint: null,
      colour: null,
      icon: null,
      resultsGroupId: null,
      rows: names.map((n) => ({ id: `${UNPLACED}:${n}`, name: n, tasks: byDept.get(n)! })),
    });
  }
  return out;
}

export function PipelineGrid({
  clientId,
  yearId,
  months,
  tasks,
  hours,
  currentMonthNo,
  resultsGroups,
  taskLinks,
  move,
}: {
  clientId: string;
  yearId: string;
  months: SchoolYearMonth[];
  tasks: SchoolYearTask[];
  hours: Map<number, number>;
  currentMonthNo: number | null;
  resultsGroups: ResultsPickerGroup[];
  taskLinks: Map<string, TaskLink>;
  move: TaskMoveApi;
}) {
  const x = useGridExpansion();
  const { data: groupStyles } = useGroupStyles(clientId);
  const sortedMonths = [...months].sort((a, b) => a.month_no - b.month_no);
  const groups = buildGroups(
    [...tasks].sort((a, b) => a.ordinal - b.ordinal),
    resultsGroups,
    taskLinks,
    groupStyles ?? new Map(),
  );
  const placements = groups
    .filter((g) => g.id !== UNPLACED)
    .map((g) => ({ group: g.name, rows: g.rows.map((r) => r.name) }));

  function dropProps(monthNo: number) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!move.pickedId) return;
        e.preventDefault(); // required to allow a drop at all
        e.dataTransfer.dropEffect = move.legalFor(monthNo).ok ? "move" : "none";
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        if (move.pickedId) move.commit(monthNo);
      },
    };
  }

  // The column you are dragging over wins; otherwise the current month is
  // shaded grey all the way down so "where we are" reads at a glance.
  const columnTint = (monthNo: number) =>
    move.ringMonth === monthNo ? "bg-m-primary-container/30" : monthNo === currentMonthNo ? "bg-m-surface-container" : "";

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-m-outline-variant bg-m-surface">
        <table className="w-max min-w-full table-fixed border-separate border-spacing-0">
          <colgroup>
            <col className="w-[240px]" />
            {sortedMonths.map((m) => (
              <col key={m.month_no} className="w-[240px]" />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 border-b border-m-outline-variant bg-m-surface p-2.5 text-left align-bottom">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-label-small uppercase tracking-wide text-m-on-surface-variant">Group</span>
                  <ExpandToggle
                    open={x.anyGroupOpen(groups.map((g) => g.id))}
                    what="every group"
                    onToggle={() => x.toggleAllGroups(groups.map((g) => g.id))}
                  />
                </div>
              </th>
              {sortedMonths.map((m) => (
                <MonthHeader
                  key={m.month_no}
                  month={m}
                  yearId={yearId}
                  hours={hours.get(m.month_no) ?? 0}
                  isCurrent={m.month_no === currentMonthNo}
                  move={move}
                  className={columnTint(m.month_no)}
                  {...dropProps(m.month_no)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const open = x.isGroupOpen(group.id);
              const rowIds = group.rows.filter((r) => r.tasks.length > 0).map((r) => r.id);
              const taskCount = group.rows.reduce((n, r) => n + r.tasks.length, 0);
              return (
                <Fragment key={group.id}>
                  <tr>
                    <th
                      scope="row"
                      className="sticky left-0 z-20 border-b border-m-outline-variant bg-m-surface-container-low p-0 text-left"
                    >
                      <div className="flex items-start">
                        <button
                          type="button"
                          aria-label={open ? `Close ${group.name}` : `Open ${group.name}`}
                          onClick={() => x.toggleGroup(group.id)}
                          className="grid h-11 w-7 flex-none place-items-center pl-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ChevronRight
                            className={cn(
                              "h-3.5 w-3.5 text-m-on-surface-variant transition-transform motion-reduce:transition-none",
                              open && "rotate-90",
                            )}
                          />
                        </button>
                        <div className="flex-none py-2">
                          <GroupStylePicker
                            clientId={clientId}
                            resultsGroupId={group.resultsGroupId}
                            name={group.name}
                            icon={group.icon}
                            colour={group.colour}
                          />
                        </div>
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => x.toggleGroup(group.id)}
                          className="flex min-w-0 flex-1 items-start gap-2 py-2.5 pl-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span>
                            <span className="block text-label-large font-semibold">{group.name}</span>
                            <span className="block text-label-small text-m-on-surface-variant">
                              {group.rows.length} channel{group.rows.length === 1 ? "" : "s"} · {taskCount} task
                              {taskCount === 1 ? "" : "s"}
                            </span>
                          </span>
                        </button>
                        <div className="flex-none py-2 pr-1.5">
                          <ExpandToggle
                            open={x.rowsAllOpen(rowIds)}
                            what={`every channel in ${group.name}`}
                            onToggle={() => x.toggleGroupRows(group.id, rowIds)}
                          />
                        </div>
                      </div>
                    </th>
                    {sortedMonths.map((m) => {
                      const n = group.rows.reduce((sum, r) => sum + r.tasks.filter((t) => t.month_no === m.month_no).length, 0);
                      return (
                        <td
                          key={m.month_no}
                          {...dropProps(m.month_no)}
                          className={cn(
                            "border-b border-m-outline-variant bg-m-surface-container-low p-1.5 text-center align-middle",
                            columnTint(m.month_no),
                          )}
                        >
                          {n ? (
                            <CountPill
                              tint={group.tint}
                              items={group.rows.flatMap((r) =>
                                r.tasks
                                  .filter((t) => t.month_no === m.month_no)
                                  .map((t) => ({ id: t.id, title: t.label, detail: r.name, side: t.side })),
                              )}
                            />
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>

                  {open &&
                    group.rows.map((row) => {
                      const rowOpen = x.isRowOpen(row.id);
                      const empty = row.tasks.length === 0;
                      return (
                        <tr key={row.id}>
                          <th
                            scope="row"
                            className="sticky left-0 z-10 border-b border-m-outline-variant bg-m-surface p-0 text-left align-top font-normal"
                          >
                            <button
                              type="button"
                              aria-expanded={empty ? undefined : rowOpen}
                              disabled={empty}
                              onClick={() => x.toggleRow(row.id)}
                              className="group/row flex w-full items-start gap-1.5 rounded-sm py-2.5 pl-5 pr-2.5 text-left transition-colors motion-reduce:transition-none enabled:hover:bg-m-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                            >
                              <ChevronRight
                                className={cn(
                                  "mt-1 h-3 w-3 shrink-0 text-m-on-surface-variant transition-transform motion-reduce:transition-none",
                                  rowOpen && !empty && "rotate-90",
                                  empty && "invisible",
                                )}
                              />
                              <span>
                                <span className="block text-body-medium">{row.name}</span>
                                <span className="block text-label-small text-m-on-surface-variant">
                                  {empty ? "No pipeline tasks" : `${row.tasks.length} task${row.tasks.length === 1 ? "" : "s"}`}
                                </span>
                              </span>
                            </button>
                          </th>
                          {sortedMonths.map((m) => {
                            const here = row.tasks.filter((t) => t.month_no === m.month_no);
                            const closed = m.closed_at !== null;
                            return (
                              <td
                                key={m.month_no}
                                {...dropProps(m.month_no)}
                                className={cn(
                                  "border-b border-m-outline-variant p-1.5",
                                  rowOpen ? "align-top" : "text-center align-middle",
                                  columnTint(m.month_no),
                                )}
                              >
                                {!rowOpen ? (
                                  here.length ? (
                                    <CountPill
                                      tint={group.tint}
                                      items={here.map((t) => ({ id: t.id, title: t.label, side: t.side }))}
                                    />
                                  ) : null
                                ) : here.length ? (
                                  <div className="flex flex-col gap-1.5">
                                    {here.map((t) => (
                                      <TaskCard
                                        key={t.id}
                                        task={t}
                                        months={months}
                                        move={move}
                                        locked={closed || t.state === "done"}
                                        clientId={clientId}
                                        yearId={yearId}
                                        resultsLink={taskLinks.get(t.id)}
                                        tint={group.tint}
                                        placements={placements}
                                      />
                                    ))}
                                  </div>
                                ) : null}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}

function MonthHeader({
  month,
  yearId,
  hours,
  isCurrent,
  move,
  className,
  onDragOver,
  onDrop,
}: {
  month: SchoolYearMonth;
  yearId: string;
  hours: number;
  isCurrent: boolean;
  move: TaskMoveApi;
  className?: string;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const closed = month.closed_at !== null;
  const verdict = move.pickedId ? move.legalFor(month.month_no) : null;
  const calendarMonth = MONTH_NAMES[Number(month.starts_on.slice(5, 7)) - 1];

  return (
    <th
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "sticky top-0 z-10 border-b border-m-outline-variant bg-m-surface p-2.5 text-left align-top font-normal",
        className,
        isCurrent && !move.pickedId && "bg-m-surface-container-high",
      )}
    >
      <div className="flex flex-col gap-1.5">
        {/* The year strip, one segment per column so it can never drift from
            the months under it: closed months m-secondary, the current one
            m-primary, the rest neutral, and a dot on an open day month. */}
        <div className="flex items-center gap-1.5" title={month.role === "open_day" ? "Open day month" : undefined}>
          <span
            className={cn(
              "h-1.5 flex-1 rounded-full",
              isCurrent ? "bg-gradient-brand" : closed ? "bg-m-secondary" : "bg-m-surface-container-high",
            )}
          />
          {month.role === "open_day" ? <span className="h-1.5 w-1.5 flex-none rounded-full bg-m-tertiary" aria-label="Open day month" /> : null}
        </div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-label-small uppercase tracking-wide text-m-on-surface-variant">
              {calendarMonth} · M{month.month_no}
              {isCurrent ? <span className="sr-only"> (this month)</span> : null}
            </p>
            {/* The current month says so with the brand gradient on its title,
                not a badge: the column's grey already marks where it is. */}
            <p
              className={cn(
                "truncate text-title-small",
                isCurrent ? "bg-gradient-brand bg-clip-text font-semibold text-transparent" : "text-m-on-surface",
              )}
              title={month.theme}
            >
              {month.theme}
            </p>
          </div>
          <div className="flex flex-none items-center gap-1">
            {closed ? <Lock className="h-3.5 w-3.5 text-m-on-surface-variant" aria-label="Closed" /> : null}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-label-small tabular-nums text-m-on-surface-variant">{formatHours(hours)}</span>
          <AddServicePopover yearId={yearId} monthNo={month.month_no} disabled={closed} />
        </div>
        {verdict ? (
          <button
            type="button"
            onClick={() => move.commit(month.month_no)}
            disabled={!verdict.ok}
            title={verdict.ok ? "Move here" : verdict.reason}
            className={cn(
              "rounded-md border border-dashed px-2 py-1.5 text-label-small transition-colors motion-reduce:transition-none",
              verdict.ok
                ? "border-m-primary bg-m-primary-container text-m-on-primary-container hover:opacity-90"
                : "cursor-not-allowed border-m-outline-variant text-m-on-surface-variant opacity-60",
            )}
          >
            {verdict.ok ? "Move here" : verdict.reason}
          </button>
        ) : null}
      </div>
    </th>
  );
}

function AddServicePopover({ yearId, monthNo, disabled }: { yearId: string; monthNo: number; disabled: boolean }) {
  const { data: services } = useServices();
  const addService = useAddServiceToMonth();
  const [open, setOpen] = useState(false);

  async function pick(serviceId: string) {
    setOpen(false);
    try {
      await addService.mutateAsync({ yearId, monthNo, serviceId });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || addService.isPending}
          className="h-6 gap-1 px-1.5 text-label-small font-normal text-m-on-surface-variant"
        >
          <Plus className="h-3.5 w-3.5" /> Add a service
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="end">
        <Command>
          <CommandInput placeholder="Search services…" />
          <CommandList>
            <CommandEmpty>No services found.</CommandEmpty>
            <CommandGroup>
              {(services ?? []).map((s) => (
                <CommandItem key={s.id} value={s.name} onSelect={() => void pick(s.id)}>
                  <Check className="mr-2 h-4 w-4 opacity-0" />
                  {s.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
