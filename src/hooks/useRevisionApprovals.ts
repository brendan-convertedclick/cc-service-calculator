import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Approval = Database["public"]["Tables"]["system_revision_approvals"]["Row"];

export const REVISION_APPROVALS_KEY = (systemId: string) =>
  ["system_revision_approvals", systemId] as const;

// Every sign-off across a system's revisions in one query — the revisions
// list renders them all at once, so one fetch keyed by system beats one per
// revision row.
export function useRevisionApprovals(systemId: string | undefined, revisionIds: string[]) {
  const ids = [...revisionIds].sort();
  return useQuery({
    enabled: !!systemId && ids.length > 0,
    queryKey: systemId ? REVISION_APPROVALS_KEY(systemId) : ["system_revision_approvals", "none"],
    queryFn: async (): Promise<Approval[]> => {
      const { data, error } = await supabase
        .from("system_revision_approvals")
        .select("*")
        .in("revision_id", ids)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
}

// Name an approver on a revision. `required` decides whether publishing
// waits for them (0126 enforces it in publish_system_revision).
export function useAddRevisionApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      systemId: string;
      revisionId: string;
      teamMemberId: string;
      required: boolean;
      approvedAt: string | null;
    }) => {
      const { error } = await supabase.from("system_revision_approvals").insert({
        revision_id: vars.revisionId,
        team_member_id: vars.teamMemberId,
        required: vars.required,
        approved_at: vars.approvedAt,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: REVISION_APPROVALS_KEY(vars.systemId) }),
  });
}

// Record (or clear) the moment someone completed their sign-off.
export function useSetRevisionApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { systemId: string; approvalId: string; approvedAt: string | null }) => {
      const { error } = await supabase
        .from("system_revision_approvals")
        .update({ approved_at: vars.approvedAt })
        .eq("id", vars.approvalId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: REVISION_APPROVALS_KEY(vars.systemId) }),
  });
}

export function useRemoveRevisionApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { systemId: string; approvalId: string }) => {
      const { error } = await supabase
        .from("system_revision_approvals")
        .delete()
        .eq("id", vars.approvalId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: REVISION_APPROVALS_KEY(vars.systemId) }),
  });
}
