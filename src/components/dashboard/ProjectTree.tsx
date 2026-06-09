import { useState } from "react";
import { ChevronRight, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardProjectRow } from "./DashboardProjectRow";
import type { ClientWithProjects } from "@/hooks/useClientProjects";
import type { OpsOverviewData } from "@/hooks/useOpsOverview";

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
  const [open, setOpen] = useState(true);

  const activeProjects = client.projects.filter((p) => {
    if (p.status !== "in_progress") return false;
    if (hiddenIds.has(p.id)) return false;
    if (scopeFilter !== "all" && p.scope_status !== scopeFilter) return false;
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
        className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-label-small font-medium uppercase tracking-wider text-m-on-surface-variant transition-colors hover:text-m-on-surface"
      >
        <ChevronRight className={cn("h-3 w-3 shrink-0 opacity-60 transition-transform", open && "rotate-90")} />
        <span className="truncate">{client.name}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-0.5 pl-2">
          {visibleProjects.map((p) => (
            <DashboardProjectRow
              key={p.id}
              id={p.id}
              name={p.name ?? "Untitled"}
              engagementType={p.engagement_type ?? "fixed"}
              scopeStatus={p.scope_status ?? "on_track"}
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

  const scopePill = (filter: ScopeFilter, dotClass: string, label: string, activeClasses: string) => (
    <button
      onClick={() => setScopeFilter(scopeFilter === filter ? "all" : filter)}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2 py-1 text-label-small transition-colors",
        scopeFilter === filter
          ? activeClasses
          : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
      {label}
    </button>
  );

  return (
    <div className="flex flex-col border-r border-m-outline-variant bg-m-surface-container-low overflow-hidden">
      {/* Header */}
      <div className="border-b border-m-outline-variant px-3 pb-3 pt-4">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-label-small font-medium uppercase tracking-wider text-m-on-surface-variant">
            Projects
          </p>
          <button
            onClick={() => setShowCompleted((v) => !v)}
            title={showCompleted ? "Hide completed" : "Show completed"}
            aria-pressed={showCompleted}
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
              showCompleted
                ? "bg-m-primary-container text-m-on-primary-container"
                : "text-m-on-surface-variant/70 hover:bg-m-surface-container hover:text-m-on-surface"
            )}
          >
            <CheckCircle className="h-3 w-3" />
            Completed
          </button>
        </div>
        <input
          type="text"
          placeholder="Filter…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="w-full rounded-md border border-m-outline-variant bg-m-surface px-2 py-1.5 text-label-medium text-m-on-surface placeholder:text-m-on-surface-variant focus:outline-none focus:ring-1 focus:ring-m-primary"
        />

        {/* Scope filter pills */}
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {scopePill(
            "on_track",
            "bg-m-tertiary",
            `${opsData.onTrackCount} on track`,
            "bg-m-tertiary-container text-m-on-tertiary-container"
          )}
          {scopePill(
            "needs_attention",
            "bg-amber-400",
            `${opsData.needsAttentionCount} attention`,
            "bg-amber-100 text-amber-900"
          )}
          {opsData.overdueCount > 0 &&
            scopePill(
              "overdue",
              "bg-m-error",
              `${opsData.overdueCount} overdue`,
              "bg-m-error-container text-m-on-error-container"
            )}
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
