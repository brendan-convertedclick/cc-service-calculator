import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database, Json } from "@/types/db";
import { useAuth } from "@/context/AuthContext";
import { SYSTEMS_KEY, SYSTEM_DETAIL_KEY } from "@/hooks/useSystemDefinitions";
// Reused as-is from the edge function's shared lib — pure TS, no Deno APIs,
// same cross-import pattern already used by src/lib/scope-disposition.test.ts.
import { diffSteps, type DiffStep } from "../../supabase/functions/_shared/system-diff";
import { callEdgeFn } from "@/lib/edge";

type SystemRevision = Database["public"]["Tables"]["system_revisions"]["Row"];
type StepRow = Database["public"]["Tables"]["process_steps"]["Row"];

export const SYSTEM_REVISIONS_KEY = (systemId: string) => ["system_revisions", systemId] as const;

/** Tell the ⚙️ Systems ClickUp channel a revision moved. Best-effort and
 *  fire-and-forget: it lives in onSuccess, never in the mutation, so a chat
 *  outage can't fail a publish. Lives here rather than at the call sites so
 *  every caller of these hooks is covered. */
function notify(revisionId: string, event: "proposed" | "published" | "changes_requested") {
  callEdgeFn("notify-system-revision", { revision_id: revisionId, event }).catch(() => {});
}

function toDiffStep(s: StepRow): DiffStep {
  return {
    id: s.id,
    title: s.title,
    estimated_hours: s.estimated_hours,
    department_id: s.department_id,
    owner_id: s.owner_id,
    materialise_as: s.materialise_as,
    description: s.description,
    doc_links: s.doc_links,
  };
}

// Every revision for a system, newest first — the approval history / list.
export function useSystemRevisions(systemId: string | undefined) {
  return useQuery({
    enabled: !!systemId,
    queryKey: systemId ? SYSTEM_REVISIONS_KEY(systemId) : ["system_revisions", "none"],
    queryFn: async (): Promise<SystemRevision[]> => {
      if (!systemId) return [];
      const { data, error } = await supabase
        .from("system_revisions")
        .select("*")
        .eq("system_id", systemId)
        .order("revision", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// Snapshots the system's current steps into a new 'proposed' revision,
// diffed against whatever is currently 'published' (or against nothing, for
// a system's first-ever revision — diffSteps([], after) reports every step
// as added).
export type ProposedApprover = { teamMemberId: string; required: boolean };

export function useProposeRevision() {
  const qc = useQueryClient();
  const { currentUserId } = useAuth();
  return useMutation({
    mutationFn: async ({
      systemId,
      reasonForChange,
      approvers,
    }: {
      systemId: string;
      reasonForChange: string;
      /** Who has to look at this, named in the Send-for-review dialog. At
       *  least one required — a review with nobody waiting on it is how a
       *  revision used to sit in 'proposed' forever. */
      approvers: ProposedApprover[];
    }) => {
      // A kind='service' system's steps aren't reliably reachable by
      // system_id alone: useSetServiceChecklist/useReplaceSteps (the
      // service-editor mutations) write `service_id` only, with no
      // `system_id` — only the 0105 backfill stamped that column, so any
      // step edited since carries service_id but not system_id. Match how
      // push-to-clickup actually reaches steps (service_id OR system_id) so
      // the snapshot isn't silently empty for an edited service.
      const { data: sys, error: sysErr } = await supabase
        .from("system_definitions")
        .select("kind,service_id")
        .eq("id", systemId)
        .single();
      if (sysErr) throw sysErr;

      let stepsQuery = supabase.from("process_steps").select("*").order("ordinal");
      stepsQuery =
        sys.kind === "service" && sys.service_id
          ? stepsQuery.or(`system_id.eq.${systemId},service_id.eq.${sys.service_id}`)
          : stepsQuery.eq("system_id", systemId);
      const { data: currentSteps, error: stepsErr } = await stepsQuery;
      if (stepsErr) throw stepsErr;

      // The diff answers "what changed since the last time anyone looked at
      // this", so the baseline is the newest PRIOR revision whatever its
      // state — not the published one. A revision that was declined was still
      // read, and baselining past it made the follow-up look like a brand new
      // procedure: with nothing ever published, `before` was empty and every
      // step reported as added.
      const { data: lastRev, error: lastErr } = await supabase
        .from("system_revisions")
        .select("revision,body")
        .eq("system_id", systemId)
        .order("revision", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastErr) throw lastErr;

      const before = ((lastRev?.body as StepRow[] | null) ?? []).map(toDiffStep);
      const after = (currentSteps ?? []).map(toDiffStep);

      const { data, error } = await supabase
        .from("system_revisions")
        .insert({
          system_id: systemId,
          revision: (lastRev?.revision ?? 0) + 1,
          body: currentSteps ?? [],
          state: "proposed",
          reason_for_change: reasonForChange,
          proposed_by: currentUserId ?? null,
          proposed_at: new Date().toISOString(),
          // DiffSummary's `from`/`to` are deliberately `unknown` (values from
          // any of the five compared fields); the object is still plain JSON
          // at runtime, just not structurally assignable to Json's recursive
          // type without this cast.
          diff_summary: diffSteps(before, after) as unknown as Json,
        })
        .select()
        .single();
      if (error) throw error;

      // Written here rather than in onSuccess so the rows exist before the
      // notification reads them — the ping names the required approvers.
      const { error: approverErr } = await supabase.from("system_revision_approvals").insert(
        approvers.map((a) => ({
          revision_id: data.id,
          team_member_id: a.teamMemberId,
          required: a.required,
          approved_at: null, // named, not signed
        })),
      );
      if (approverErr) {
        // Roll the proposal back so it can't sit in review with nobody
        // waiting on it. Best-effort only: system_revisions_delete is
        // admin/owner-only (0118), so for a staff proposer this no-ops
        // silently and leaves the revision behind — benign, and the panel on
        // the revision row can still name approvers after the fact.
        await supabase.from("system_revisions").delete().eq("id", data.id);
        throw approverErr;
      }
      return data;
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: SYSTEM_REVISIONS_KEY(vars.systemId) });
      qc.invalidateQueries({ queryKey: SYSTEMS_KEY }); // in_review drives the list's status pill
      // The "waiting on" faces on the list hang off which revisions are
      // still 'proposed'.
      qc.invalidateQueries({ queryKey: ["system_revision_approvals"] });
      notify(data.id, "proposed");
    },
  });
}

// Atomic publish via the security-definer RPC (0107) — never do the
// supersede/publish/repoint sequence from the client.
export function usePublishRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ revisionId }: { revisionId: string; systemId: string }) => {
      const { error } = await supabase.rpc("publish_system_revision", { p_revision_id: revisionId });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: SYSTEM_REVISIONS_KEY(vars.systemId) });
      qc.invalidateQueries({ queryKey: SYSTEMS_KEY }); // current_revision_id moved
      // The "waiting on" faces on the list hang off which revisions are
      // still 'proposed'.
      qc.invalidateQueries({ queryKey: ["system_revision_approvals"] });
      qc.invalidateQueries({ queryKey: SYSTEM_DETAIL_KEY(vars.systemId) });
      notify(vars.revisionId, "published");
    },
  });
}

// "Request changes": decline a proposed revision. Plain update, not the RPC —
// no publish-state invariant to protect here. Terminal for the row, same as
// the 'draft' it used to be dropped back to; 'changes_requested' (0137) just
// says that someone reviewed it and left notes, rather than leaving it
// looking like a draft nobody has read.
// "Back to draft": the one door that goes backwards, and the only one open to
// every role.
//
// It is an RPC rather than a plain update for the reason 0147 spells out — a
// staff member has no UPDATE on a published row and must not be given one,
// because that would also let published *content* be rewritten in place. The
// function grants this single transition and clears every `approved_at` on
// the way, so a reopened revision can never carry sign-offs recorded against
// the content someone actually read.
//
// No ClickUp ping. The three transitions that post to the ⚙️ Systems channel
// are the ones another person is waiting on; taking your own work back to be
// finished is not news, and a channel that reports every direction becomes a
// channel nobody reads.
export function useBackToDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ revisionId }: { revisionId: string; systemId: string }) => {
      const { error } = await supabase.rpc("system_revision_back_to_draft", {
        p_revision_id: revisionId,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: SYSTEM_REVISIONS_KEY(vars.systemId) });
      // Un-publishing clears current_revision_id, so the list's status pill
      // and the detail header both move.
      qc.invalidateQueries({ queryKey: SYSTEMS_KEY });
      qc.invalidateQueries({ queryKey: SYSTEM_DETAIL_KEY(vars.systemId) });
      // Every approved_at just went null; the approval line renders from these.
      qc.invalidateQueries({ queryKey: ["system_revision_approvals"] });
    },
  });
}

export function useRequestChanges() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ revisionId }: { revisionId: string; systemId: string }) => {
      // .select() so a zero-row match (already published/draft/superseded)
      // surfaces as a real error instead of a silent no-op success.
      const { data, error } = await supabase
        .from("system_revisions")
        .update({ state: "changes_requested" })
        .eq("id", revisionId)
        .eq("state", "proposed")
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Revision is no longer in 'proposed' state — nothing to send back.");
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: SYSTEM_REVISIONS_KEY(vars.systemId) });
      qc.invalidateQueries({ queryKey: SYSTEMS_KEY }); // the list's status pill
      // The "waiting on" faces on the list hang off which revisions are
      // still 'proposed'.
      qc.invalidateQueries({ queryKey: ["system_revision_approvals"] });
      notify(vars.revisionId, "changes_requested");
    },
  });
}
