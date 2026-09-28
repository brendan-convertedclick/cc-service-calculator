// src/pages/ResultsPlanner.tsx
//
// /results/:clientId — one school's 12-month results board. See
// docs/superpowers/specs/2026-09-28-school-year-results-design.md.

import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, LayoutTemplate } from "lucide-react";
import { useClients } from "@/hooks/useClients";
import { useResultsBoard, useResultTemplates, useSeedStandardGroups } from "@/hooks/useResults";
import { cellState, entryDay, nowYM, type ResultsTemplate } from "@/lib/results-grid";
import { cn, errorMessage } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { YearControls } from "@/components/results/YearControls";
import { GroupFilter } from "@/components/results/GroupFilter";
import { ResultsGrid, type SelectedCell } from "@/components/results/ResultsGrid";
import { ResultsMonthView } from "@/components/results/ResultsMonthView";
import { EntryPanel } from "@/components/results/EntryPanel";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function ResultsPlanner() {
  const { clientId = "" } = useParams();
  const { data: clients } = useClients();
  const client = clients?.find((c) => c.id === clientId);
  const now = nowYM();

  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") === "month" ? "month" : "year";
  const urlMonth = Number(searchParams.get("m"));
  const urlYear = Number(searchParams.get("y"));
  // Review finding 5: a malformed or out-of-range URL (m=3.5, y=abc, y=1)
  // falls back to "now" rather than feeding a fractional or nonsense year/
  // month into MONTH_NAMES indexing and the calendar-month math.
  const validMonth = Number.isInteger(urlMonth) && urlMonth >= 1 && urlMonth <= 12;
  const validYear = Number.isInteger(urlYear) && urlYear >= 2000 && urlYear <= 2100;

  const [year, setYear] = useState(validYear ? urlYear : now.year);
  const [viewMonth, setViewMonth] = useState(validMonth ? urlMonth : now.month);
  const [compareYears, setCompareYears] = useState<Set<number>>(new Set([now.year - 1]));
  const [visibleGroupIds, setVisibleGroupIds] = useState<Set<string> | null>(null); // null = all
  const [selected, setSelected] = useState<SelectedCell | null>(null);

  function setViewParam(nextView: "year" | "month", nextYear = year, nextMonth = viewMonth) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (nextView === "month") {
          next.set("view", "month");
          next.set("m", String(nextMonth));
          next.set("y", String(nextYear));
        } else {
          next.delete("view");
          next.delete("m");
          next.delete("y");
        }
        return next;
      },
      { replace: true },
    );
  }

  function changeYear(y: number) {
    setYear(y);
    if (view === "month") setViewParam("month", y, viewMonth);
  }

  function stepMonth(delta: number) {
    let m = viewMonth + delta;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setViewMonth(m);
    setYear(y);
    setViewParam("month", y, m);
  }

  const yearRange = useMemo(() => [now.year - 3, now.year - 2, now.year - 1, now.year, now.year + 1], [now.year]);
  const compareList = useMemo(() => [...compareYears].filter((y) => y !== year).sort((a, b) => b - a), [compareYears, year]);
  const boardYears = useMemo(
    () => [...new Set(view === "month" ? [year, year - 1] : [year, ...compareList, year - 1])],
    [view, year, compareList],
  );

  const { data: templates } = useResultTemplates();
  const { data: board, isLoading, error: boardError } = useResultsBoard(clientId, boardYears);
  const seedStandard = useSeedStandardGroups();

  const templatesById = useMemo(() => new Map((templates ?? []).map((t) => [t.id, t])), [templates]);

  const groupOptions = (board?.groups ?? []).map((g) => ({ id: g.id, name: g.name }));
  const selectedGroupIds = visibleGroupIds ?? new Set(groupOptions.map((g) => g.id));
  const visibleGroups = (board?.groups ?? []).filter((g) => selectedGroupIds.has(g.id));

  const summary = useMemo(() => {
    if (!board) return { planned: 0, due: 0 };
    let planned = 0;
    let due = 0;
    for (const group of visibleGroups) {
      const template = templatesById.get(group.templateId);
      if (!template) continue;
      for (const row of group.rows) {
        const rowTemplate = row.templateId ? templatesById.get(row.templateId) : template;
        if (!rowTemplate) continue;
        for (let m = 1; m <= 12; m++) {
          const state = cellState(year, m, rowTemplate, board.entries[`${row.id}|${year}|${m}`]?.values, now);
          if (state === "plan") planned++;
          if (state === "due") due++;
        }
      }
    }
    return { planned, due };
  }, [board, visibleGroups, templatesById, year, now]);

  const monthSummary = useMemo(() => {
    if (!board || view !== "month") return { onDate: 0, anytime: 0 };
    let onDate = 0;
    let anytime = 0;
    for (const group of visibleGroups) {
      const template = templatesById.get(group.templateId);
      if (!template) continue;
      for (const row of group.rows) {
        const rowTemplate = row.templateId ? templatesById.get(row.templateId) : template;
        if (!rowTemplate) continue;
        const entry = board.entries[`${row.id}|${year}|${viewMonth}`];
        if (!entry) continue;
        if (entryDay(rowTemplate, entry, year, viewMonth)) onDate++;
        else anytime++;
      }
    }
    return { onDate, anytime };
  }, [board, view, visibleGroups, templatesById, year, viewMonth]);

  if (!clients) {
    return <div className="p-6 text-body-medium text-m-on-surface-variant">Loading…</div>;
  }
  if (!client) {
    return (
      <div className="p-6 text-body-medium text-m-on-surface-variant">
        Client not found.{" "}
        <Link to="/results" className="underline">
          Back to Year results
        </Link>
      </div>
    );
  }

  const selectedCellData =
    selected &&
    (() => {
      for (const group of board?.groups ?? []) {
        const row = group.rows.find((r) => r.id === selected.rowId);
        if (!row) continue;
        const template: ResultsTemplate | undefined = row.templateId ? templatesById.get(row.templateId) : templatesById.get(group.templateId);
        if (!template) return null;
        return { group, row, template };
      }
      return null;
    })();

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/results" className="flex items-center gap-1 text-label-medium text-m-on-surface-variant hover:underline">
            <ChevronLeft className="h-3.5 w-3.5" /> Year results
          </Link>
          <h1 className="mt-1 text-headline-medium">{client.name} · School year</h1>
        </div>
        <Link
          to="/results/templates"
          className="flex items-center gap-1.5 text-label-large text-m-primary hover:underline"
        >
          <LayoutTemplate className="h-4 w-4" />
          Templates
        </Link>
      </div>

      {isLoading ? (
        <p className="text-body-medium text-m-on-surface-variant">Loading…</p>
      ) : boardError ? (
        <div className="grid gap-1 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-body-medium text-destructive">
          <p className="font-semibold">Could not load results.</p>
          <p>{errorMessage(boardError)}</p>
        </div>
      ) : !board?.groups.length ? (
        <div className="grid gap-3 rounded-xl border border-m-outline-variant bg-m-surface-container-low p-8 text-center">
          <p className="text-body-large">No results groups yet for {client.name}.</p>
          <div className="mx-auto flex gap-2">
            <Button
              onClick={() =>
                seedStandard.mutate(clientId, {
                  onError: (e) => toast.error(`Could not seed groups: ${errorMessage(e)}`),
                })
              }
              disabled={seedStandard.isPending}
            >
              Start from the standard groups
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex overflow-hidden rounded-full border border-m-outline-variant bg-m-surface">
                {(["year", "month"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={v === view}
                    onClick={() => setViewParam(v)}
                    className={cn(
                      "px-3.5 py-1.5 text-label-medium capitalize",
                      v === view
                        ? "bg-m-primary-container font-semibold text-m-on-primary-container"
                        : "text-m-on-surface-variant hover:bg-m-surface-container-high",
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>

              {view === "year" ? (
                <YearControls years={yearRange} year={year} onYearChange={changeYear} compareYears={compareYears} onCompareChange={setCompareYears} />
              ) : (
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" onClick={() => stepMonth(-1)} aria-label="Previous month">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="min-w-[10rem] text-center text-label-large font-semibold">
                    {MONTH_NAMES[viewMonth - 1]} {year}
                  </span>
                  <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" onClick={() => stepMonth(1)} aria-label="Next month">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}

              <GroupFilter groups={groupOptions} selected={selectedGroupIds} onChange={setVisibleGroupIds} />

              {view === "year" ? (
                <span className="text-body-medium text-m-on-surface-variant">
                  {summary.planned} planned ahead
                  {summary.due > 0 && <> · <b className="font-semibold text-amber-600 dark:text-amber-400">{summary.due} waiting on results</b></>}
                </span>
              ) : (
                <span className="text-body-medium text-m-on-surface-variant">
                  {monthSummary.onDate} on a date · {monthSummary.anytime} anytime
                </span>
              )}
            </div>
          </div>

          {view === "year" ? (
            <ResultsGrid
              clientId={clientId}
              board={{ ...board, groups: visibleGroups }}
              templatesById={templatesById}
              allTemplates={templates ?? []}
              year={year}
              compareYears={compareList}
              now={now}
              selected={selected}
              onSelectCell={setSelected}
            />
          ) : (
            <ResultsMonthView
              clientId={clientId}
              board={{ ...board, groups: visibleGroups }}
              templatesById={templatesById}
              year={year}
              month={viewMonth}
              now={now}
              selected={selected}
              onSelectCell={setSelected}
            />
          )}
        </>
      )}

      {selected && selectedCellData && (
        <EntryPanel
          clientId={clientId}
          rowId={selected.rowId}
          rowName={selectedCellData.row.name}
          groupName={selectedCellData.group.name}
          year={selected.year}
          month={selected.month}
          template={selectedCellData.template}
          values={board?.entries[`${selected.rowId}|${selected.year}|${selected.month}`]?.values}
          day={board?.entries[`${selected.rowId}|${selected.year}|${selected.month}`]?.day}
          linkedTasks={board?.linkedTasks[`${selected.rowId}|${selected.year}|${selected.month}`]}
          lastYearValues={board?.entries[`${selected.rowId}|${selected.year - 1}|${selected.month}`]?.values}
          now={now}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
