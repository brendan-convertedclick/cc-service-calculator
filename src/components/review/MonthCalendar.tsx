// src/components/review/MonthCalendar.tsx
//
// One month, one grid, both audiences. The client's page and /client-signoffs
// render this same component — the staff one simply has more on it (briefed
// ClickUp tasks, and a client name on each chip when no client is picked).
//
// The grammar is three marks and it is deliberately quiet:
//   a DATE (event) is a filled band — it is a fact, it needs no attention
//   a DUE item is an outlined chip
//   a LATE item is the only thing that carries the error colour
// Anything louder and a month with a normal amount of work in it reads as an
// emergency, which is how people stop opening the calendar.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  monthGrid,
  monthLabel,
  shiftMonth,
  WEEKDAY_LABELS,
  type CalendarEntry,
} from "@/lib/calendar-month";
import { cn } from "@/lib/utils";

export function MonthCalendar({
  month,
  entries,
  onMonthChange,
  onPick,
  emptyNote,
}: {
  /** "YYYY-MM" */
  month: string;
  entries: CalendarEntry[];
  onMonthChange: (month: string) => void;
  /** Clicking a chip. Optional — the client's calendar opens the item, the staff one may not. */
  onPick?: (entry: CalendarEntry) => void;
  /** One line under the grid when the whole month is empty. */
  emptyNote?: string;
}) {
  const weeks = monthGrid(month, entries);
  const shown = weeks.flat().reduce((n, d) => n + d.entries.length, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous month"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="min-w-[11rem] text-title-medium text-m-on-surface">{monthLabel(month)}</h3>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next month"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[44rem]">
          <div className="grid grid-cols-7 gap-px">
            {WEEKDAY_LABELS.map((d) => (
              <div
                key={d}
                className="px-2 py-1 text-label-small uppercase tracking-wide text-m-on-surface-variant"
              >
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px rounded-lg bg-m-outline-variant p-px">
            {weeks.flat().map((day) => (
              <div
                key={day.date}
                className={cn(
                  "min-h-[6.5rem] bg-m-surface p-1.5",
                  !day.inMonth && "bg-m-surface-container text-m-on-surface-variant",
                )}
              >
                <div
                  className={cn(
                    "mb-1 flex h-5 w-5 items-center justify-center text-label-small tabular-nums",
                    day.isToday
                      ? "rounded-full bg-m-primary text-m-on-primary"
                      : day.inMonth
                        ? "text-m-on-surface"
                        : "text-m-on-surface-variant/70",
                  )}
                >
                  {day.dayOfMonth}
                </div>

                <div className="flex flex-col gap-1">
                  {day.entries.map((e) => {
                    const chip = (
                      <span className="block truncate">
                        {e.clientName ? (
                          <span className="opacity-70">{e.clientName} · </span>
                        ) : null}
                        {e.label}
                      </span>
                    );
                    const className = cn(
                      "w-full rounded px-1.5 py-1 text-left text-label-small",
                      e.kind === "event"
                        ? "bg-m-tertiary-container text-m-on-tertiary-container"
                        : e.late
                          ? "bg-m-error-container text-m-on-error-container"
                          : "border border-m-outline-variant text-m-on-surface-variant",
                    );
                    return onPick ? (
                      <button
                        key={e.id}
                        type="button"
                        title={e.label}
                        onClick={() => onPick(e)}
                        className={cn(className, "hover:opacity-80")}
                      >
                        {chip}
                      </button>
                    ) : (
                      <span key={e.id} title={e.label} className={className}>
                        {chip}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {shown === 0 && emptyNote ? (
        <p className="text-body-small text-m-on-surface-variant">{emptyNote}</p>
      ) : null}
    </div>
  );
}
