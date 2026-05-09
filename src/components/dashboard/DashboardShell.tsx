import { useState } from "react";
import { useClientProjects } from "@/hooks/useClientProjects";
import { useOpsOverview } from "@/hooks/useOpsOverview";
import { useHiddenProjects } from "@/hooks/useHiddenProjects";
import { IconRail } from "@/components/nav/IconRail";
import { NavOverlay } from "@/components/nav/NavOverlay";
import { ProjectTree } from "./ProjectTree";
import { OpsOverview } from "./OpsOverview";
import { DashboardProjectView } from "./DashboardProjectView";

export function DashboardShell() {
  const { data: clientsData = [] } = useClientProjects();
  const opsData = useOpsOverview(clientsData);
  const { hiddenIds, hide } = useHiddenProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  const selectedClient = clientsData.find((c) =>
    c.projects.some((p) => p.id === selectedProjectId)
  );
  const selectedClientName = selectedClient?.name ?? "";

  function handleSelect(projectId: string) {
    setSelectedProjectId(projectId);
  }

  function handleComplete() {
    setSelectedProjectId(null);
  }

  return (
    <div className="grid h-screen grid-cols-[56px_240px_1fr] bg-m-surface-container-low overflow-hidden">
      {/* Column 1: icon rail */}
      <IconRail navOpen={navOpen} onToggle={() => setNavOpen((o) => !o)} />

      {/* Column 2: project tree */}
      <ProjectTree
        clientsData={clientsData}
        opsData={opsData}
        selectedProjectId={selectedProjectId}
        hiddenIds={hiddenIds}
        onSelect={handleSelect}
        onHide={hide}
      />

      {/* Column 3: detail or overview */}
      <main className="flex min-h-0 flex-col overflow-hidden bg-m-surface">
        {selectedProjectId ? (
          <DashboardProjectView
            key={selectedProjectId}
            projectId={selectedProjectId}
            clientName={selectedClientName}
            onComplete={handleComplete}
          />
        ) : (
          <OpsOverview opsData={opsData} onSelect={handleSelect} />
        )}
      </main>

      <NavOverlay open={navOpen} onClose={() => setNavOpen(false)} />
    </div>
  );
}
