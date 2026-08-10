import { useState } from "react";
import { ChevronRight, CheckCircle, CheckCheck, Search, TriangleAlert, CircleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DashboardProjectRow } from "./DashboardProjectRow";
import type { ClientWithProjects } from "@/hooks/useClientProjects";
import { effectiveScopeStatus, type OpsOverviewData } from "@/hooks/useOpsOverview";

export type ScopeFilter = "all" | "on_track" | "needs_attention" | "overdue";

interface Props {
  clientsData: ClientWithProjects[];
  opsData: OpsOverviewData;
  selectedProjectId: string | null;
  hiddenIds: Set<string>;
  lastBriefActivity: Map<string, string>;
  scopeFilter: ScopeFilter;
  onScopeFilterChange: (f: ScopeFilter) => void;
  onSelect: (projectId: string) => void;
  onHide: (projectId: string) => void;
}

function RollupStat({ icon: Icon, count, color }: { icon: LucideIcon; count: number; color: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-0.5 text-label-small font-medium tabular-nums",
        count > 0 ? color : "text-m-on-surface-variant/40",
      )}
    >
      <Icon className="h-3 w-3" />
      {count}
    </span>
  );
}

function ClientSection({
  client,
  selectedProjectId,
  hiddenIds,
  scopeFilter,
  filterText,
  showCompleted,
  lastBriefActivity,
  onSelect,
  onHide,
}: {
  client: ClientWithProjects;
  selectedProjectId: string | null;
  hiddenIds: Set<string>;
  scopeFilter: ScopeFilter;
  filterText: string;
  showCompleted: boolean;
  lastBriefActivity: Map<string, string>;
  onSelect: (id: string) => void;
  onHide: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  // Every active (in-progress, non-hidden) project for this client — the basis
  // for the collapsed-row status rollup, independent of the active scope filter.
  const inProgress = client.projects.filter(
    (p) => p.status === "in_progress" && !hiddenIds.has(p.id),
  );

  const rollup = {
    on_track: inProgress.filter((p) => effectiveScopeStatus(p) === "on_track").length,
    needs_attention: inProgress.filter((p) => effectiveScopeStatus(p) === "needs_attention").length,
    overdue: inProgress.filter((p) => effectiveScopeStatus(p) === "overdue").length,
    completed: client.projects.filter(
      (p) => p.status === "completed" && !hiddenIds.has(p.id),
    ).length,
  };

  const activeProjects = inProgress.filter((p) => {
    if (scopeFilter !== "all" && effectiveScopeStatus(p) !== scopeFilter) return false;
    if (filterText) {
      const q = filterText.toLowerCase();
      return p.name?.toLowerCase().includes(q) || client.name.toLowerCase().includes(q);
    }
    return true;
  });

  const completedProjects = showCompleted
    ? client.projects.filter((p) => {
        if (p.status !== "completed") return false;
        if (filterText) {
          const q = filterText.toLowerCase();
          return p.name?.toLowerCase().includes(q) || client.name.toLowerCase().includes(q);
        }
        return true;
      })
    : [];

  const visibleProjects = [...activeProjects, ...completedProjects];
  if (visibleProjects.length === 0) return null;

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-label-medium font-medium text-m-on-surface transition-colors hover:text-m-on-surface"
      >
        <ChevronRight className={cn("h-3 w-3 shrink-0 opacity-60 transition-transform", open && "rotate-90")} />
        <span className="min-w-0 flex-1 truncate text-left">{client.name}</span>
        {!open && (
          <span className="flex shrink-0 items-center gap-2 pl-2 normal-case tracking-normal">
            <RollupStat icon={CheckCircle} count={rollup.on_track} color="text-m-tertiary" />
            <RollupStat icon={TriangleAlert} count={rollup.needs_attention} color="text-amber-500" />
            <RollupStat icon={CircleAlert} count={rollup.overdue} color="text-m-error" />
            <RollupStat icon={CheckCheck} count={rollup.completed} color="text-green-600" />
          </span>
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-0.5 pl-2">
          {visibleProjects.map((p) => (
            <DashboardProjectRow
              key={p.id}
              id={p.id}
              name={p.name ?? "Untitled"}
              engagementType={p.engagement_type ?? "fixed"}
              scopeStatus={effectiveScopeStatus(p)}
              isSelected={p.id === selectedProjectId}
              isCompleted={p.status === "completed"}
              lastActivityAt={lastBriefActivity.get(p.id)}
              onSelect={p.status === "completed" ? () => {} : onSelect}
              onHide={onHide}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjectTree({ clientsData, opsData, selectedProjectId, hiddenIds, lastBriefActivity, scopeFilter, onScopeFilterChange, onSelect, onHide }: Props) {
  const [filterText, setFilterText] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const setScopeFilter = onScopeFilterChange;

  const completedCount = clientsData.reduce(
    (n, c) => n + c.projects.filter((p) => p.status === "completed" && !hiddenIds.has(p.id)).length,
    0,
  );

  const scopePill = (
    filter: ScopeFilter,
    Icon: LucideIcon,
    iconColor: string,
    label: string,
    activeClasses: string,
  ) => (
    <button
      onClick={() => setScopeFilter(scopeFilter === filter ? "all" : filter)}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md px-2 text-label-small transition-colors",
        scopeFilter === filter
          ? activeClasses
          : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", iconColor)} />
      {label}
    </button>
  );

  return (
    <div className="flex w-[442px] flex-col border-r border-m-outline-variant overflow-hidden">
      {/* Header */}
      <div className="border-b border-m-outline-variant px-3 pb-3 pt-4">
        <div className="mb-2 px-1">
          <p className="text-label-small font-medium uppercase tracking-wider text-m-on-surface-variant">
            Projects
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-m-on-surface-variant" />
          <Input
            aria-label="Filter projects"
            placeholder="Search…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* Scope filter pills */}
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {scopePill(
            "on_track",
            CheckCircle,
            "text-m-tertiary",
            `${opsData.onTrackCount} on track`,
            "bg-m-tertiary-container text-m-on-tertiary-container"
          )}
          {scopePill(
            "needs_attention",
            TriangleAlert,
            "text-amber-500",
            `${opsData.needsAttentionCount} attention`,
            "bg-amber-100 text-amber-900"
          )}
          {opsData.overdueCount > 0 &&
            scopePill(
              "overdue",
              CircleAlert,
              "text-m-error",
              `${opsData.overdueCount} overdue`,
              "bg-m-error-container text-m-on-error-container"
            )}
          <button
            onClick={() => setShowCompleted((v) => !v)}
            aria-pressed={showCompleted}
            title={showCompleted ? "Hide completed" : "Show completed"}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2 text-label-small transition-colors",
              showCompleted
                ? "bg-m-primary-container text-m-on-primary-container"
                : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
            )}
          >
            <CheckCheck className="h-3.5 w-3.5 text-green-600" />
            {completedCount} completed
          </button>
        </div>
      </div>

      {/* Client sections */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {clientsData.map((client) => (
          <ClientSection
            key={client.id}
            client={client}
            selectedProjectId={selectedProjectId}
            hiddenIds={hiddenIds}
            scopeFilter={scopeFilter}
            filterText={filterText}
            showCompleted={showCompleted}
            lastBriefActivity={lastBriefActivity}
            onSelect={onSelect}
            onHide={onHide}
          />
        ))}
      </nav>
    </div>
  );
}
