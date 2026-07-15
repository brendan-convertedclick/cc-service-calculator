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
  dueDate: string | null;
  reasonText: string;
};

export type OpsOverviewData = {
  totalActiveProjects: number;
  totalActiveClients: number;
  onTrackCount: number;
  needsAttentionCount: number;
  overdueCount: number;
  projects: OpsProject[];
  attentionProjects: OpsProject[];
  recentProjects: OpsProject[];
};

// A project past its due date is treated as overdue for lane placement,
// regardless of its stored scope_status.
const DAY_MS = 1000 * 60 * 60 * 24;
export const isPastDue = (dueDate: string | null): boolean =>
  dueDate != null && Math.ceil((new Date(dueDate).getTime() - Date.now()) / DAY_MS) < 0;

// The scope status used everywhere for lane/rollup placement: a past-due
// project counts as overdue no matter what its stored scope_status says.
export const effectiveScopeStatus = (project: {
  scope_status: string | null;
  due_date: string | null;
}): string => (isPastDue(project.due_date) ? "overdue" : project.scope_status ?? "on_track");

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
          scopeStatus: effectiveScopeStatus(p),
          engagementType: p.engagement_type ?? "fixed",
          startedAt: p.started_at,
          dueDate: p.due_date,
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
      projects: activeProjects,
      attentionProjects,
      recentProjects,
    };
  }, [clientsData]);
}
