import { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardProjectRow } from "./DashboardProjectRow";
import type { ClientWithProjects } from "@/hooks/useClientProjects";
import type { OpsOverviewData } from "@/hooks/useOpsOverview";

interface Props {
  clientsData: ClientWithProjects[];
  opsData: OpsOverviewData;
  selectedProjectId: string | null;
  hiddenIds: Set<string>;
  lastBriefActivity: Map<string, string>;
  onSelect: (projectId: string) => void;
  onHide: (projectId: string) => void;
}

type ScopeFilter = "all" | "on_track" | "needs_attention" | "overdue";

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
    <div className="mb-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-label-small uppercase tracking-wide text-m-on-surface-variant hover:text-m-on-surface transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
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

export function ProjectTree({ clientsData, opsData, selectedProjectId, hiddenIds, lastBriefActivity, onSelect, onHide }: Props) {
  const [filterText, setFilterText] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [showCompleted, setShowCompleted] = useState(false);

  const pillClasses = (filter: ScopeFilter, active: string, inactive: string) =>
    cn(
      "cursor-pointer rounded px-2 py-0.5 text-label-small transition-colors",
      scopeFilter === filter ? active : inactive
    );

  return (
    <div className="flex flex-col border-r border-m-outline-variant bg-m-surface-container-low overflow-hidden">
      {/* Header */}
      <div className="border-b border-m-outline-variant px-3 pt-4 pb-2">
        <p className="mb-2 px-1 text-label-small uppercase tracking-wide text-m-on-surface-variant">
          Projects
        </p>
        <input
          type="text"
          placeholder="Filter…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="w-full rounded-md border border-m-outline-variant bg-m-surface px-2 py-1.5 text-label-medium text-m-on-surface placeholder:text-m-on-surface-variant focus:outline-none focus:ring-1 focus:ring-m-primary"
        />
        <button
          onClick={() => setShowCompleted((v) => !v)}
          title={showCompleted ? "Hide completed" : "Show completed"}
          className={cn(
            "mt-1.5 flex items-center gap-1 rounded px-2 py-1 text-label-small transition-colors",
            showCompleted
              ? "bg-m-primary-container text-m-on-primary-container"
              : "text-m-on-surface-variant hover:bg-m-surface-container"
          )}
        >
          <CheckCircle className="h-3.5 w-3.5" />
          <span>Completed</span>
        </button>
      </div>

      {/* Health pills */}
      <div className="flex flex-wrap gap-1.5 border-b border-m-outline-variant px-3 py-2">
        <button
          onClick={() => setScopeFilter("on_track")}
          className={pillClasses("on_track", "bg-green-200 text-green-900", "bg-green-50 text-green-700")}
        >
          {opsData.onTrackCount} on track
        </button>
        <button
          onClick={() => setScopeFilter("needs_attention")}
          className={pillClasses("needs_attention", "bg-amber-200 text-amber-900", "bg-amber-50 text-amber-700")}
        >
          {opsData.needsAttentionCount} ⚠
        </button>
        {opsData.overdueCount > 0 && (
          <button
            onClick={() => setScopeFilter("overdue")}
            className={pillClasses("overdue", "bg-red-200 text-red-900", "bg-red-50 text-red-700")}
          >
            {opsData.overdueCount} 🔴
          </button>
        )}
        {scopeFilter !== "all" && (
          <button
            onClick={() => setScopeFilter("all")}
            className="rounded px-2 py-0.5 text-label-small text-m-on-surface-variant hover:text-m-on-surface"
          >
            ✕ clear
          </button>
        )}
      </div>

      {/* Client sections */}
      <nav className="flex-1 overflow-y-auto px-1 py-2">
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
