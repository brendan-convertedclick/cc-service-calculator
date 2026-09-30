// src/components/results/ResultsGrid.tsx
//
// The 12-month table: group rows (collapsible, coloured), rows under them,
// one lane per shown year (current + compared, each its own <tr> so cells
// never need to squeeze two years into one). Horizontal scroll lives on the
// wrapping div only; the label column is sticky.

import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { isPast as isPastMonth, laneShade, type ResultsTemplate } from "@/lib/results-grid";
import type { ResultsBoard, ResultsBoardEntry } from "@/hooks/useResults";
import { GROUP_COLOUR_CLASSES, LANE_SHADE_CLASSES } from "@/components/results/groupColours";
import { CountPill, ExpandToggle, SectionRow, type CountItem } from "@/components/results/GridControls";
import { SECTIONS, SECTION_LABELS, sectionFor } from "@/components/results/groupSections";
import { GroupStylePicker } from "@/components/results/GroupStylePicker";
import { useGridExpansion } from "@/hooks/useGridExpansion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ResultCell, HistoryCell } from "@/components/results/ResultCell";
import { AddGroupForm } from "@/components/results/AddGroupForm";
import { AddRowForm } from "@/components/results/AddRowForm";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface SelectedCell {
  rowId: string;
  year: number;
  month: number;
}

export function ResultsGrid({
  clientId,
  board,
  templatesById,
  allTemplates,
  year,
  compareYears,
  now,
  selected,
  onSelectCell,
}: {
  clientId: string;
  board: ResultsBoard;
  templatesById: Map<string, ResultsTemplate>;
  allTemplates: ResultsTemplate[];
  year: number;
  compareYears: number[];
  now: { year: number; month: number };
  selected: SelectedCell | null;
  onSelectCell: (cell: SelectedCell) => void;
}) {
  const x = useGridExpansion();
  // Acquisition, then presence, then account (0194); each keeps its own order.
  const sortedGroups = [...board.groups].sort(
    (a, b) => SECTIONS.indexOf(sectionFor(a.section, a.name)) - SECTIONS.indexOf(sectionFor(b.section, b.name)),
  );

  /** What one row holds in one month, for the count pill's hover list. */
  function cellItems(rowId: string, rowName: string, y: number, m: number, withRow: boolean): CountItem[] {
    const tasks = board.linkedTasks[`${rowId}|${y}|${m}`] ?? [];
    const items: CountItem[] = tasks.map((t) => ({ id: t.taskId, title: t.label, side: t.side, detail: withRow ? rowName : undefined }));
    if (entryFor(rowId, y, m)) items.unshift({ id: `${rowId}:entry`, title: withRow ? rowName : "Results entered", detail: withRow ? "Results entered" : undefined });
    return items;
  }
  const [addingRowIn, setAddingRowIn] = useState<string | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);

  const years = [year, ...compareYears];
  const hasHistory = compareYears.length > 0;

  function templateFor(groupId: string, rowTemplateId: string | null): ResultsTemplate | undefined {
    if (rowTemplateId) return templatesById.get(rowTemplateId);
    const group = board.groups.find((g) => g.id === groupId);
    return group ? templatesById.get(group.templateId) : undefined;
  }

  function entryFor(rowId: string, y: number, m: number): ResultsBoardEntry | undefined {
    return board.entries[`${rowId}|${y}|${m}`];
  }

  return (
    <TooltipProvider delayDuration={150}>
    <div className="overflow-x-auto rounded-xl border border-m-outline-variant bg-m-surface">
      <table className="w-full min-w-[1180px] table-fixed border-separate border-spacing-0">
        <colgroup>
          <col className="w-[260px]" />
          {hasHistory && <col className="w-12" />}
          {MONTHS.map((m) => (
            <col key={m} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border-b border-m-outline-variant bg-m-surface p-2.5 text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="text-label-small uppercase tracking-wide text-m-on-surface-variant">Group</span>
                <ExpandToggle
                  open={x.anyGroupOpen(board.groups.map((g) => g.id))}
                  what="every group"
                  onToggle={() => x.toggleAllGroups(board.groups.map((g) => g.id))}
                />
              </div>
            </th>
            {hasHistory && <th className="border-b border-m-outline-variant" />}
            {MONTHS.map((m) => {
              const isNow = year === now.year && m === now.month;
              const past = isPastMonth(year, m, now);
              return (
                <th
                  key={m}
                  className={cn(
                    "border-b border-m-outline-variant p-2.5 text-left text-label-small uppercase tracking-wide",
                    isNow ? "text-m-on-surface" : past ? "text-m-on-surface-variant/60" : "text-m-on-surface-variant",
                  )}
                >
                  {MONTH_NAMES[m - 1]}
                  {isNow && <span className="mt-1.5 block h-[3px] w-6 rounded-full bg-amber-500" />}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedGroups.map((group, gi) => {
            const section = sectionFor(group.section, group.name);
            const newSection = section !== (gi > 0 ? sectionFor(sortedGroups[gi - 1].section, sortedGroups[gi - 1].name) : null);
            const open = x.isGroupOpen(group.id);
            const rowIds = group.rows.map((r) => r.id);
            const colour = GROUP_COLOUR_CLASSES[group.colour];
            const template = templatesById.get(group.templateId);
            const monthItems = MONTHS.map((m) => group.rows.flatMap((r) => cellItems(r.id, r.name, year, m, true)));
            const span = 1 + (hasHistory ? 1 : 0) + 12;

            return (
              <Fragment key={group.id}>
                {newSection ? (
                  <SectionRow name={SECTION_LABELS[section].name} blurb={SECTION_LABELS[section].blurb} colSpan={1 + (hasHistory ? 1 : 0) + 12} />
                ) : null}
                <tr>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-m-outline-variant bg-m-surface-container-low p-0 text-left"
                  >
                    <div className="flex items-start">
                    <button
                      type="button"
                      aria-label={open ? `Close ${group.name}` : `Open ${group.name}`}
                      onClick={() => x.toggleGroup(group.id)}
                      className="grid h-11 w-7 flex-none place-items-center pl-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronRight
                        className={cn("h-3.5 w-3.5 text-m-on-surface-variant transition-transform motion-reduce:transition-none", open && "rotate-90")}
                      />
                    </button>
                    <div className="flex-none py-2">
                      <GroupStylePicker
                        clientId={clientId}
                        resultsGroupId={group.id}
                        name={group.name}
                        icon={group.icon}
                        colour={group.colour}
                        section={section}
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
                          {group.rows.length} channel{group.rows.length === 1 ? "" : "s"} · {template?.name ?? ""} template
                        </span>
                      </span>
                    </button>
                    <div className="flex-none py-2 pr-1.5">
                      <ExpandToggle open={x.rowsAllOpen(rowIds)} what={`every channel in ${group.name}`} onToggle={() => x.toggleGroupRows(group.id, rowIds)} />
                    </div>
                    </div>
                  </th>
                  {hasHistory && <td className="border-b border-m-outline-variant bg-m-surface-container-low" />}
                  {monthItems.map((items, i) => (
                    <td key={i} className="border-b border-m-outline-variant bg-m-surface-container-low p-1.5 text-center align-middle">
                      {items.length ? <CountPill items={items} tint={colour} /> : null}
                    </td>
                  ))}
                </tr>

                {open &&
                  group.rows.map((row) => {
                    const rowTemplate = templateFor(group.id, row.templateId);
                    if (!rowTemplate) return null;
                    const rowOpen = x.isRowOpen(row.id);
                    const rowHeader = (
                      <button
                        type="button"
                        aria-expanded={rowOpen}
                        onClick={() => x.toggleRow(row.id)}
                        className="flex w-full items-start gap-1.5 rounded-sm py-2.5 pl-5 pr-2.5 text-left transition-colors motion-reduce:transition-none hover:bg-m-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ChevronRight
                          className={cn(
                            "mt-1 h-3 w-3 shrink-0 text-m-on-surface-variant transition-transform motion-reduce:transition-none",
                            rowOpen && "rotate-90",
                          )}
                        />
                        <span>
                          <span className="block text-body-medium">{row.name}</span>
                          {row.templateId && (
                            <span className="block text-label-small text-m-on-surface-variant">{rowTemplate.name} template</span>
                          )}
                        </span>
                      </button>
                    );
                    // A closed row is one line: the current year's months as
                    // count pills, the same as the group header.
                    if (!rowOpen) {
                      return (
                        <tr key={`${row.id}-closed`}>
                          <th scope="row" className="sticky left-0 z-10 border-b border-m-outline-variant bg-m-surface p-0 text-left align-top font-normal">
                            {rowHeader}
                          </th>
                          {hasHistory && <td className="border-b border-m-outline-variant" />}
                          {MONTHS.map((m) => {
                            const items = cellItems(row.id, row.name, year, m, false);
                            return (
                              <td key={m} className="border-b border-m-outline-variant p-1.5 text-center align-middle">
                                {items.length ? <CountPill items={items} tint={colour} /> : null}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    }
                    return years.map((y, laneIdx) => {
                      const isCurrent = laneIdx === 0;
                      const shade = isCurrent ? null : laneShade(year, y);
                      return (
                        <tr key={`${row.id}-${y}`} className={cn(shade && LANE_SHADE_CLASSES[shade])}>
                          {laneIdx === 0 && (
                            <th
                              scope="row"
                              rowSpan={years.length}
                              className="sticky left-0 z-10 border-b border-m-outline-variant bg-m-surface p-0 text-left align-top font-normal"
                            >
                              {rowHeader}
                            </th>
                          )}
                          {hasHistory && (
                            <td
                              className={cn(
                                "border-b border-m-outline-variant p-1 text-center align-middle font-mono text-label-small",
                                isCurrent ? "font-semibold text-m-on-surface" : "text-m-on-surface-variant",
                              )}
                            >
                              {y}
                            </td>
                          )}
                          {MONTHS.map((m) => {
                            const values = entryFor(row.id, y, m)?.values;
                            const key = { rowId: row.id, year: y, month: m };
                            const isSelected = !!selected && selected.rowId === row.id && selected.year === y && selected.month === m;
                            return (
                              <td key={m} className={cn("border-b border-m-outline-variant p-1 align-top", isCurrent ? "" : "py-0.5")}>
                                {isCurrent ? (
                                  <ResultCell
                                    year={y}
                                    month={m}
                                    template={rowTemplate}
                                    values={values}
                                    linkedTasks={board.linkedTasks[`${row.id}|${y}|${m}`]}
                                    now={now}
                                    colour={group.colour}
                                    label={`${group.name} · ${row.name} · ${MONTH_NAMES[m - 1]} ${y}`}
                                    selected={isSelected}
                                    onClick={() => onSelectCell(key)}
                                  />
                                ) : (
                                  <HistoryCell
                                    template={rowTemplate}
                                    values={values}
                                    label={`${group.name} · ${row.name} · ${MONTH_NAMES[m - 1]} ${y}`}
                                  />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    });
                  })}

                {open && (
                  <tr>
                    <td colSpan={span} className="border-b border-m-outline-variant p-2">
                      {addingRowIn === group.id ? (
                        <AddRowForm
                          clientId={clientId}
                          groupId={group.id}
                          groupTemplateName={template?.name ?? ""}
                          templates={allTemplates}
                          onDone={() => setAddingRowIn(null)}
                          onCancel={() => setAddingRowIn(null)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setAddingRowIn(group.id)}
                          className="pl-8 text-label-large font-medium text-m-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          + Add a channel to {group.name}
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}

          <tr>
            <td colSpan={1 + (hasHistory ? 1 : 0) + 12} className="p-2">
              {addingGroup ? (
                <AddGroupForm
                  clientId={clientId}
                  templates={allTemplates}
                  onDone={() => setAddingGroup(false)}
                  onCancel={() => setAddingGroup(false)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingGroup(true)}
                  className="text-label-large font-medium text-m-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  + Add group
                </button>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    </TooltipProvider>
  );
}
