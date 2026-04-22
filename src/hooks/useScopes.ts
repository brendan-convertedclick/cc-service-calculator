import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Scope = Database["public"]["Tables"]["scopes"]["Row"];
type ScopeInsert = Database["public"]["Tables"]["scopes"]["Insert"];

export type ScopeWithBriefClient = Scope & {
  brief:
    | (Database["public"]["Tables"]["briefs"]["Row"] & {
        client: Database["public"]["Tables"]["clients"]["Row"] | null;
      })
    | null;
};

const KEY = (briefId: string) => ["scope", briefId] as const;
const KEY_BY_ID = (scopeId: string) => ["scope", "by-id", scopeId] as const;

export function useScope(briefId: string | undefined) {
  return useQuery({
    enabled: !!briefId,
    queryKey: briefId ? KEY(briefId) : ["scope", "none"],
    queryFn: async (): Promise<ScopeWithBriefClient | null> => {
      if (!briefId) return null;
      const { data, error } = await supabase
        .from("scopes")
        .select("*, brief:briefs(*, client:clients(*))")
        .eq("brief_id", briefId)
        .maybeSingle();
      if (error) throw error;
      return data as ScopeWithBriefClient | null;
    },
  });
}

export function useScopeById(scopeId: string | undefined) {
  return useQuery({
    enabled: !!scopeId,
    queryKey: scopeId ? KEY_BY_ID(scopeId) : ["scope", "by-id", "none"],
    queryFn: async (): Promise<ScopeWithBriefClient | null> => {
      if (!scopeId) return null;
      const { data, error } = await supabase
        .from("scopes")
        .select("*, brief:briefs(*, client:clients(*))")
        .eq("id", scopeId)
        .maybeSingle();
      if (error) throw error;
      return data as ScopeWithBriefClient | null;
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
