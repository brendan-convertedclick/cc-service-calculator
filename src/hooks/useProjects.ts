import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type ProjectUpdate = Database["public"]["Tables"]["projects"]["Update"];
// project_actuals_current (added in migration 0013) is `select * from project_actuals`
// with one row per (project_id, clickup_task_id) — the latest recorded_at. It has
// the same column shape as the base table, so we reuse Row here.
// TODO: regenerate src/types/db.ts after running the migration remotely; the view
// will then appear under Database["public"]["Views"] and this alias can be updated.
type Actual = Database["public"]["Tables"]["project_actuals"]["Row"];

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<Project[]> => {
      const { data, error } = await supabase
        .from("projects").select("*").order("started_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
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
        // Read "latest row per task" from the new view. The view isn't in the
        // generated Database types yet, so we cast at the .from() boundary and
        // again on the returned rows — both casts disappear once db.ts is
        // regenerated (see TODO above).
        supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from("project_actuals_current" as any)
          .select("*")
          .eq("project_id", id),
      ]);
      if (pErr) throw pErr;
      if (actualsRes.error) throw actualsRes.error;
      return { project, actuals: (actualsRes.data ?? []) as unknown as Actual[] };
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
