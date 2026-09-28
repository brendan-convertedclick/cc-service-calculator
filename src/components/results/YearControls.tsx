// src/components/results/YearControls.tsx
//
// Single-select year picker (current-3 .. current+1) + a "Compare with…"
// multi-select of the other years in that range. Each compared year gets a
// swatch previewing its lane shade so the picker teaches the grid's grey
// bands before you even open a row.

import { cn } from "@/lib/utils";
import { laneShade } from "@/lib/results-grid";
import { LANE_SHADE_CLASSES } from "@/components/results/groupColours";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function YearControls({
  years,
  year,
  onYearChange,
  compareYears,
  onCompareChange,
}: {
  years: number[];
  year: number;
  onYearChange: (year: number) => void;
  compareYears: Set<number>;
  onCompareChange: (next: Set<number>) => void;
}) {
  const compareOptions = years.filter((y) => y !== year);
  const shown = [...compareYears].filter((y) => y !== year).sort((a, b) => b - a);

  function toggle(y: number) {
    const next = new Set(compareYears);
    next.has(y) ? next.delete(y) : next.add(y);
    onCompareChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex overflow-hidden rounded-full border border-m-outline-variant bg-m-surface">
        {years.map((y) => (
          <button
            key={y}
            type="button"
            aria-pressed={y === year}
            onClick={() => onYearChange(y)}
            className={cn(
              "px-3.5 py-1.5 text-label-medium",
              y === year
                ? "bg-m-primary-container font-semibold text-m-on-primary-container"
                : "text-m-on-surface-variant hover:bg-m-surface-container-high",
            )}
          >
            {y}
          </button>
        ))}
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="rounded-full font-normal">
            {shown.length ? `Compare with ${shown.join(", ")}` : "Compare with…"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <div className="grid gap-0.5">
            {compareOptions.map((y) => (
              <label
                key={y}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-label-large hover:bg-m-surface-container-low"
              >
                <Checkbox checked={compareYears.has(y)} onCheckedChange={() => toggle(y)} />
                <span className={cn("h-3.5 w-3.5 rounded-sm border border-m-outline-variant", LANE_SHADE_CLASSES[laneShade(year, y)])} />
                {y}
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
