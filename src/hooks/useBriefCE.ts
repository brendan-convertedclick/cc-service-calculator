// src/hooks/useBriefCE.ts
//
// Data layer for the brief flow's Stage 4 (Cost Estimate) and Stage 5
// (Approve & Schedule). One live CE per brief: the latest non-cancelled
// change_estimates row, with its line items.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { callEdgeFn } from "@/lib/edge";
import {
  rollupCE,
  type ChangeEstimateLineItem,
  type ChangeEstimateRow,
  type CEStatus,
} from "@/types/change-estimates";

// change_estimates isn't in the generated Database types yet — query untyped
// and cast rows (same pattern as EstimateSheet / useRetainerSubItems).
const sb = supabase as unknown as SupabaseClient;

export const BRIEF_CE_KEY = (briefId: string) => ["brief-ce", briefId] as const;

export type BriefCE = ChangeEstimateRow & { lines: ChangeEstimateLineItem[] };

export function useBriefCE(briefId: string | undefined) {
  return useQuery({
    enabled: !!briefId,
    queryKey: briefId ? BRIEF_CE_KEY(briefId) : ["brief-ce", "none"],
    queryFn: async (): Promise<BriefCE | null> => {
      if (!briefId) return null;
      const { data: ce, error } = await sb
        .from("change_estimates")
        .select("*")
        .eq("brief_id", briefId)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!ce) return null;
      const row = ce as ChangeEstimateRow;
      const { data: lines, error: lErr } = await sb
        .from("change_estimate_line_items")
        .select("*")
        .eq("change_estimate_id", row.id)
        .order("sort_order");
      if (lErr) throw lErr;
      return { ...row, lines: (lines ?? []) as ChangeEstimateLineItem[] };
    },
  });
}

export type CreateCEInput = {
  brief_id: string;
  client_id: string;
  project_id: string | null;
  created_by: string | null;
  reason: string;
  summary: string;
  lines: Array<Omit<ChangeEstimateLineItem, "id" | "change_estimate_id">>;
};

async function invokeRenderCePdf(ceId: string): Promise<string | null> {
  const body = await callEdgeFn<{ url?: string }>("render-ce-pdf", {
    change_estimate_id: ceId,
  });
  return body.url ?? null;
}

/** Create the CE + line items, then render its PDF. Returns the CE id. */
export function useCreateBriefCE(briefId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCEInput): Promise<string> => {
      const totals = rollupCE(
        input.lines.map((l, i) => ({ ...l, id: String(i), change_estimate_id: "x" })),
      );
      const { data: ce, error } = await sb
        .from("change_estimates")
        .insert({
          project_id: input.project_id,
          brief_id: input.brief_id,
          client_id: input.client_id,
          source: "intake_outside_scope",
          status: "draft",
          reason: input.reason,
          summary: input.summary,
          delta_points: totals.delta_points,
          delta_value_cents: totals.delta_value_cents,
          created_by: input.created_by,
        })
        .select("id")
        .single();
      if (error) throw error;
      const ceId = (ce as { id: string }).id;

      if (input.lines.length > 0) {
        const { error: lErr } = await sb.from("change_estimate_line_items").insert(
          input.lines.map((l, i) => ({
            change_estimate_id: ceId,
            service_id: l.service_id,
            description: l.description,
            detail: l.detail ?? null,
            qty: l.qty,
            unit_points: l.unit_points,
            unit_value_cents: l.unit_value_cents,
            line_kind: l.line_kind,
            target_task_id: l.target_task_id,
            sort_order: i,
          })),
        );
        if (lErr) throw lErr;
      }

      if (input.project_id) {
        // Best-effort project event — the CE itself is already saved.
        await sb.from("project_events").insert({
          project_id: input.project_id,
          event_type: "ce_drafted",
          payload: {
            change_estimate_id: ceId,
            delta_points: totals.delta_points,
            delta_value_cents: totals.delta_value_cents,
          },
          occurred_at: new Date().toISOString(),
        });
      }

      await invokeRenderCePdf(ceId);
      return ceId;
    },
    onSettled: () => {
      if (briefId) qc.invalidateQueries({ queryKey: BRIEF_CE_KEY(briefId) });
    },
  });
}

/** Re-render the CE PDF (e.g. after out-of-band edits). */
export function useRenderCePdf(briefId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ceId: string) => invokeRenderCePdf(ceId),
    onSettled: () => {
      if (briefId) qc.invalidateQueries({ queryKey: BRIEF_CE_KEY(briefId) });
    },
  });
}

/** Status transitions for Stage 5 (mark sent / approved / rejected). */
export function useSetCEStatus(briefId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ceId: string; status: CEStatus; note?: string }) => {
      const patch: Record<string, unknown> = {
        status: input.status,
        updated_at: new Date().toISOString(),
      };
      if (input.status === "approved") {
        patch.approved_at = new Date().toISOString();
        if (input.note) patch.approval_note = input.note;
      }
      if (input.status === "rejected") {
        patch.rejected_at = new Date().toISOString();
        if (input.note) patch.rejected_reason = input.note;
      }
      const { error } = await sb.from("change_estimates").update(patch).eq("id", input.ceId);
      if (error) throw error;

      // Mirror the estimate's journey onto the brief so the pipeline reads
      // right: sent → quoted, client approved → accepted (scheduling later
      // moves it to briefed). Rejection keeps the brief where it is — the
      // operator adjusts and re-sends.
      const briefStatus =
        input.status === "sent" ? "quoted" : input.status === "approved" ? "accepted" : null;
      if (briefId && briefStatus) {
        const { error: bErr } = await sb
          .from("briefs")
          .update({ status: briefStatus, updated_at: new Date().toISOString() })
          .eq("id", briefId);
        if (bErr) throw bErr;
      }
    },
    onSettled: () => {
      if (briefId) qc.invalidateQueries({ queryKey: BRIEF_CE_KEY(briefId) });
      qc.invalidateQueries({ queryKey: ["briefs"] });
    },
  });
}

export type ScheduleResult = {
  created: Array<{
    placement_task_id: string;
    clickup_task_id: string;
    clickup_task_url: string;
    name: string;
  }>;
  skipped: number;
  failures?: string[];
  list_name?: string;
};

/** Per-task payload override sent to schedule-brief-tasks (Stage 5 edits).
 *  Only tasks listed are scheduled — the list IS the confirmed selection. */
export type ScheduleTaskOverride = {
  placement_task_id: string;
  name?: string;
  description?: string;
  work_stream?: string;
  points?: number;
  assignee_clickup_id?: number | null;
  due_date?: string | null; // YYYY-MM-DD
};

/** Stage 5: push the team-task breakdown to ClickUp via schedule-brief-tasks. */
export function useScheduleBriefTasks(briefId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      briefed_by_member_id?: string | null;
      tasks?: ScheduleTaskOverride[];
      /** Target ClickUp list — omitted → server's folder heuristic. */
      list_id?: string | null;
      /** Status for created tasks — omitted → list default. */
      status?: string | null;
    }): Promise<ScheduleResult> => {
      if (!briefId) throw new Error("Missing brief id");
      return callEdgeFn<ScheduleResult>("schedule-brief-tasks", {
        brief_id: briefId,
        ...input,
      });
    },
    onSettled: () => {
      if (!briefId) return;
      qc.invalidateQueries({ queryKey: ["placement-tasks", briefId] });
      qc.invalidateQueries({ queryKey: ["briefs", "detail", briefId] });
      qc.invalidateQueries({ queryKey: BRIEF_CE_KEY(briefId) });
    },
  });
}
