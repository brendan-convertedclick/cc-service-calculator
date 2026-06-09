import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Force-syncs ClickUp actuals. Pass a projectId to sync one retainer/project;
// omit it to sync all in-progress projects. Refreshes the retainers list and
// the retainer burn used by the Hours-used column.
export function useSyncActuals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId?: string): Promise<void> => {
      const { data, error } = await supabase.functions.invoke("sync-clickup-actuals", {
        body: projectId ? { project_id: projectId } : {},
      });
      if (error) throw error;
      const body = data as { error?: string } | null;
      if (body?.error) throw new Error(body.error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["retainers"] });
      qc.invalidateQueries({ queryKey: ["pulseRetainerBurn"] });
    },
  });
}
