import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type ProjectUpdate = Database["public"]["Tables"]["projects"]["Update"];
type Actual = Database["public"]["Views"]["project_actuals_current"]["Row"];

export type ProjectWithActuals = Project & { actuals: Actual[] };

// PostgREST stops at 1,000 rows without saying so, and the latest-snapshot view
// held 958 by November 2026: past that, projects would silently lose their tasks.
async function allCurrentActuals() {
  const PAGE = 1000;
  const data: Actual[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await supabase
      .from("project_actuals_current")
      .select("*")
      .order("project_id")
      .order("clickup_task_id")
      .range(from, from + PAGE - 1);
    if (res.error) return { data: null, error: res.error };
    data.push(...(res.data ?? []));
    if ((res.data ?? []).length < PAGE) return { data, error: null };
  }
}

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<ProjectWithActuals[]> => {
      const [projectsRes, actualsRes] = await Promise.all([
        supabase.from("projects").select("*").order("started_at", { ascending: false }),
        allCurrentActuals(),
      ]);
      if (projectsRes.error) throw projectsRes.error;
      if (actualsRes.error) throw actualsRes.error;

      const byProject = new Map<string, Actual[]>();
      for (const a of actualsRes.data ?? []) {
        if (!a.project_id) continue;
        const list = byProject.get(a.project_id) ?? [];
        list.push(a);
        byProject.set(a.project_id, list);
      }

      return (projectsRes.data ?? []).map((p) => ({
        ...p,
        actuals: byProject.get(p.id) ?? [],
      }));
    },
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: id ? ["project", id] : ["project", "none"],
    queryFn: async (): Promise<{ project: Project; actuals: Actual[] } | null> => {
      if (!id) return null;
      const [{ data: project, error: pErr }, actualsRes] = await Promise.all([
        supabase.from("projects").select("*").eq("id", id).single(),
        supabase
          .from("project_actuals_current")
          .select("*")
          .eq("project_id", id),
      ]);
      if (pErr) throw pErr;
      if (actualsRes.error) throw actualsRes.error;
      return { project, actuals: actualsRes.data ?? [] };
    },
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: ProjectUpdate }): Promise<Project> => {
      const { data, error } = await supabase
        .from("projects")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["project", vars.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
