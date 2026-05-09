import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

export function useAssignBriefToProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      briefId,
      projectId,
    }: {
      briefId: string;
      projectId: string | null;
      previousProjectId?: string | null;
    }): Promise<Brief> => {
      const { data, error } = await supabase
        .from("briefs")
        .update({ parent_project_id: projectId, updated_at: new Date().toISOString() })
        .eq("id", briefId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["briefs", "inbox"] });
      qc.invalidateQueries({ queryKey: ["briefs"] });
      qc.invalidateQueries({ queryKey: ["clients", "withProjects"] });
      if (vars.projectId) {
        qc.invalidateQueries({ queryKey: ["projectActivity", vars.projectId] });
      }
      if (vars.previousProjectId) {
        qc.invalidateQueries({ queryKey: ["projectActivity", vars.previousProjectId] });
      }
    },
  });
}
