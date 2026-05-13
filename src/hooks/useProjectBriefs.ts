import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

export type Brief = Database["public"]["Tables"]["briefs"]["Row"];

const KEY = (projectId: string) => ["briefs", "byProject", projectId] as const;

export function useProjectBriefs(projectId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    enabled: !!projectId,
    queryKey: projectId ? KEY(projectId) : ["briefs", "byProject", "none"],
    queryFn: async (): Promise<Brief[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("briefs")
        .select("*")
        .eq("parent_project_id", projectId)
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`briefs:project:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "briefs",
          filter: `parent_project_id=eq.${projectId}`,
        },
        () => qc.invalidateQueries({ queryKey: KEY(projectId) }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, qc]);

  return query;
}
