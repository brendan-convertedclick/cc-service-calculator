import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { evaluatePattern } from "@/lib/senderRules";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];
type BriefInsert = Database["public"]["Tables"]["briefs"]["Insert"];
type BriefUpdate = Database["public"]["Tables"]["briefs"]["Update"];
const DETAIL = (id: string) => ["briefs", "detail", id] as const;

export type BriefScope = "mine" | "unassigned" | "waiting" | "all";

export type BriefFilterOptions = {
  clientId?: string | null;   // undefined = no filter; null = unassigned only
  contactEmail?: string;
};

export function useBriefs(
  scope: BriefScope = "all",
  currentUserId?: string | null,
  filterOptions?: BriefFilterOptions,
) {
  return useQuery({
    queryKey: [
      "briefs",
      scope,
      currentUserId ?? "anon",
      filterOptions?.clientId ?? "any",
      filterOptions?.contactEmail ?? "any",
    ],
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

      if (filterOptions?.clientId !== undefined) {
        if (filterOptions.clientId === null) {
          q = q.is("client_id", null);
        } else {
          q = q.eq("client_id", filterOptions.clientId);
        }
      }
      if (filterOptions?.contactEmail !== undefined) {
        q = q.eq("sender_email", filterOptions.contactEmail);
      }

      const { data, error } = await q;
      if (error) throw error;
      const briefs = data ?? [];

      // Safety-net filter: hide briefs whose sender is now covered by an active
      // block rule for the brief's client, even if they predate the rule and
      // weren't archived/deleted retroactively. MCP-side enforcement only
      // covers new intake.
      const clientIds = Array.from(
        new Set(briefs.map((b) => b.client_id).filter((id): id is string => !!id)),
      );
      if (clientIds.length === 0) return briefs;

      const { data: blockRules, error: rErr } = await supabase
        .from("client_sender_rules")
        .select("client_id, pattern")
        .eq("mode", "block")
        .in("client_id", clientIds);
      if (rErr) throw rErr;
      if (!blockRules || blockRules.length === 0) return briefs;

      const byClient = new Map<string, string[]>();
      for (const r of blockRules) {
        const arr = byClient.get(r.client_id) ?? [];
        arr.push(r.pattern);
        byClient.set(r.client_id, arr);
      }

      return briefs.filter((b) => {
        if (!b.client_id || !b.sender_email) return true;
        const patterns = byClient.get(b.client_id);
        if (!patterns) return true;
        return !patterns.some((p) => evaluatePattern(p, b.sender_email!));
      });
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
