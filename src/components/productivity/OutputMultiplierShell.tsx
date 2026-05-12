// src/components/productivity/OutputMultiplierShell.tsx
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DirectView } from "./DirectView";
import { ParallelView } from "./ParallelView";
import { PassiveView } from "./PassiveView";
import {
  useOutputMultiplier,
  MultiplierView,
  MultiplierPeriod,
} from "@/hooks/useOutputMultiplier";

interface Props {
  loggedBy?: string; // undefined = whole team
}

const VIEWS: { key: MultiplierView; label: string }[] = [
  { key: "direct", label: "Direct" },
  { key: "parallel", label: "Parallel" },
  { key: "passive", label: "Passive" },
];

const PERIODS: MultiplierPeriod[] = ["week", "month", "year"];

function anchorDate(period: MultiplierPeriod, offset: number): string {
  const d = new Date();
  if (period === "week") d.setDate(d.getDate() + offset * 7);
  if (period === "month") d.setMonth(d.getMonth() + offset);
  if (period === "year") d.setFullYear(d.getFullYear() + offset);
  return d.toISOString().slice(0, 10);
}

export function OutputMultiplierShell({ loggedBy }: Props) {
  const [view, setView] = useState<MultiplierView>("direct");
  const [period, setPeriod] = useState<MultiplierPeriod>("month");
  const [periodOffset, setPeriodOffset] = useState(0);

  const date = anchorDate(period, periodOffset);
  const { data, isLoading, isError } = useOutputMultiplier(view, period, date, loggedBy);

  return (
    <div className="space-y-5">
      {/* Controls row */}
      <div className="flex items-center justify-between">
        {/* View sub-tabs */}
        <div className="flex gap-1 rounded-lg border border-m-outline-variant bg-m-surface-container p-1">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={[
                "rounded-md px-4 py-1.5 text-label-medium transition-colors",
                view === v.key
                  ? "bg-m-primary/15 text-m-primary"
                  : "text-m-on-surface-variant hover:text-m-on-surface",
              ].join(" ")}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* Period selector + prev/next */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-m-outline-variant bg-m-surface-container p-1">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => { setPeriod(p); setPeriodOffset(0); }}
                className={[
                  "rounded-md px-3 py-1.5 text-label-small capitalize transition-colors",
                  period === p
                    ? "bg-m-primary/15 text-m-primary"
                    : "text-m-on-surface-variant hover:text-m-on-surface",
                ].join(" ")}
              >
                {p}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setPeriodOffset((o) => o - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setPeriodOffset((o) => Math.min(o + 1, 0))}
            disabled={periodOffset === 0}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex justify-center py-16">
          <div className="text-m-on-surface-variant text-body-medium">Loading…</div>
        </div>
      )}
      {isError && (
        <div className="rounded-xl border border-m-error/30 bg-m-error/10 p-6 text-m-error text-body-medium">
          Failed to load output multiplier data.
        </div>
      )}
      {data && !isLoading && (
        <>
          {view === "direct" && "members" in data && <DirectView data={data} period={period} isTeam={!loggedBy} />}
          {view === "parallel" && "heatmap" in data && <ParallelView data={data} />}
          {view === "passive" && "agents" in data && <PassiveView data={data} />}
        </>
      )}
    </div>
  );
}
