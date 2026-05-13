import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type ProjectProfitabilityRow = {
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  quotedCents: number;
  costCents: number;
  marginCents: number;
  marginPct: number | null;
  targetPct: number;
  rag: "green" | "amber" | "red";
};

export function useProjectProfitability() {
  return useQuery({
    queryKey: ["projectProfitability"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ProjectProfitabilityRow[]> => {
      const { data: projects, error: projectsError } = await supabase
        .from("projects")
        .select("id, quote_id, client_id, name")
        .eq("status", "in_progress");
      if (projectsError) throw projectsError;
      if (!projects || projects.length === 0) return [];

      const projectIds = projects.map((p) => p.id);
      const quoteIds = projects.map((p) => p.quote_id).filter(Boolean);
      const clientIds = [...new Set(projects.map((p) => p.client_id))];

      const [quotesRes, actualsRes, deptsRes, clientsRes] = await Promise.all([
        supabase
          .from("quotes")
          .select("id, total_cents")
          .in("id", quoteIds),
        supabase
          .from("project_actuals_current")
          .select("project_id, actual_hours, dept_id")
          .in("project_id", projectIds),
        supabase
          .from("departments")
          .select("id, cost_rate_cents, hourly_rate_cents"),
        supabase
          .from("clients")
          .select("id, name, margin_target_pct")
          .in("id", clientIds),
      ]);

      if (quotesRes.error) throw quotesRes.error;
      if (actualsRes.error) throw actualsRes.error;
      if (deptsRes.error) throw deptsRes.error;
      if (clientsRes.error) throw clientsRes.error;

      const quoteMap = new Map(
        (quotesRes.data ?? []).map((q) => [q.id, q.total_cents as number])
      );
      const deptMap = new Map(
        (deptsRes.data ?? []).map((d) => [
          d.id,
          {
            cost_rate_cents: d.cost_rate_cents as number | null,
            hourly_rate_cents: d.hourly_rate_cents as number | null,
          },
        ])
      );
      const clientMap = new Map(
        (clientsRes.data ?? []).map((c) => [
          c.id,
          {
            name: c.name as string,
            margin_target_pct: c.margin_target_pct as number | null,
          },
        ])
      );

      const actualsByProject = new Map<
        string,
        { actual_hours: number; dept_id: string }[]
      >();
      for (const row of actualsRes.data ?? []) {
        const list = actualsByProject.get(row.project_id) ?? [];
        list.push({ actual_hours: row.actual_hours, dept_id: row.dept_id });
        actualsByProject.set(row.project_id, list);
      }

      const rows: ProjectProfitabilityRow[] = projects.map((project) => {
        const totalCents = project.quote_id
          ? (quoteMap.get(project.quote_id) ?? 0)
          : 0;

        const actuals = actualsByProject.get(project.id) ?? [];
        const costCents = actuals.reduce((sum, a) => {
          const dept = deptMap.get(a.dept_id);
          const rate = dept
            ? (dept.cost_rate_cents ?? dept.hourly_rate_cents ?? 0)
            : 0;
          return sum + a.actual_hours * rate;
        }, 0);

        const marginCents = totalCents - costCents;

        let marginPct: number | null;
        if (totalCents === 0) {
          marginPct = null;
        } else if (actuals.length === 0) {
          marginPct = 100;
        } else {
          marginPct = (marginCents / totalCents) * 100;
        }

        const client = clientMap.get(project.client_id);
        const targetPct = client?.margin_target_pct ?? 40;

        let rag: "green" | "amber" | "red";
        if (marginPct === null) {
          rag = "red";
        } else if (marginPct >= targetPct) {
          rag = "green";
        } else if (marginPct >= targetPct - 5) {
          rag = "amber";
        } else {
          rag = "red";
        }

        return {
          projectId: project.id,
          projectName: project.name,
          clientId: project.client_id,
          clientName: client?.name ?? "",
          quotedCents: totalCents,
          costCents: Math.round(costCents),
          marginCents: Math.round(marginCents),
          marginPct,
          targetPct,
          rag,
        };
      });

      return rows.sort((a, b) => {
        if (a.marginPct === null && b.marginPct === null) return 0;
        if (a.marginPct === null) return 1;
        if (b.marginPct === null) return -1;
        return b.marginPct - a.marginPct;
      });
    },
  });
}
