import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Project = Database["public"]["Tables"]["projects"]["Row"];
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
      const [{ data: project, error: pErr }, { data: actuals, error: aErr }] = await Promise.all([
        supabase.from("projects").select("*").eq("id", id).single(),
        supabase.from("project_actuals").select("*").eq("project_id", id),
      ]);
      if (pErr) throw pErr;
      if (aErr) throw aErr;
      return { project, actuals: actuals ?? [] };
    },
  });
}
