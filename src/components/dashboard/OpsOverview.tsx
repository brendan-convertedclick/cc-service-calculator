import { cn } from "@/lib/utils";
import type { OpsOverviewData, OpsProject } from "@/hooks/useOpsOverview";

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
}

export function OpsOverview({ opsData, onSelect, monthlyHours }: Props) {
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
