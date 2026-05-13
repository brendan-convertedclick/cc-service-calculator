import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { BriefMessage } from "@/hooks/useBriefMessages";

export function useMultiBriefMessages(briefIds: string[]) {
  const sortedKey = [...briefIds].sort().join(",");
  return useQuery({
    enabled: briefIds.length > 0,
    queryKey: ["brief_messages", "multi", sortedKey],
    queryFn: async (): Promise<BriefMessage[]> => {
      if (briefIds.length === 0) return [];
      const { data, error } = await supabase
        .from("brief_messages")
        .select("*")
        .in("brief_id", briefIds)
        .order("sent_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });
}
