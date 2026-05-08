import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];
type BriefInsert = Database["public"]["Tables"]["briefs"]["Insert"];
type BriefUpdate = Database["public"]["Tables"]["briefs"]["Update"];
const DETAIL = (id: string) => ["briefs", "detail", id] as const;

export type BriefScope = "mine" | "unassigned" | "waiting" | "all";

export function useBriefs(scope: BriefScope = "all", currentUserId?: string | null) {
  return useQuery({
    queryKey: ["briefs", scope, currentUserId ?? "anon"],
    queryFn: async (): Promise<Brief[]> => {
      let q = supabase
        .from("briefs")
        .select("*")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .order("received_at", { ascending: false });

      if (scope === "mine") {
        if (!currentUserId) return [];
        q = q.eq("assignee_id", currentUserId);
      } else if (scope === "unassigned") {
        q = q.is("assignee_id", null).not("status", "in", '("accepted","rejected","archived","spam")');
      } else if (scope === "waiting") {
        q = q.eq("status", "needs_info");
      }

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useBrief(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: id ? DETAIL(id) : ["briefs", "none"],
    queryFn: async (): Promise<Brief | null> => {
      if (!id) return null;
      const { data, error } = await supabase.from("briefs").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BriefInsert) => {
      const { data, error } = await supabase.from("briefs").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["briefs"] }),
  });
}

export function useUpdateBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: BriefUpdate }) => {
      const { data, error } = await supabase
        .from("briefs").update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["briefs"] });
      qc.invalidateQueries({ queryKey: DETAIL(vars.id) });
    },
  });
}
