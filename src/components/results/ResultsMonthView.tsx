// src/components/results/ResultsMonthView.tsx
//
// Month view of the school year results planner: a Monday-first calendar of
// one month, chips on the day their item lands (see `entryDay`), an "Anytime
// this month" strip for items with no day, and a per-day "+ Plan" box that
// opens an inline form to plant a row on that day.
// See docs/superpowers/specs/2026-09-28-school-year-results-month-view.md.

import { useState } from "react";
import { toast } from "sonner";
import { cn, errorMessage } from "@/lib/utils";
import { monthGrid, WEEKDAY_LABELS } from "@/lib/calendar-month";
import {
  cellState,
  entryDay,
  formatValue,
  hasValue,
  planHeadline,
  starredFields,
  type ResultsTemplate,
} from "@/lib/results-grid";
import type { ResultsBoard, ResultsBoardEntry } from "@/hooks/useResults";
import { usePlanOnDay } from "@/hooks/useResults";
import { GROUP_COLOUR_CLASSES } from "@/components/results/groupColours";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { SelectedCell } from "@/components/results/ResultsGrid";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface ChipData {
  rowId: string;
  rowName: string;
  groupName: string;
  colour: (typeof GROUP_COLOUR_CLASSES)[keyof typeof GROUP_COLOUR_CLASSES];
  template: ResultsTemplate;
  entry: ResultsBoardEntry;
}

export function ResultsMonthView({
  clientId,
  board,
  templatesById,
  year,
  month,
  now,
  selected,
  onSelectCell,
}: {
  clientId: string;
  board: ResultsBoard;
  templatesById: Map<string, ResultsTemplate>;
  year: number;
  month: number;
  now: { year: number; month: number };
  selected: SelectedCell | null;
  onSelectCell: (cell: SelectedCell) => void;
}) {
  const [dayFormOpen, setDayFormOpen] = useState<number | null>(null);
  const planOnDay = usePlanOnDay();

  function templateFor(groupId: string, rowTemplateId: string | null): ResultsTemplate | undefined {
    if (rowTemplateId) return templatesById.get(rowTemplateId);
    const group = board.groups.find((g) => g.id === groupId);
    return group ? templatesById.get(group.templateId) : undefined;
  }

  const byDay = new Map<number, ChipData[]>();
  const anytime: ChipData[] = [];
  for (const group of board.groups) {
    for (const row of group.rows) {
      const template = templateFor(group.id, row.templateId);
      if (!template) continue;
      const entry = board.entries[`${row.id}|${year}|${month}`];
      if (!entry) continue;
      const chip: ChipData = {
        rowId: row.id,
        rowName: row.name,
        groupName: group.name,
        colour: GROUP_COLOUR_CLASSES[group.colour],
        template,
        entry,
      };
      const d = entryDay(template, entry, year, month);
      if (d) {
        const list = byDay.get(d);
        if (list) list.push(chip);
        else byDay.set(d, [chip]);
      } else {
        anytime.push(chip);
      }
    }
  }

  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const weeks = monthGrid(monthKey, []);

  function renderChip(chip: ChipData) {
    const state = cellState(year, month, chip.template, chip.entry.values, now);
    const stars = starredFields(chip.template).filter((f) => hasValue(chip.entry.values[f.id]));
    const line =
      state === "done" && stars.length
        ? stars.map((f) => `${formatValue(f, chip.entry.values[f.id])} ${f.short_label ?? ""}`.trim()).join(" · ")
        : planHeadline(chip.template, chip.entry.values);
    const isSelected = !!selected && selected.rowId === chip.rowId && selected.year === year && selected.month === month;
    return (
      <button
        key={chip.rowId}
        type="button"
        onClick={() => onSelectCell({ rowId: chip.rowId, year, month })}
        className={cn(
          "block w-full max-w-[240px] rounded-md border p-1.5 text-left text-label-small leading-snug",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isSelected && "ring-2 ring-primary",
          state === "plan" && cn("border-dashed", chip.colour.border, "text-m-on-surface-variant"),
          state === "due" && "border-dashed border-amber-500 bg-amber-50 text-m-on-surface dark:border-amber-400 dark:bg-amber-950/40",
          state === "done" && cn(chip.colour.bgSoft, chip.colour.border),
          state === "empty" && "border-m-outline-variant",
        )}
      >
        <span className="sr-only">
          {chip.groupName} · {chip.rowName} ·{" "}
          {state === "done" ? "results in" : state === "due" ? "results due" : "planned"}
        </span>
        <span className={cn("block truncate font-semibold", chip.colour.text)}>{chip.rowName}</span>
        {line && <span className="block truncate text-m-on-surface-variant">{line}</span>}
      </button>
    );
  }

  function submitPlan(day: number, rowId: string) {
    let picked: ChipData | undefined;
    for (const group of board.groups) {
      const row = group.rows.find((r) => r.id === rowId);
      if (row) {
        const template = templateFor(group.id, row.templateId);
        if (template) {
          picked = {
            rowId,
            rowName: row.name,
            groupName: group.name,
            colour: GROUP_COLOUR_CLASSES[group.colour],
            template,
            entry: board.entries[`${rowId}|${year}|${month}`] ?? { entryId: "", values: {}, updatedBy: null, day: null },
          };
        }
        break;
      }
    }
    if (!picked) return;
    planOnDay.mutate(
      { clientId, rowId, year, month, day, template: picked.template, existingValues: picked.entry.values },
      {
        onSuccess: () => {
          setDayFormOpen(null);
          onSelectCell({ rowId, year, month });
        },
        onError: (e) => toast.error(`Could not plan: ${errorMessage(e)}`),
      },
    );
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 rounded-xl border border-m-outline-variant bg-m-surface p-3">
        <span className="text-label-medium uppercase tracking-wide text-m-on-surface-variant">Anytime this month</span>
        {anytime.length ? (
          <div className="flex flex-wrap gap-2">{anytime.map(renderChip)}</div>
        ) : (
          <span className="text-body-medium text-m-on-surface-variant">Everything this month has a date.</span>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-m-outline-variant bg-m-surface">
        <div className="grid grid-cols-7 border-b border-m-outline-variant bg-m-surface-container-low">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="p-2 text-center text-label-small uppercase tracking-wide text-m-on-surface-variant">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {weeks.flat().map((day) => {
            const chips = day.inMonth ? (byDay.get(day.dayOfMonth) ?? []) : [];
            const showForm = day.inMonth && dayFormOpen === day.dayOfMonth;
            return (
              <div
                key={day.date}
                className={cn(
                  "group min-h-[110px] border-b border-r border-m-outline-variant p-1.5",
                  !day.inMonth && "bg-m-surface-container-low/50",
                  day.isToday && "bg-m-primary-container/20",
                )}
              >
                <span className={cn("text-label-small text-m-on-surface-variant", day.isToday && "font-semibold text-m-primary")}>
                  {day.dayOfMonth}
                </span>
                {day.inMonth && (
                  <div className="mt-1 grid gap-1">
                    {chips.map(renderChip)}
                    {showForm ? (
                      <DayAddForm
                        board={board}
                        day={day.dayOfMonth}
                        month={month}
                        pending={planOnDay.isPending}
                        onSubmit={(rowId) => submitPlan(day.dayOfMonth, rowId)}
                        onCancel={() => setDayFormOpen(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDayFormOpen(day.dayOfMonth)}
                        aria-label={`Plan something on ${day.dayOfMonth} ${MONTH_NAMES[month - 1]}`}
                        className={cn(
                          "block w-full rounded-md border border-dashed border-m-outline-variant px-1.5 py-1 text-left text-label-small text-m-on-surface-variant opacity-0",
                          "group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          "[@media(hover:none)]:opacity-100",
                        )}
                      >
                        + Plan
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-label-small text-m-on-surface-variant">
        Items land on the day from the row's Day field, or their template's Date metric. Anything without one sits in
        &ldquo;Anytime this month&rdquo;.
      </p>
    </div>
  );
}

function DayAddForm({
  board,
  day,
  month,
  pending,
  onSubmit,
  onCancel,
}: {
  board: ResultsBoard;
  day: number;
  month: number;
  pending: boolean;
  onSubmit: (rowId: string) => void;
  onCancel: () => void;
}) {
  const rowsWithEntryThisMonth = new Set(
    Object.keys(board.entries)
      .filter((k) => {
        const [, y, m] = k.split("|");
        return Number(m) === month && !!y;
      })
      .map((k) => k.split("|")[0]),
  );
  const firstRowId = board.groups.flatMap((g) => g.rows)[0]?.id ?? "";
  const [rowId, setRowId] = useState(firstRowId);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (rowId) onSubmit(rowId);
      }}
      className="grid gap-1.5 rounded-md border border-m-outline-variant bg-m-surface-container-low p-1.5"
    >
      <Label htmlFor={`day-add-row-${day}`} className="sr-only">
        {`What's on ${day} ${MONTH_NAMES[month - 1]}`}
      </Label>
      <Select value={rowId} onValueChange={setRowId}>
        <SelectTrigger id={`day-add-row-${day}`} className="h-7 text-label-small">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {board.groups.map((group) => (
            <SelectGroup key={group.id}>
              <SelectLabel>{group.name}</SelectLabel>
              {group.rows.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.name}
                  {rowsWithEntryThisMonth.has(row.id) ? " (move here)" : ""}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" className="h-7 text-label-small" disabled={!rowId || pending}>
          Plan it
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 text-label-small" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
