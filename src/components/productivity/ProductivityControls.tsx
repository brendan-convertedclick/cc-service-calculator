// src/components/productivity/ProductivityControls.tsx
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { View } from "@/hooks/useProductivity";

interface Props {
  view: View;
  date: string;       // ISO date string
  periodLabel: string;
  onViewChange: (v: View) => void;
  onDateChange: (d: string) => void;
}

const VIEWS: View[] = ["year", "month", "week"];

function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function navigate(view: View, date: string, direction: 1 | -1): string {
  // Parse as local midnight to avoid UTC-offset day-shift
  const [y, mo, d] = date.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  if (view === "year") {
    dt.setFullYear(dt.getFullYear() + direction);
  } else if (view === "month") {
    dt.setMonth(dt.getMonth() + direction);
  } else {
    dt.setDate(dt.getDate() + direction * 7);
  }
  return toLocalISO(dt);
}

export function ProductivityControls({ view, date, periodLabel, onViewChange, onDateChange }: Props) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-headline-medium text-m-on-surface">Productivity</h1>

      <div className="flex items-center gap-3">
        {/* Date navigator */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onDateChange(navigate(view, date, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-m-on-surface-variant hover:bg-m-surface-container transition-colors"
            aria-label="Previous period"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-32 text-center text-body-medium font-medium text-m-on-surface">
            {periodLabel}
          </span>
          <button
            type="button"
            onClick={() => onDateChange(navigate(view, date, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-m-on-surface-variant hover:bg-m-surface-container transition-colors"
            aria-label="Next period"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* View tabs */}
        <div className="flex items-center rounded-full bg-m-surface-container p-1 gap-0.5">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onViewChange(v)}
              className={`px-4 py-1.5 rounded-full text-label-large capitalize transition-colors ${
                view === v
                  ? "bg-m-primary text-m-on-primary font-semibold shadow-sm"
                  : "text-m-on-surface-variant hover:text-m-on-surface"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
