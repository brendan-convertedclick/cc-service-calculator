// src/hooks/useBriefCE.ts
//
// Data layer for the brief flow's Stage 4 (Cost Estimate) and Stage 5
// (Approve & Schedule). One live CE per brief: the latest non-cancelled
// change_estimates row, with its line items.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  rollupCE,
  type ChangeEstimateLineItem,
  type ChangeEstimateRow,
  type CEStatus,
} from "@/types/change-estimates";

// change_estimates isn't in the generated Database types yet — query untyped
// and cast rows (same pattern as EstimateSheet / useRetainerSubItems).
const sb = supabase as unknown as SupabaseClient;

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

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
  const session = (await supabase.auth.getSession()).data.session;
  const res = await fetch(`${FUNCTIONS_BASE}/render-ce-pdf`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session?.access_token ?? ""}`,
    },
    body: JSON.stringify({ change_estimate_id: ceId }),
  });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? `PDF render failed (HTTP ${res.status})`);
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
    },
    onSettled: () => {
      if (briefId) qc.invalidateQueries({ queryKey: BRIEF_CE_KEY(briefId) });
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
    }): Promise<ScheduleResult> => {
      if (!briefId) throw new Error("Missing brief id");
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${FUNCTIONS_BASE}/schedule-brief-tasks`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ brief_id: briefId, ...input }),
      });
      const body = (await res.json().catch(() => ({}))) as ScheduleResult & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Scheduling failed (HTTP ${res.status})`);
      return body;
    },
    onSettled: () => {
      if (!briefId) return;
      qc.invalidateQueries({ queryKey: ["placement-tasks", briefId] });
      qc.invalidateQueries({ queryKey: ["briefs", "detail", briefId] });
      qc.invalidateQueries({ queryKey: BRIEF_CE_KEY(briefId) });
    },
  });
}
