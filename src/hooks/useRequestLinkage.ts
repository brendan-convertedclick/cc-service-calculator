import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/** How the work is paid for. `null` = the task has no brief, so we don't know. */
export type BillingType = "retainer" | "adhoc";

export type LinkedProject = {
  id: string;
  name: string | null;
  status: string;
  engagementType: string;
  plannedHours: number;
  actualHours: number;
};

export type RequestLinkage = {
  billing: BillingType | null;
  briefId: string | null;
  project: LinkedProject | null;
  /**
   * Whether this task's own time reaches the retainer burn. Actuals only roll
   * up through `project_actuals_current`, so a task the sync hasn't mapped to a
   * project burns real hours that the numbers below never see.
   */
  countedInBurn: boolean;
};

/**
 * The commercial context behind an extension/revision request: is this work
 * already paid for by a retainer or separately billable, and is the bigger
 * thing it belongs to tracking well?
 *
 * A task reaches a project two ways — the brief it came from
 * (`briefs.parent_project_id`) or the actuals sync (`project_actuals_current`,
 * keyed by ClickUp task id). Most tasks have neither: they're standalone work
 * against the client's retainers, which is why the retainer burn is loaded
 * regardless and is the fallback answer to "what is this part of".
 *
 * Billing is deliberately `null` rather than a default when the task has no
 * brief — on an approval screen, guessing the common value is worse than
 * saying we don't know.
 *
 * For the same reason, every query below swallows its own `error` rather
 * than throwing: this is advisory context on an approval screen, and a
 * degraded/absent answer is preferable to blocking the approval on a
 * failed side query.
 */
export function useRequestLinkage(taskId: string, clientId: string | null) {
  return useQuery({
    queryKey: ["request-linkage", taskId, clientId],
    queryFn: async (): Promise<RequestLinkage> => {
      const [{ data: briefRows }, { data: actualRows }] = await Promise.all([
        supabase
          .from("briefs")
          .select("id, billing_type, parent_project_id")
          .eq("clickup_task_id", taskId)
          .limit(1),
        supabase
          .from("project_actuals_current")
          .select("project_id")
          .eq("clickup_task_id", taskId)
          .limit(1),
      ]);

      const brief = (briefRows ?? [])[0] as
        | { id: string; billing_type: string | null; parent_project_id: string | null }
        | undefined;
      const actual = (actualRows ?? [])[0] as { project_id: string | null } | undefined;
      const projectId = brief?.parent_project_id ?? actual?.project_id ?? null;

      const billing =
        brief?.billing_type === "adhoc" || brief?.billing_type === "retainer"
          ? brief.billing_type
          : null;

      const project = projectId ? await loadProject(projectId) : null;

      return {
        billing,
        briefId: brief?.id ?? null,
        project,
        countedInBurn: !!actual,
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}

async function loadProject(projectId: string): Promise<LinkedProject | null> {
  const [{ data: rows }, { data: actuals }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, status, engagement_type")
      .eq("id", projectId)
      .limit(1),
    supabase
      .from("project_actuals_current")
      .select("planned_hours, actual_hours")
      .eq("project_id", projectId),
  ]);
  const p = (rows ?? [])[0] as
    | { id: string; name: string | null; status: string; engagement_type: string }
    | undefined;
  if (!p) return null;

  const sums = (actuals ?? []) as Array<{ planned_hours: number | null; actual_hours: number | null }>;
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    engagementType: p.engagement_type,
    plannedHours: sums.reduce((s, r) => s + Number(r.planned_hours ?? 0), 0),
    actualHours: sums.reduce((s, r) => s + Number(r.actual_hours ?? 0), 0),
  };
}
