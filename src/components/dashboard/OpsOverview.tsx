import { cn } from "@/lib/utils";
import type { OpsOverviewData, OpsProject } from "@/hooks/useOpsOverview";
import type { DeliveryRate } from "@/hooks/useDeliveryRate";
import type { DftCycleTime } from "@/hooks/useAvgDftCycleTime";
import { useClientMargin } from "@/hooks/useClientMargin";
import type { ScopeFilter } from "./ProjectTree";

const scopeStatusColor: Record<string, string> = {
  on_track: "bg-m-tertiary-container text-m-on-tertiary-container",
  needs_attention: "bg-amber-100 text-amber-800",
  overdue: "bg-m-error-container text-m-on-error-container",
};

const scopeStatusDot: Record<string, string> = {
  on_track: "bg-m-tertiary",
  needs_attention: "bg-amber-400",
  overdue: "bg-m-error",
};

interface ProjectRowProps {
  project: OpsProject;
  onSelect: (id: string) => void;
}

function OpsProjectRow({ project, onSelect }: ProjectRowProps) {
  return (
    <button
      onClick={() => onSelect(project.id)}
      className="flex w-full items-center gap-3 rounded-lg border border-m-outline-variant bg-m-surface px-4 py-3 text-left transition-colors hover:bg-m-surface-container"
    >
      <span
        className={cn("h-2.5 w-2.5 shrink-0 rounded-full", scopeStatusDot[project.scopeStatus] ?? "bg-gray-400")}
      />
      <span className="flex-1 min-w-0">
        <span className="text-label-medium text-m-on-surface font-medium">{project.clientName}</span>
        <span className="mx-1 text-m-on-surface-variant">—</span>
        <span className="text-label-medium text-m-on-surface">{project.name}</span>
        {project.reasonText && (
          <span className="text-label-small text-m-on-surface-variant italic ml-1">{project.reasonText}</span>
        )}
      </span>
      <span className={cn("shrink-0 rounded px-2 py-0.5 text-label-small", scopeStatusColor[project.scopeStatus] ?? "bg-m-surface-container text-m-on-surface-variant")}>
        {project.scopeStatus.replace(/_/g, " ")}
      </span>
      <span className="shrink-0 text-label-small text-m-on-surface-variant">{project.engagementType}</span>
    </button>
  );
}

interface Props {
  opsData: OpsOverviewData;
  onSelect: (id: string) => void;
  monthlyHours: number | null;
  deliveryRate: DeliveryRate | null;
  dftCycleTime: DftCycleTime | null;
  scopeFilter: ScopeFilter;
  onScopeFilterChange: (f: ScopeFilter) => void;
}

const zarFormat = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 });
function fmtZAR(cents: number) {
  return zarFormat.format(cents / 100);
}

const ragDot: Record<string, string> = {
  green: "bg-green-500",
  amber: "bg-amber-400",
  red: "bg-red-500",
};

function MarginSection() {
  const { data: marginRows, isLoading, connectionStatus, hasInvoices } = useClientMargin();

  if (isLoading) {
    return <p className="text-body-small text-m-on-surface-variant">Loading margin data…</p>;
  }

  if (!connectionStatus?.connected) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-m-outline-variant bg-m-surface-container p-4">
        <div className="flex-1">
          <p className="text-body-small text-m-on-surface">Xero not connected</p>
          <p className="text-label-small text-m-on-surface-variant">
            Connect Xero to see client margin data.
          </p>
        </div>
        <a
          href="/settings?connect=xero"
          className="shrink-0 rounded-full bg-m-primary px-4 py-1.5 text-label-medium font-semibold text-m-on-primary transition-colors hover:opacity-90"
        >
          Connect Xero
        </a>
      </div>
    );
  }

  if (!hasInvoices) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-m-outline-variant bg-m-surface-container p-4">
        <p className="text-body-small text-m-on-surface-variant">
          No invoices synced yet — run sync from{" "}
          <a href="/settings" className="underline">
            Settings
          </a>
          .
        </p>
      </div>
    );
  }

  if (!marginRows || marginRows.length === 0) {
    return (
      <p className="text-body-small text-m-on-surface-variant">
        No margin data for the last 30 days.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-m-outline-variant">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-m-outline-variant bg-m-surface-container">
            <th className="px-4 py-2.5 text-left text-label-small font-semibold text-m-on-surface-variant uppercase tracking-wide">
              Client
            </th>
            <th className="px-4 py-2.5 text-right text-label-small font-semibold text-m-on-surface-variant uppercase tracking-wide">
              Revenue
            </th>
            <th className="px-4 py-2.5 text-right text-label-small font-semibold text-m-on-surface-variant uppercase tracking-wide">
              Cost
            </th>
            <th className="px-4 py-2.5 text-right text-label-small font-semibold text-m-on-surface-variant uppercase tracking-wide">
              Margin %
            </th>
            <th className="px-4 py-2.5 text-right text-label-small font-semibold text-m-on-surface-variant uppercase tracking-wide">
              vs Target
            </th>
          </tr>
        </thead>
        <tbody>
          {marginRows.map((row) => (
            <tr
              key={row.clientId}
              className="border-b border-m-outline-variant last:border-0 hover:bg-m-surface-container"
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      ragDot[row.rag] ?? "bg-gray-400",
                    )}
                  />
                  <span className="text-body-small font-medium text-m-on-surface">
                    {row.clientName}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-right text-body-small text-m-on-surface">
                {fmtZAR(row.revenueCents)}
              </td>
              <td className="px-4 py-3 text-right text-body-small text-m-on-surface">
                {fmtZAR(row.costCents)}
              </td>
              <td className="px-4 py-3 text-right text-body-small font-medium text-m-on-surface">
                {row.marginPct !== null ? `${row.marginPct.toFixed(1)}%` : "—"}
              </td>
              <td className="px-4 py-3 text-right text-body-small text-m-on-surface-variant">
                {row.marginPct !== null
                  ? `${row.marginPct - row.targetPct >= 0 ? "+" : ""}${(row.marginPct - row.targetPct).toFixed(1)}pp`
                  : `target ${row.targetPct}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OpsOverview({ opsData, onSelect, monthlyHours, deliveryRate, dftCycleTime, scopeFilter, onScopeFilterChange }: Props) {
  const today = new Date().toLocaleDateString("en-ZA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex flex-col gap-6 overflow-auto p-6">
      {/* Header */}
      <div>
        <h1 className="text-headline-small text-m-on-surface">Operations overview</h1>
        <p className="mt-1 text-body-small text-m-on-surface-variant">
          {today} · {opsData.totalActiveProjects} active project{opsData.totalActiveProjects !== 1 ? "s" : ""} across{" "}
          {opsData.totalActiveClients} client{opsData.totalActiveClients !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Health cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <button
          onClick={() => onScopeFilterChange(scopeFilter === "on_track" ? "all" : "on_track")}
          className={cn(
            "rounded-lg border p-4 text-left transition-all hover:ring-2 hover:ring-m-tertiary",
            scopeFilter === "on_track"
              ? "border-m-tertiary bg-m-tertiary-container ring-2 ring-m-tertiary"
              : "border-m-outline-variant bg-m-tertiary-container"
          )}
        >
          <div className="text-display-small text-m-on-tertiary-container">{opsData.onTrackCount}</div>
          <div className="mt-1 text-label-small font-semibold text-m-on-tertiary-container">On track</div>
        </button>
        <button
          onClick={() => onScopeFilterChange(scopeFilter === "needs_attention" ? "all" : "needs_attention")}
          className={cn(
            "rounded-lg border p-4 text-left transition-all hover:ring-2 hover:ring-amber-400",
            scopeFilter === "needs_attention"
              ? "border-amber-400 bg-amber-50 ring-2 ring-amber-400"
              : "border-amber-200 bg-amber-50"
          )}
        >
          <div className="text-display-small text-amber-800">{opsData.needsAttentionCount}</div>
          <div className="mt-1 text-label-small font-semibold text-amber-700">Needs attention</div>
        </button>
        <button
          onClick={() => onScopeFilterChange(scopeFilter === "overdue" ? "all" : "overdue")}
          className={cn(
            "rounded-lg border p-4 text-left transition-all hover:ring-2 hover:ring-m-error",
            scopeFilter === "overdue"
              ? "border-m-error bg-m-error-container ring-2 ring-m-error"
              : "border-m-outline-variant bg-m-error-container"
          )}
        >
          <div className="text-display-small text-m-on-error-container">{opsData.overdueCount}</div>
          <div className="mt-1 text-label-small font-semibold text-m-on-error-container">Overdue</div>
        </button>
        <div className="rounded-lg border border-m-outline-variant bg-m-surface-container p-4">
          <div className="text-display-small text-m-on-surface">
            {monthlyHours !== null ? `${monthlyHours}h` : "—"}
          </div>
          <div className="mt-1 text-label-small font-semibold text-m-on-surface-variant">
            Burned this month
          </div>
        </div>

        {/* On-time delivery card */}
        {(() => {
          const rate = deliveryRate;
          const ragColor =
            rate === null || rate.total === 0
              ? "border-m-outline-variant bg-m-surface-container"
              : rate.rate >= 90
                ? "border-green-200 bg-green-50"
                : rate.rate >= 70
                  ? "border-amber-200 bg-amber-50"
                  : "border-red-200 bg-red-50";
          const textColor =
            rate === null || rate.total === 0
              ? "text-m-on-surface"
              : rate.rate >= 90
                ? "text-green-800"
                : rate.rate >= 70
                  ? "text-amber-800"
                  : "text-red-800";
          const labelColor =
            rate === null || rate.total === 0
              ? "text-m-on-surface-variant"
              : rate.rate >= 90
                ? "text-green-700"
                : rate.rate >= 70
                  ? "text-amber-700"
                  : "text-red-700";
          return (
            <div className={cn("rounded-lg border p-4", ragColor)}>
              <div className={cn("text-display-small", textColor)}>
                {rate === null || rate.total === 0 ? "—" : `${rate.rate}%`}
              </div>
              <div className={cn("mt-1 text-label-small font-semibold", labelColor)}>
                On-time delivery
              </div>
              {rate !== null && rate.total > 0 && (
                <div className="mt-0.5 text-label-small text-m-on-surface-variant">
                  {rate.onTime}/{rate.total} this month
                </div>
              )}
            </div>
          );
        })()}

        {/* Avg brief→DFT cycle time card */}
        <div className="rounded-lg border border-m-outline-variant bg-m-surface-container p-4">
          <div className="text-display-small text-m-on-surface">
            {dftCycleTime === null || dftCycleTime.avgDays === null
              ? "—"
              : `${dftCycleTime.avgDays}d`}
          </div>
          <div className="mt-1 text-label-small font-semibold text-m-on-surface-variant">
            Avg brief→DFT
          </div>
          {dftCycleTime !== null && dftCycleTime.avgDays !== null ? (
            <div className="mt-0.5 text-label-small text-m-on-surface-variant">
              ({dftCycleTime.sampleSize} project{dftCycleTime.sampleSize !== 1 ? "s" : ""})
            </div>
          ) : (
            <div className="mt-0.5 text-label-small text-m-on-surface-variant">
              Baseline: no data yet
            </div>
          )}
        </div>
      </div>

      {/* Needs attention */}
      {opsData.attentionProjects.length > 0 && (
        <section>
          <h2 className="mb-3 text-label-large font-bold uppercase tracking-wide text-m-on-surface-variant">
            ⚡ Needs your attention
          </h2>
          <div className="flex flex-col gap-2">
            {opsData.attentionProjects.map((p) => (
              <OpsProjectRow key={p.id} project={p} onSelect={onSelect} />
            ))}
          </div>
        </section>
      )}

      {/* Recently active */}
      {opsData.recentProjects.length > 0 && (
        <section>
          <h2 className="mb-3 text-label-large font-bold uppercase tracking-wide text-m-on-surface-variant">
            Recent projects
          </h2>
          <div className="flex flex-col gap-2">
            {opsData.recentProjects.map((p) => (
              <OpsProjectRow key={p.id} project={p} onSelect={onSelect} />
            ))}
          </div>
        </section>
      )}

      {opsData.totalActiveProjects === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-body-medium text-m-on-surface-variant">No active projects</p>
          <p className="mt-1 text-label-small text-m-on-surface-variant">
            Projects will appear here once they're in progress.
          </p>
        </div>
      )}

      {/* Margin summary */}
      <section>
        <h2 className="mb-3 text-label-large font-bold uppercase tracking-wide text-m-on-surface-variant">
          Client margin — rolling 30 days
        </h2>
        <MarginSection />
      </section>
    </div>
  );
}
