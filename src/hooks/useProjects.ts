import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type ProjectUpdate = Database["public"]["Tables"]["projects"]["Update"];
type Actual = Database["public"]["Views"]["project_actuals_current"]["Row"];

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
