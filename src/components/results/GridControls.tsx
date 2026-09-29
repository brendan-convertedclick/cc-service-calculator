// src/components/results/GridControls.tsx
//
// What the planner (PipelineGrid) and Year results (ResultsGrid) share, so the
// two boards behave the same: the month count pill, coloured by its group,
// that lists what is behind the number on hover or focus; the one
// expand/collapse toggle used on a group header (its rows) and on the board
// header (every group). The open/closed state behind it is
// useGridExpansion. Everything here needs a TooltipProvider above it.

import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GroupColourClasses } from "@/components/results/groupColours";

export interface CountItem {
  id: string;
  title: string;
  /** A second, quieter line: the row a task sits in, or what a row holds. */
  detail?: string;
  /** Ours (M) or the school's (S). Omitted for items that are not tasks. */
  side?: "us" | "school";
}

export function CountPill({ items, tint }: { items: CountItem[]; tint: GroupColourClasses | null }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${items.length}: ${items.map((i) => i.title).join(", ")}`}
          className={cn(
            "inline-grid h-5 min-w-5 cursor-default place-items-center rounded-full border px-1.5 text-label-small font-semibold tabular-nums",
            "transition-transform motion-reduce:transition-none hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            tint ? cn(tint.border, tint.text, "bg-m-surface") : "border-m-outline-variant text-m-on-surface-variant",
          )}
        >
          {items.length}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72 p-2.5">
        <ul className="flex flex-col gap-1.5">
          {items.map((i) => (
            <li key={i.id} className="flex items-start gap-1.5">
              {i.side ? (
                <span
                  className={cn(
                    "mt-px grid h-4 w-4 flex-none place-items-center rounded-full text-[9px] font-bold leading-none",
                    i.side === "us" ? cn(tint?.swatch ?? "bg-m-primary", "text-white") : "border border-dashed border-current",
                  )}
                >
                  {i.side === "us" ? "M" : "S"}
                </span>
              ) : (
                <span className={cn("mt-1 h-2 w-2 flex-none rounded-full", tint?.swatch ?? "bg-current")} />
              )}
              <span className="min-w-0">
                <span className="block text-label-medium">{i.title}</span>
                {i.detail ? <span className="block text-label-small opacity-70">{i.detail}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

/** One button that flips: shows "expand" while anything is closed, "collapse" once all of it is open. */
export function ExpandToggle({ open, what, onToggle }: { open: boolean; what: string; onToggle: () => void }) {
  return (
    <IconTip label={open ? `Collapse ${what}` : `Expand ${what}`} onClick={onToggle}>
      {open ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
    </IconTip>
  );
}

function IconTip({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="grid h-6 w-6 place-items-center rounded-md text-m-on-surface-variant transition-colors motion-reduce:transition-none hover:bg-m-surface-container-high hover:text-m-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
