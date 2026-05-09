import { useMemo } from "react";
import type { ClientWithProjects } from "./useClientProjects";

export type OpsProject = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  scopeStatus: string;
  engagementType: string;
  startedAt: string;
  reasonText: string;
};

export type OpsOverviewData = {
  totalActiveProjects: number;
  totalActiveClients: number;
  onTrackCount: number;
  needsAttentionCount: number;
  overdueCount: number;
  attentionProjects: OpsProject[];
  recentProjects: OpsProject[];
};

export function useOpsOverview(clientsData: ClientWithProjects[]): OpsOverviewData {
  return useMemo(() => {
    const activeProjects: OpsProject[] = clientsData.flatMap((c) =>
      c.projects
        .filter((p) => p.status === "in_progress")
        .map((p) => ({
          id: p.id,
          name: p.name ?? "Untitled",
          clientId: c.id,
          clientName: c.name,
          scopeStatus: p.scope_status ?? "on_track",
          engagementType: p.engagement_type ?? "fixed",
          startedAt: p.started_at,
          reasonText: "",
        }))
    );

    const onTrackCount = activeProjects.filter((p) => p.scopeStatus === "on_track").length;
    const needsAttentionCount = activeProjects.filter((p) => p.scopeStatus === "needs_attention").length;
    const overdueCount = activeProjects.filter((p) => p.scopeStatus === "overdue").length;

    const attentionProjects = activeProjects
      .filter((p) => p.scopeStatus === "needs_attention" || p.scopeStatus === "overdue")
      .sort((a, b) => (a.scopeStatus === "overdue" ? -1 : b.scopeStatus === "overdue" ? 1 : 0))
      .map((p) => ({
        ...p,
        reasonText: p.scopeStatus === "overdue" ? "Overdue" : "Needs attention",
      }));

    const recentProjects = activeProjects
      .filter((p) => p.scopeStatus === "on_track")
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 5);

    const totalActiveClients = clientsData.filter((c) =>
      c.projects.some((p) => p.status === "in_progress")
    ).length;

    return {
      totalActiveProjects: activeProjects.length,
      totalActiveClients,
      onTrackCount,
      needsAttentionCount,
      overdueCount,
      attentionProjects,
      recentProjects,
    };
  }, [clientsData]);
}
