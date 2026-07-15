import { useState } from "react";
import { useClientProjects } from "@/hooks/useClientProjects";
import { useOpsOverview } from "@/hooks/useOpsOverview";
import { useHiddenProjects } from "@/hooks/useHiddenProjects";
import { useMonthlyHoursBurned } from "@/hooks/useMonthlyHoursBurned";
import { useDeliveryRate } from "@/hooks/useDeliveryRate";
import { useAvgDftCycleTime } from "@/hooks/useAvgDftCycleTime";
import { useLastBriefActivity } from "@/hooks/useLastBriefActivity";
import { ProjectTree } from "./ProjectTree";
import { OpsOverview } from "./OpsOverview";
import { DashboardProjectView } from "./DashboardProjectView";

type ScopeFilter = "all" | "on_track" | "needs_attention" | "overdue";

export function DashboardShell() {
  const { data: clientsData = [] } = useClientProjects();
  const opsData = useOpsOverview(clientsData);
  const { hiddenIds, hide } = useHiddenProjects();
  const monthlyHours = useMonthlyHoursBurned();
  const deliveryRate = useDeliveryRate();
  const dftCycleTime = useAvgDftCycleTime();
  const lastBriefActivity = useLastBriefActivity();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");

  const selectedClient = clientsData.find((c) =>
    c.projects.some((p) => p.id === selectedProjectId)
  );
  const selectedClientName = selectedClient?.name ?? "";

  function handleSelect(projectId: string) {
    setSelectedProjectId(projectId);
  }

  function handleHide(projectId: string) {
    hide(projectId);
    if (projectId === selectedProjectId) setSelectedProjectId(null);
  }

  function handleComplete() {
    setSelectedProjectId(null);
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Project tree */}
      <ProjectTree
        clientsData={clientsData}
        opsData={opsData}
        selectedProjectId={selectedProjectId}
        hiddenIds={hiddenIds}
        lastBriefActivity={lastBriefActivity}
        scopeFilter={scopeFilter}
        onScopeFilterChange={setScopeFilter}
        onSelect={handleSelect}
        onHide={handleHide}
      />

      <main className="flex-1 flex min-h-0 flex-col overflow-hidden">
        {selectedProjectId ? (
          <DashboardProjectView
            key={selectedProjectId}
            projectId={selectedProjectId}
            clientName={selectedClientName}
            onComplete={handleComplete}
          />
        ) : (
          <OpsOverview
            opsData={opsData}
            clientsData={clientsData}
            lastBriefActivity={lastBriefActivity}
            onSelect={handleSelect}
            monthlyHours={monthlyHours}
            deliveryRate={deliveryRate}
            dftCycleTime={dftCycleTime}
          />
        )}
      </main>
    </div>
  );
}
