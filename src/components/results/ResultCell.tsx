// src/components/results/ResultCell.tsx
//
// One month × row cell, for the current year (the "hist" (compared-year)
// rendering lives inline in ResultsGrid since it's simpler and has no
// separate state machine — just "has a starred value or not").

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  cellState,
  formatValue,
  hasValue,
  planHeadline,
  starredFields,
  type EntryValues,
  type LinkedTask,
  type ResultsTemplate,
} from "@/lib/results-grid";
import { Badge } from "@/components/ui/badge";
import { GROUP_COLOUR_CLASSES } from "@/components/results/groupColours";
import type { GroupColour } from "@/lib/results-grid";

export function ResultCell({
  year,
  month,
  template,
  values,
  linkedTasks,
  now,
  colour,
  label,
  selected,
  onClick,
}: {
  year: number;
  month: number;
  template: ResultsTemplate;
  values: EntryValues | undefined;
  /** Pipeline tasks linked to this row for this month (0180) — a task alone
   * makes the cell read as at least planned. */
  linkedTasks?: LinkedTask[];
  now: { year: number; month: number };
  colour: GroupColour;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  const state = cellState(year, month, template, values, now, !!linkedTasks?.length);
  const c = GROUP_COLOUR_CLASSES[colour];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group block min-h-[54px] w-full rounded-md border border-transparent p-1.5 text-left text-label-small leading-snug",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "ring-2 ring-primary",
        state === "empty" && "hover:border-dashed hover:border-m-outline-variant",
        state === "plan" && cn("border-dashed", c.border, "text-m-on-surface-variant"),
        state === "due" && "border-dashed border-amber-500 bg-amber-50 text-m-on-surface dark:border-amber-400 dark:bg-amber-950/40",
        state === "done" && cn(c.bgSoft, c.border, "border"),
      )}
    >
      {/* Row/month context read first, then the cell's own visible content —
          an aria-label here would replace that content for screen readers. */}
      <span className="sr-only">{label}</span>
      {linkedTasks && linkedTasks.length > 0 && (
        <span className="mb-0.5 grid gap-0.5">
          {linkedTasks.map((t) => (
            <span key={t.taskId} className="flex items-center gap-1 truncate">
              <Badge variant={t.side === "school" ? "warning" : "muted"} className="shrink-0 px-1 py-0 text-[10px] leading-tight">
                {t.side === "school" ? "School" : "Ours"}
              </Badge>
              <span className="truncate">{t.label}</span>
              {t.state === "done" && <Check className="h-3 w-3 flex-none text-m-primary" aria-hidden />}
            </span>
          ))}
        </span>
      )}
      {state === "empty" && (
        <span className="hidden text-m-on-surface-variant group-hover:inline group-focus-visible:inline">+ Plan</span>
      )}
      {(state === "plan" || state === "due") && (
        <>
          <span
            className={cn(
              "block text-label-small font-semibold uppercase tracking-wide",
              state === "due" ? "text-amber-700 dark:text-amber-300" : c.text,
            )}
          >
            {state === "due" ? "Results due" : "Planned"}
          </span>
          <span className="line-clamp-2">{values ? planHeadline(template, values) : ""}</span>
        </>
      )}
      {state === "done" && values && (
        <span className="grid gap-0.5">
          {starredFields(template).map((f) =>
            hasValue(values[f.id]) ? (
              <span key={f.id} className="block truncate text-m-on-surface-variant">
                <b className="text-m-on-surface">{formatValue(f, values[f.id])}</b> {f.short_label ?? f.label}
              </span>
            ) : null,
          )}
        </span>
      )}
    </button>
  );
}

/** A compared-year lane cell: dotted, shows only the first starred metric.
 * Not a button — it isn't clickable, so a disabled button (unreadable by
 * most AT, and semantically wrong for static content) was the wrong element. */
export function HistoryCell({ template, values, label }: { template: ResultsTemplate; values: EntryValues | undefined; label: string }) {
  if (!values) return <div className="min-h-[28px]" />;
  const field = starredFields(template)[0];
  const value = field ? values[field.id] : undefined;
  const has = hasValue(value);

  return (
    <div
      className={cn(
        "block min-h-[28px] w-full rounded-md border border-dotted border-m-outline-variant px-1.5 py-1 text-left text-label-small text-m-on-surface-variant",
        !has && "opacity-70",
      )}
    >
      <span className="sr-only">{label}</span>
      {has ? (
        <span className="truncate">
          {formatValue(field!, value)} {field!.short_label ?? ""}
        </span>
      ) : null}
    </div>
  );
}
