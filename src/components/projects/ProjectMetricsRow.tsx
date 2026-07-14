import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { classifyProgress, maxPointsFromValue, type ProgressState } from "@/lib/sprint-points";
import type { ProjectRollup } from "@/hooks/useProjectRollups";

type Props = {
  project: {
    id: string;
    name?: string | null;
    started_at: string;
    status: string;
    engagement_type: string;
    is_recurring: boolean;
    retainer_monthly_fee_cents: number | null;
    quote_id: string | null;
  };
  /** Total project value in cents (from the linked quote). May be null. */
  projectValueCents: number | null;
  /** Internal vs client project (from is_internal flag on briefs / clients). */
  isInternal: boolean;
  rollup: ProjectRollup | null;
  /** Workspace standard point rate (cents per pt). */
  pointRateCents: number | null;
};

export function ProjectMetricsRow({
  project,
  projectValueCents,
  isInternal,
  rollup,
  pointRateCents,
}: Props) {
  const budgeted = rollup?.budgeted_points ?? 0;
  const actual = rollup?.actual_points ?? 0;
  const max = maxPointsFromValue(projectValueCents, pointRateCents);
  const state = classifyProgress(actual, budgeted, max);
  const isRetainer = project.is_recurring || project.retainer_monthly_fee_cents != null;

  return (
    <Link to={`/projects/${project.id}`} className="block">
      <Card className="transition-colors hover:bg-m-surface-container">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="truncate text-title-small text-m-on-surface">
                {project.name ?? "Untitled project"}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-label-small text-m-on-surface-variant">
                <span>
                  Started {new Date(project.started_at).toLocaleDateString("en-ZA")}
                </span>
                <span>·</span>
                <Badge variant={isInternal ? "muted" : "outline"}>
                  {isInternal ? "Internal" : "Client"}
                </Badge>
                <Badge variant="outline">{isRetainer ? "Retainer" : "Project"}</Badge>
              </div>
            </div>
            <Badge>{project.status}</Badge>
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr,auto] sm:items-center">
            <ProgressBar
              actual={actual}
              budgeted={budgeted}
              max={max}
              state={state}
            />
            <div className="flex items-center gap-3 text-label-small text-m-on-surface-variant whitespace-nowrap">
              <span>
                <strong className="text-m-on-surface font-mono tabular-nums">{actual.toFixed(1)}</strong> / <span className="font-mono tabular-nums">{budgeted.toFixed(1)}</span> pts
              </span>
              {max !== null && (
                <span>
                  cap <strong className="text-m-on-surface font-mono tabular-nums">{max.toFixed(1)}</strong>
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ProgressBar({
  actual,
  budgeted,
  max,
  state,
}: {
  actual: number;
  budgeted: number;
  max: number | null;
  state: ProgressState;
}) {
  // Total bar width = max(actual, budgeted, max). Render proportionally.
  const total = Math.max(actual, budgeted, max ?? 0, 1);
  const actualPct = Math.min(100, (actual / total) * 100);
  const budgetTick = Math.min(100, (budgeted / total) * 100);
  const maxTick = max !== null ? Math.min(100, (max / total) * 100) : null;

  const fillClass =
    state === "ok"
      ? "bg-emerald-500"
      : state === "warn"
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <div className="relative h-2 w-full rounded-full bg-m-surface-container">
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${fillClass} transition-all`}
        style={{ width: `${actualPct}%` }}
        role="progressbar"
        aria-valuenow={Math.round(actualPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Burn: ${actualPct.toFixed(0)}% of total budget cap`}
      />
      <span
        className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-m-on-surface"
        style={{ left: `${budgetTick}%` }}
        title={`Budgeted ${budgeted.toFixed(1)}pt`}
      />
      {maxTick !== null && (
        <span
          className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-rose-700"
          style={{ left: `${maxTick}%` }}
          title={`Max ${max?.toFixed(1)}pt`}
        />
      )}
    </div>
  );
}
