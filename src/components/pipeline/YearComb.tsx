// src/components/pipeline/YearComb.tsx
//
// The twelve-month strip. Past months (closed) read m-secondary, the current
// one m-primary, everything after is neutral — and a small dot sits under any month
// whose role is 'open_day', because that is the one date in the school's
// year everything else is built around.
//
// One component, two jobs: the card's small read-only comb and the drawer's
// larger clickable chip strip are the same twelve segments at a different
// size, not two components that could quietly disagree about what "past"
// means. Passing onSelectMonth is what turns the second job on.

import { cn } from "@/lib/utils";
import type { ThemeRole } from "@/lib/pipeline-year";

export interface YearCombMonth {
  month_no: number;
  role: ThemeRole;
  closed_at: string | null;
  /** Only used for the title/aria label — the drawer has it, a bare board fetch might not. */
  theme?: string;
}

export function YearComb({
  months,
  currentMonthNo,
  selectedMonthNo = null,
  onSelectMonth,
  size = "sm",
  className,
}: {
  /** Twelve entries, month_no 1..12 — callers own the sort. */
  months: YearCombMonth[];
  currentMonthNo: number | null;
  /** Drawer only: which chip reads as picked. */
  selectedMonthNo?: number | null;
  /** Presence makes the strip interactive (the drawer); omit for the card's static comb. */
  onSelectMonth?: (monthNo: number) => void;
  size?: "sm" | "lg";
  className?: string;
}) {
  const interactive = !!onSelectMonth;

  return (
    <div
      className={cn("grid grid-cols-12 gap-0.5", className)}
      role={interactive ? "group" : undefined}
      aria-label={interactive ? "Year, by month" : "Year progress"}
    >
      {months.map((m) => {
        const isPast = m.closed_at !== null;
        const isCurrent = m.month_no === currentMonthNo;
        const isSelected = m.month_no === selectedMonthNo;
        const title = `M${m.month_no}${m.theme ? ` · ${m.theme}` : ""}${
          isCurrent ? " — current" : isPast ? " — closed" : ""
        }${m.role === "open_day" ? " — open day" : ""}`;

        const inner = (
          <>
            <span
              className={cn(
                size === "sm" ? "h-1.5" : "h-3",
                "w-full rounded-sm",
                isCurrent
                  ? "bg-m-primary"
                  : isPast
                    ? "bg-m-secondary"
                    : "border border-m-outline-variant bg-m-surface-container-high",
                isSelected && "ring-2 ring-m-primary ring-offset-1",
              )}
            />
            <span className={cn("mt-0.5 h-1 w-1 rounded-full", m.role === "open_day" ? "bg-m-tertiary" : "bg-transparent")} />
            {size === "lg" ? (
              <span className="text-label-small tabular-nums text-m-on-surface-variant">{m.month_no}</span>
            ) : null}
          </>
        );

        if (!interactive) {
          return (
            <div key={m.month_no} title={title} className="flex flex-col items-center">
              {inner}
            </div>
          );
        }

        return (
          <button
            key={m.month_no}
            type="button"
            title={title}
            aria-label={title}
            aria-pressed={isSelected}
            onClick={() => onSelectMonth(m.month_no)}
            className="flex flex-col items-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
