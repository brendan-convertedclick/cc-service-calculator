import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

export type BriefMessage = Database["public"]["Tables"]["brief_messages"]["Row"];

const KEY = (id: string) => ["brief_messages", id] as const;

export function useBriefMessages(briefId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    enabled: !!briefId,
    queryKey: briefId ? KEY(briefId) : ["brief_messages", "none"],
    queryFn: async (): Promise<BriefMessage[]> => {
      if (!briefId) return [];
      const { data, error } = await supabase
        .from("brief_messages")
        .select("*")
        .eq("brief_id", briefId)
        .order("sent_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!briefId) return;
    const channel = supabase
      .channel(`brief_messages:${briefId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "brief_messages", filter: `brief_id=eq.${briefId}` },
        () => qc.invalidateQueries({ queryKey: KEY(briefId) }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [briefId, qc]);

  return query;
}
