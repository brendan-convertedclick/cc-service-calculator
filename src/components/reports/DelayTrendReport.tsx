// src/components/reports/DelayTrendReport.tsx
//
// "Delays: client vs internal" report. Splits late deliveries by cause (our
// team vs the client sitting on things) and trends it by delivery month, so you
// can say "we deliver well — X days of every job is them, not us".

import { ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDelayTrend } from "@/hooks/useDelayTrend";
import { errorMessage } from "@/lib/utils";

interface DelayTrendReportProps {
  clientId: string;
  cycleStartIso: string;
  cycleEndIso: string;
}

const DAY_MONTH = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short" });
function fmtDate(dateStr: string): string {
  return DAY_MONTH.format(new Date(`${dateStr}T00:00:00`));
}

function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "bad" | "warn" }) {
  const cls = tone === "bad" ? "text-m-error" : tone === "warn" ? "text-amber-500" : "text-m-on-surface";
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-title-medium font-semibold tabular-nums ${cls}`}>{value}</span>
      <span className="text-label-small text-m-on-surface-variant">{label}</span>
    </div>
  );
}

export function DelayTrendReport({ clientId, cycleStartIso, cycleEndIso }: DelayTrendReportProps) {
  const { data, isLoading, error } = useDelayTrend(clientId, cycleStartIso, cycleEndIso);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 text-body-small text-m-on-surface-variant">Loading delays…</CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="p-4 text-body-small text-m-error">
          Couldn’t load the delay report: {errorMessage(error)}
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const totalLate = data.internalLate + data.clientLate;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-title-medium">Delays — client vs internal</h2>
            {data.delivered === 0 && (
              <span className="text-label-small text-m-on-surface-variant">Nothing delivered this period</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Delivered" value={String(data.delivered)} />
            <Stat label="On time" value={String(data.onTime)} />
            <Stat label="Internal late" value={String(data.internalLate)} tone={data.internalLate > 0 ? "bad" : "default"} />
            <Stat label="Client late" value={String(data.clientLate)} tone={data.clientLate > 0 ? "warn" : "default"} />
            <Stat
              label="Avg client wait"
              value={data.avgClientWaitDays != null ? `${data.avgClientWaitDays}d` : "—"}
              tone={data.avgClientWaitDays ? "warn" : "default"}
            />
          </div>

          {totalLate > 0 ? (
            <p className="text-body-small text-m-on-surface-variant">
              Of {totalLate} late {totalLate === 1 ? "delivery" : "deliveries"},{" "}
              <strong className="text-m-error">{data.internalLate} internal</strong> and{" "}
              <strong className="text-amber-500">{data.clientLate} client-caused</strong>. Avg split per job:{" "}
              <strong className="text-m-on-surface">{data.avgOurTimeDays ?? "—"}d</strong> our time +{" "}
              <strong className="text-amber-500">{data.avgClientWaitDays ?? "—"}d</strong> waiting on client.
            </p>
          ) : (
            <p className="text-body-small text-m-on-surface-variant">No late deliveries in this period.</p>
          )}
        </CardContent>
      </Card>

      {/* Monthly trend */}
      {data.months.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 text-title-small">By delivery month</h3>
            <div className="space-y-2.5">
              {data.months.map((m) => {
                const late = m.internalLate + m.clientLate;
                const denom = Math.max(m.delivered, 1);
                return (
                  <div key={m.month} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-label-small tabular-nums text-m-on-surface-variant">
                      {m.label}
                    </span>
                    <div className="flex h-4 flex-1 overflow-hidden rounded-full bg-m-surface-container-high">
                      <div
                        className="bg-emerald-500/80"
                        style={{ width: `${(m.onTime / denom) * 100}%` }}
                        title={`${m.onTime} on time`}
                      />
                      <div
                        className="bg-amber-400"
                        style={{ width: `${(m.clientLate / denom) * 100}%` }}
                        title={`${m.clientLate} client-caused late`}
                      />
                      <div
                        className="bg-m-error"
                        style={{ width: `${(m.internalLate / denom) * 100}%` }}
                        title={`${m.internalLate} internal late`}
                      />
                    </div>
                    <span className="w-28 shrink-0 text-right text-label-small tabular-nums text-m-on-surface-variant">
                      {m.delivered} del · {late} late
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-label-small text-m-on-surface-variant">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" /> On time
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Client-caused late
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-m-error" /> Internal late
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Late tasks with cause */}
      {data.lateTasks.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-2 text-title-small">Late deliveries</h3>
            <ul className="divide-y divide-m-outline-variant">
              {data.lateTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 py-1.5">
                  <Badge
                    variant={t.cause === "client" ? "warning" : "destructive"}
                    className="shrink-0 text-label-small"
                  >
                    {t.cause === "client" ? "Client" : "Internal"}
                  </Badge>
                  <span className="min-w-0 flex-1 break-words text-body-small text-m-on-surface">{t.name}</span>
                  <span className="shrink-0 text-label-small tabular-nums text-m-on-surface-variant">
                    {t.daysLate}d late
                    {t.cause === "client" && ` · ${t.clientWaitDays}d waiting`}
                  </span>
                  <span className="hidden shrink-0 text-label-small tabular-nums text-m-on-surface-variant sm:inline">
                    {fmtDate(t.completed)}
                  </span>
                  {t.url && (
                    <a
                      href={t.url}
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
