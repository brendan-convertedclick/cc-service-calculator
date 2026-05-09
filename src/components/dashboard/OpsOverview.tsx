import { cn } from "@/lib/utils";
import type { OpsOverviewData, OpsProject } from "@/hooks/useOpsOverview";
import type { DeliveryRate } from "@/hooks/useDeliveryRate";
import type { DftCycleTime } from "@/hooks/useAvgDftCycleTime";

const scopeStatusColor: Record<string, string> = {
  on_track: "bg-green-100 text-green-800",
  needs_attention: "bg-amber-100 text-amber-800",
  overdue: "bg-red-100 text-red-800",
};

const scopeStatusDot: Record<string, string> = {
  on_track: "bg-green-500",
  needs_attention: "bg-amber-400",
  overdue: "bg-red-500",
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
}

export function OpsOverview({ opsData, onSelect, monthlyHours, deliveryRate, dftCycleTime }: Props) {
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
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="text-display-small text-green-800">{opsData.onTrackCount}</div>
          <div className="mt-1 text-label-small font-semibold text-green-700">On track</div>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="text-display-small text-amber-800">{opsData.needsAttentionCount}</div>
          <div className="mt-1 text-label-small font-semibold text-amber-700">Needs attention</div>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="text-display-small text-red-800">{opsData.overdueCount}</div>
          <div className="mt-1 text-label-small font-semibold text-red-700">Overdue</div>
        </div>
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
    </div>
  );
}
