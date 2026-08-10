// src/components/reports/DeliveryScorecard.tsx
//
// Per-client delivery health for the selected billing cycle, shown at the top
// of the Reports page. Summarises how much briefed work was delivered, how much
// landed on time / over budget, and what's still open — the roll-up view of
// "did we cover everything briefed" at the one-task-per-deliverable grain.

import { ExternalLink, Flag } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useClientDeliveryScorecard } from "@/hooks/useClientDeliveryScorecard";
import { errorMessage } from "@/lib/utils";

interface DeliveryScorecardProps {
  clientId: string;
  cycleStartIso: string;
  cycleEndIso: string;
}

const DAY_MONTH = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short" });

function formatDue(dateStr: string | null): string {
  if (!dateStr) return "no due date";
  return DAY_MONTH.format(new Date(`${dateStr}T00:00:00`));
}

/** One headline metric in the stat strip. */
function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-m-primary"
      : tone === "bad"
        ? "text-m-error"
        : tone === "warn"
          ? "text-amber-500"
          : "text-m-on-surface";
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-title-medium font-semibold tabular-nums ${toneClass}`}>{value}</span>
      <span className="text-label-small text-m-on-surface-variant">{label}</span>
    </div>
  );
}

export function DeliveryScorecard({ clientId, cycleStartIso, cycleEndIso }: DeliveryScorecardProps) {
  const { data, isLoading, error } = useClientDeliveryScorecard(clientId, cycleStartIso, cycleEndIso);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 text-body-small text-m-on-surface-variant">
          Loading delivery scorecard…
        </CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="p-4 text-body-small text-m-error">
          Couldn’t load delivery scorecard: {errorMessage(error)}
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const ratePct = data.onTimeRate != null ? Math.round(data.onTimeRate * 100) : null;
  const rateTone =
    ratePct == null ? "secondary" : ratePct >= 90 ? "success" : ratePct >= 70 ? "warning" : "destructive";

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-title-medium">Delivery scorecard</h2>
          {ratePct != null ? (
            <Badge variant={rateTone} className="text-label-small">
              {ratePct}% on time
            </Badge>
          ) : (
            <span className="text-label-small text-m-on-surface-variant">
              Nothing delivered this cycle
            </span>
          )}
        </div>

        {/* Headline stats for work delivered inside the cycle. */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Delivered" value={String(data.delivered)} />
          <Stat label="On time" value={String(data.onTime)} tone={data.onTime > 0 ? "good" : "default"} />
          <Stat label="Late" value={String(data.late)} tone={data.late > 0 ? "bad" : "default"} />
          <Stat
            label="Over budget"
            value={String(data.overBudget)}
            tone={data.overBudget > 0 ? "warn" : "default"}
          />
        </div>

        {/* Two-clock split: our working time vs time waiting on the client. */}
        {data.avgTurnaroundDays != null && (
          <div className="rounded-md bg-m-surface-container-low p-3">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-body-small">
              <span className="text-label-small uppercase tracking-wide text-m-on-surface-variant">
                Turnaround
              </span>
              <span>
                <strong className="tabular-nums text-m-on-surface">{data.avgOurTimeDays ?? "—"}d</strong>{" "}
                <span className="text-m-on-surface-variant">our time</span>
              </span>
              <span aria-hidden className="text-m-on-surface-variant">
                +
              </span>
              <span>
                <strong className="tabular-nums text-amber-500">{data.avgClientWaitDays ?? "—"}d</strong>{" "}
                <span className="text-m-on-surface-variant">waiting on client</span>
              </span>
              <span className="text-m-on-surface-variant">
                = {data.avgTurnaroundDays}d total (avg)
              </span>
            </div>
            {data.clientCausedLate > 0 && (
              <p className="mt-1.5 text-label-small text-m-on-surface-variant">
                {data.clientCausedLate} of {data.late} late{" "}
                {data.late === 1 ? "delivery was" : "deliveries were"} client-caused — the overrun is
                covered by time spent awaiting client sign-off.
              </p>
            )}
          </div>
        )}

        {/* Open backlog — point-in-time, not cycle-bound. */}
        {data.openCount > 0 ? (
          <div className="rounded-md bg-m-surface-container-low p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-label-large text-m-on-surface">
                {data.openCount} still open
              </span>
              {data.overdueOpenCount > 0 && (
                <span className="inline-flex items-center gap-1 text-label-small text-m-error">
                  <Flag className="h-3.5 w-3.5" />
                  {data.overdueOpenCount} overdue
                </span>
              )}
            </div>
            <ul className="divide-y divide-m-outline-variant">
              {data.openTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 py-1.5">
                  {t.overdue && (
                    <span title="Past its due date" aria-label="Overdue">
                      <Flag className="h-3.5 w-3.5 shrink-0 text-m-error" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 break-words text-body-small text-m-on-surface">
                    {t.name}
                  </span>
                  {t.status_label && (
                    <span className="shrink-0 text-label-small text-m-on-surface-variant">
                      {t.status_label}
                    </span>
                  )}
                  <span
                    className={`shrink-0 text-label-small tabular-nums ${
                      t.overdue ? "text-m-error" : "text-m-on-surface-variant"
                    }`}
                  >
                    {formatDue(t.original_due_date)}
                  </span>
                  {t.clickup_task_url && (
                    <a
                      href={t.clickup_task_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${t.name} in ClickUp`}
                      className="shrink-0 text-m-primary hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-body-small text-m-on-surface-variant">No open briefed tasks — all caught up.</p>
        )}
      </CardContent>
    </Card>
  );
}
