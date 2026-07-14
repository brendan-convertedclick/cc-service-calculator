import { useMemo } from "react";
import { cn, formatHours, formatZar } from "@/lib/utils";
import type { Database } from "@/types/db";

type Department = Database["public"]["Tables"]["departments"]["Row"];
type Step = Database["public"]["Tables"]["process_steps"]["Row"];

interface Props {
  steps: Step[];
  departments: Department[];
  priceCents: number;
  pricingModel: string;
}

export function ChecklistSummary({ steps, departments, priceCents, pricingModel }: Props) {
  const deptMap = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);

  const { totals, totalHours, planCents } = useMemo(() => {
    const totals = new Map<string, number>();
    let totalHours = 0;
    let planCents = 0;
    for (const s of steps) {
      if (!s.department_id || s.estimated_hours == null) continue;
      const h = Number(s.estimated_hours);
      totalHours += h;
      totals.set(s.department_id, (totals.get(s.department_id) ?? 0) + h);
      const rate = deptMap.get(s.department_id)?.hourly_rate_cents ?? 0;
      planCents += h * rate;
    }
    return { totals, totalHours, planCents };
  }, [steps, deptMap]);

  if (totals.size === 0) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        Add at least one step with a department and hours to see the summary.
      </div>
    );
  }

  const entries = Array.from(totals.entries())
    .map(([deptId, hours]) => ({
      dept: deptMap.get(deptId),
      hours,
    }))
    .filter((e) => e.dept != null)
    .sort((a, b) => (a.dept!.display_order ?? 0) - (b.dept!.display_order ?? 0));

  const coveragePct = priceCents > 0 ? (planCents / priceCents) * 100 : 0;
  const isPercentage = pricingModel === "percentage";

  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded bg-muted">
        {entries.map((e) => {
          const widthPct = totalHours > 0 ? (e.hours / totalHours) * 100 : 0;
          return (
            <div
              key={e.dept!.id}
              className="h-full"
              style={{
                width: `${widthPct}%`,
                backgroundColor: e.dept!.color ?? "#64748b",
              }}
              title={`${e.dept!.name}: ${formatHours(e.hours)}`}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {entries.map((e) => (
          <span key={e.dept!.id} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.dept!.color ?? "#64748b" }} />
            {e.dept!.name}: <span className="font-mono tabular-nums">{formatHours(e.hours)}</span>
          </span>
        ))}
        <span className="ml-auto font-medium text-foreground">Total <span className="font-mono tabular-nums">{formatHours(totalHours)}</span></span>
      </div>

      {!isPercentage && priceCents > 0 && (
        <div
          className={cn(
            "text-xs",
            coveragePct > 110 && "text-destructive",
            coveragePct > 100 && coveragePct <= 110 && "text-amber-600",
            coveragePct <= 100 && "text-muted-foreground"
          )}
        >
          Budget: <span className="font-mono tabular-nums">{formatZar(priceCents)}</span>. Planned: <span className="font-mono tabular-nums">{formatZar(Math.round(planCents))}</span> (<span className="font-mono tabular-nums">{coveragePct.toFixed(0)}%</span>).
        </div>
      )}
    </div>
  );
}
