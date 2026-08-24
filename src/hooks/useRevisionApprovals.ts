import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Approval = Database["public"]["Tables"]["system_revision_approvals"]["Row"];

export const REVISION_APPROVALS_KEY = (systemId: string) =>
  ["system_revision_approvals", systemId] as const;
// Every write invalidates the whole prefix, not one system's key: the
// "waiting on" map the systems list draws faces from spans the library and
// hangs off a sibling key, so a per-system invalidation would leave a row
// still showing someone who has just signed.
const ALL_APPROVALS_KEY = ["system_revision_approvals"] as const;

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ALL_APPROVALS_KEY }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ALL_APPROVALS_KEY }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ALL_APPROVALS_KEY }),
  });
}

// Who a revision in review is still waiting on, across the whole library —
// keyed by system so the list can put faces on an "In review" row. Only
// required approvers who haven't signed: an optional one is a log entry
// nobody is held up by. Revisions proposed before the Send-for-review dialog
// collected approvers have no rows at all, so a row can legitimately be in
// review with nobody named.
export function useAwaitingApprovers() {
  return useQuery({
    queryKey: ["system_revision_approvals", "awaiting"] as const,
    queryFn: async (): Promise<Record<string, string[]>> => {
      const { data, error } = await supabase
        .from("system_revision_approvals")
        .select("team_member_id, system_revisions!inner(system_id, state)")
        .eq("required", true)
        .is("approved_at", null)
        .eq("system_revisions.state", "proposed");
      if (error) throw error;
      const out: Record<string, string[]> = {};
      for (const row of data ?? []) {
        // The !inner join gives one parent object, but the generated types
        // can't tell a to-one embed from a to-many.
        const rev = row.system_revisions as unknown as { system_id: string } | null;
        if (!rev) continue;
        (out[rev.system_id] ??= []).push(row.team_member_id);
      }
      return out;
    },
  });
}
