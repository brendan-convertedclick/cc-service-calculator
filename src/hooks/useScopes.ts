import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Scope = Database["public"]["Tables"]["scopes"]["Row"];
type ScopeInsert = Database["public"]["Tables"]["scopes"]["Insert"];

const KEY = (briefId: string) => ["scope", briefId] as const;

export function useScope(briefId: string | undefined) {
  return useQuery({
    enabled: !!briefId,
    queryKey: briefId ? KEY(briefId) : ["scope", "none"],
    queryFn: async (): Promise<Scope | null> => {
      if (!briefId) return null;
      const { data, error } = await supabase
        .from("scopes").select("*").eq("brief_id", briefId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useUpsertScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ScopeInsert) => {
      const { data, error } = await supabase
        .from("scopes")
        .upsert({ ...input, updated_at: new Date().toISOString() }, { onConflict: "brief_id" })
        .select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: KEY(vars.brief_id) }),
  });
}
