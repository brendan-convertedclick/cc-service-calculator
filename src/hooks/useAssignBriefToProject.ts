import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

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
    }): Promise<{ ok: true; moved: boolean; seeded: boolean }> => {
      const { data, error } = await supabase.functions.invoke("set-brief-project", {
        body: { brief_id: briefId, project_id: projectId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { ok: true; moved: boolean; seeded: boolean };
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["briefs", "inbox"] });
      qc.invalidateQueries({ queryKey: ["briefs"] });
      qc.invalidateQueries({ queryKey: ["clients", "withProjects"] });
      // Refresh the project Tasks lists so a seeded/removed task shows up.
      qc.invalidateQueries({ queryKey: ["projects"] });
      if (vars.projectId) {
        qc.invalidateQueries({ queryKey: ["project", vars.projectId] });
        qc.invalidateQueries({ queryKey: ["projectActivity", vars.projectId] });
      }
      if (vars.previousProjectId) {
        qc.invalidateQueries({ queryKey: ["project", vars.previousProjectId] });
        qc.invalidateQueries({ queryKey: ["projectActivity", vars.previousProjectId] });
      }
    },
  });
}
