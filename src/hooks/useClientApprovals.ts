// src/hooks/useClientApprovals.ts
//
// Staff-side only: create a client_approvals row from a brief ("Send for
// client sign-off") and read back its latest state for the status readout on
// BriefedTaskPanel. Token issuance and the /review page are other agents'
// work — this hook only ever touches client_approvals.
//
// ponytail: client_approvals isn't in the generated Database type yet
// (migration 0139 lands separately, from a sibling agent in this same
// worktree) — cast the client for just these two calls, the same
// types-lag-reality workaround already used at the column level for
// margin_target_pct in Clients.tsx. Drop the cast once client_approvals is
// in src/types/db.ts and use supabase.from("client_approvals") directly.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import type { ReviewItemState } from "@/types/client-review";

export type ClientApprovalStatus = {
  id: string;
  client_title: string;
  ask: string;
  state: ReviewItemState;
  decided_at: string | null;
  decided_by_name: string | null;
  created_at: string;
};

const STATUS_COLUMNS = "id, client_title, ask, state, decided_at, decided_by_name, created_at";

const KEY = (briefId: string) => ["client-approval", briefId] as const;

/** The most recent client_approvals row for a brief, or null if none was ever sent. */
export function useLatestClientApproval(briefId: string | undefined) {
  return useQuery({
    queryKey: KEY(briefId ?? ""),
    enabled: !!briefId,
    queryFn: async (): Promise<ClientApprovalStatus | null> => {
      // `enabled` above guarantees this, but the compiler cannot see that.
      if (!briefId) return null;
      const { data, error } = await supabase
        .from("client_approvals")
        .select(STATUS_COLUMNS)
        .eq("brief_id", briefId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as ClientApprovalStatus | null;
    },
  });
}

export function useSendForClientSignoff() {
  const qc = useQueryClient();
  const { currentUserId } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      briefId: string;
      clientId: string;
      clientTitle: string;
      ask: string;
    }): Promise<ClientApprovalStatus> => {
      const { data, error } = await supabase
        .from("client_approvals")
        .insert({
          brief_id: input.briefId,
          client_id: input.clientId,
          client_title: input.clientTitle.trim(),
          ask: input.ask.trim(),
          created_by: currentUserId ?? null,
        })
        .select(STATUS_COLUMNS)
        .single();
      if (error) throw error;
      return data as ClientApprovalStatus;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: KEY(vars.briefId) });
    },
  });
}
