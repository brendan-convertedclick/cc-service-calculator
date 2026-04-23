import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BurnChart } from "@/components/BurnChart";
import { useProject } from "@/hooks/useProjects";
import { useDepartments } from "@/hooks/useDepartments";

function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      const { data, error } = await supabase.functions.invoke("sync-clickup-actuals", {
        body: { project_id: projectId },
      });
      if (error) throw error;
      return data as { inserted?: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["project"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`Synced — ${data?.inserted ?? 0} rows updated`);
    },
    onError: (e) => toast.error(e.message),
  });
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { data } = useProject(id);
  const { data: depts = [] } = useDepartments();
  const sync = useSyncNow();

  const rows = useMemo(() => {
    if (!data) return [];
    const byDept = new Map<string, { planned: number; actual: number }>();
    for (const a of data.actuals) {
      const key = a.dept_id ?? "unknown";
      const cur = byDept.get(key) ?? { planned: 0, actual: 0 };
      cur.planned += Number(a.planned_hours);
      cur.actual += Number(a.actual_hours);
      byDept.set(key, cur);
    }
    return Array.from(byDept.entries()).map(([dept_id, v]) => ({
      dept_name: depts.find((d) => d.id === dept_id)?.name ?? "Unknown",
      planned: v.planned,
      actual: v.actual,
    }));
  }, [data, depts]);

  if (!data) return <div className="p-6">Loading…</div>;
  const { project, actuals } = data;

  const totalPlanned = rows.reduce((a, r) => a + r.planned, 0);
  const totalActual = rows.reduce((a, r) => a + r.actual, 0);

  return (
    <div className="container mx-auto max-w-4xl p-6 space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-headline-small">{project.name ?? "Untitled project"}</h1>
              <div className="text-label-small text-m-on-surface-variant">
                Started {new Date(project.started_at).toLocaleDateString("en-ZA")} · Status:{" "}
                {project.status}
              </div>
              <div className="mt-2">
                Planned: <strong>{totalPlanned.toFixed(1)}h</strong> · Actual:{" "}
                <strong>{totalActual.toFixed(1)}h</strong>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sync.mutate(project.id)}
              disabled={sync.isPending}
            >
              <RefreshCw className={`h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />
              {sync.isPending ? "Syncing…" : "Sync now"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <BurnChart rows={rows} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-2 text-title-small">Tasks</h2>
          <table className="w-full text-body-small">
            <thead>
              <tr className="text-left text-label-small text-m-on-surface-variant">
                <th className="py-1">Task</th>
                <th>Dept</th>
                <th>Planned</th>
                <th>Actual</th>
                <th>Status</th>
                <th>Synced</th>
              </tr>
            </thead>
            <tbody>
              {actuals.map((a) => (
                <tr key={a.id} className="border-t border-m-outline-variant">
                  <td className="py-1 font-mono text-xs">{a.clickup_task_id}</td>
                  <td>{depts.find((d) => d.id === a.dept_id)?.name ?? "—"}</td>
                  <td>{Number(a.planned_hours).toFixed(1)}</td>
                  <td>{Number(a.actual_hours).toFixed(1)}</td>
                  <td>{a.status_at_sync ?? "—"}</td>
                  <td>{a.synced_at ? new Date(a.synced_at).toLocaleTimeString("en-ZA") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
