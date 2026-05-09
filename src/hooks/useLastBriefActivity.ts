import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useLastBriefActivity(): Map<string, string> {
  const { data } = useQuery({
    queryKey: ["lastBriefActivity"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("briefs")
        .select("parent_project_id, created_at")
        .not("parent_project_id", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Build map of projectId → most recent brief created_at
      const map = new Map<string, string>();
      for (const row of data ?? []) {
        if (row.parent_project_id && !map.has(row.parent_project_id)) {
          map.set(row.parent_project_id, row.created_at);
        }
      }
      return map;
    },
    staleTime: 5 * 60 * 1000,
  });
  return data ?? new Map();
}
