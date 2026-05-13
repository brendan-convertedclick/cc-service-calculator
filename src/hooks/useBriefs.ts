import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];
type BriefInsert = Database["public"]["Tables"]["briefs"]["Insert"];
type BriefUpdate = Database["public"]["Tables"]["briefs"]["Update"];
const DETAIL = (id: string) => ["briefs", "detail", id] as const;

export type BriefScope = "new" | "mine" | "unassigned" | "waiting" | "all" | "archived";

export type BriefFilterOptions = {
  clientId?: string | null;   // undefined = no filter; null = unassigned only
  contactEmail?: string;
};

export type BriefSortDirection = "desc" | "asc";

export function useBriefs(
  scope: BriefScope = "all",
  currentUserId?: string | null,
  filterOptions?: BriefFilterOptions,
  sortDirection: BriefSortDirection = "desc",
) {
  const ascending = sortDirection === "asc";
  return useQuery({
    queryKey: [
      "briefs",
      scope,
      currentUserId ?? "anon",
      filterOptions?.clientId ?? "any",
      filterOptions?.contactEmail ?? "any",
      sortDirection,
    ],
    queryFn: async (): Promise<Brief[]> => {
      let q = supabase
        .from("briefs")
        .select("*")
        .order("last_message_at", { ascending, nullsFirst: ascending })
        .order("received_at", { ascending });

      if (scope === "new") {
        q = q.eq("status", "new");
      } else if (scope === "mine") {
        if (!currentUserId) return [];
        q = q.eq("assignee_id", currentUserId).neq("status", "archived");
      } else if (scope === "unassigned") {
        q = q.is("assignee_id", null).not("status", "in", '("accepted","rejected","archived","spam")');
      } else if (scope === "waiting") {
        q = q.eq("status", "needs_info");
      } else if (scope === "archived") {
        q = q.eq("status", "archived");
      } else if (scope === "all") {
        q = q.neq("status", "archived");
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
