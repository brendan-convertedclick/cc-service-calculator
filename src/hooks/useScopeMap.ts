// src/hooks/useScopeMap.ts
//
// Data layer for Stage 1 (In / New / Out of scope) of the brief page. Placements live
// in brief_task_sow_placements (0059, self-contained item columns added by
// 0061); the client→SOW link lives in client_sows (0061). Lines are added by
// hand — nothing analyses the client's email any more.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  makeManualTaskRef,
  type BriefTaskSowPlacement,
} from "@/types/sow-placements";

// brief_task_sow_placements (0059, item columns 0061) and client_sows (0061)
// aren't in the generated Database types yet — query untyped and cast rows
// (same pattern as useRetainerSubItems).
const sb = supabase as unknown as SupabaseClient;

export const SCOPE_MAP_KEY = (briefId: string) => ["scope-map", briefId] as const;

export function useScopeMapPlacements(briefId: string | undefined) {
  return useQuery({
    enabled: !!briefId,
    queryKey: briefId ? SCOPE_MAP_KEY(briefId) : ["scope-map", "none"],
    queryFn: async (): Promise<BriefTaskSowPlacement[]> => {
      if (!briefId) return [];
      const { data, error } = await sb
        .from("brief_task_sow_placements")
        .select("*")
        .eq("brief_id", briefId)
        // Batch inserts share created_at, and the layout is index-sensitive —
        // tiebreak on id so the chip order is stable across refetches.
        .order("created_at")
        .order("id");
      if (error) throw error;
      return (data ?? []) as unknown as BriefTaskSowPlacement[];
    },
  });
}

export type PlacementOverride = {
  task_ref: string;
  is_inside: boolean;
  service_area_id?: string | null;
  sow_slug?: string | null;
  override_reason?: string | null;
  // Scope Ledger Rail: the Scope Receipt's In/New/Out override persists the
  // three-way disposition directly. When supplied, is_inside is kept in sync
  // (is_inside === disposition === 'in_agreed_scope') for the legacy map visual.
  disposition?: BriefTaskSowPlacement["disposition"];
};

function definedPatch(patch: PlacementOverride): Partial<BriefTaskSowPlacement> {
  const out: Partial<BriefTaskSowPlacement> = { is_inside: patch.is_inside };
  if (patch.service_area_id !== undefined) out.service_area_id = patch.service_area_id;
  if (patch.sow_slug !== undefined) out.sow_slug = patch.sow_slug;
  if (patch.override_reason !== undefined) out.override_reason = patch.override_reason;
  if (patch.disposition !== undefined) out.disposition = patch.disposition;
  return out;
}

/**
 * Operator override of a single placement (move inside/outside). Optimistic:
 * the chip animates to its new position immediately, rolled back on error.
 */
export function useOverridePlacement(briefId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: PlacementOverride) => {
      if (!briefId) throw new Error("Missing brief id");
      const { error } = await sb
        .from("brief_task_sow_placements")
        .upsert(
          { brief_id: briefId, task_ref: patch.task_ref, ...definedPatch(patch) },
          { onConflict: "brief_id,task_ref" },
        );
      if (error) throw error;
    },
    onMutate: async (patch) => {
      if (!briefId) return { previous: undefined as BriefTaskSowPlacement[] | undefined };
      await qc.cancelQueries({ queryKey: SCOPE_MAP_KEY(briefId) });
      const previous = qc.getQueryData<BriefTaskSowPlacement[]>(SCOPE_MAP_KEY(briefId));
      qc.setQueryData<BriefTaskSowPlacement[]>(SCOPE_MAP_KEY(briefId), (rows) =>
        (rows ?? []).map((r) =>
          r.task_ref === patch.task_ref ? { ...r, ...definedPatch(patch) } : r,
        ),
      );
      return { previous };
    },
    onError: (_err, _patch, ctx) => {
      if (briefId && ctx?.previous) qc.setQueryData(SCOPE_MAP_KEY(briefId), ctx.previous);
    },
    onSettled: () => {
      if (briefId) qc.invalidateQueries({ queryKey: SCOPE_MAP_KEY(briefId) });
    },
  });
}

export type NewBillableLine = {
  /** Catalogue service seeding the line. */
  suggested_service_id: string;
  /** Display label (defaults to the service name; editable inline afterward). */
  item_name: string;
  /** Per-unit sell price in cents from the catalogue (null → operator sets it). */
  estimated_cents: number | null;
};

/**
 * Insert a manually-added billable line (a new brief_task_sow_placements row)
 * seeded from the catalogue. Always lands in the new_billable band; quantity
 * defaults to 1 and everything is editable inline afterward exactly like an
 * AI-analysed line. Non-optimistic: insert → refetch (the row needs a
 * server-generated id/created_at). task_ref is derived from the item name and
 * deduped against the refs already cached for this brief.
 */
export function useAddPlacement(briefId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewBillableLine) => {
      if (!briefId) throw new Error("Missing brief id");
      const existing = qc.getQueryData<BriefTaskSowPlacement[]>(SCOPE_MAP_KEY(briefId)) ?? [];
      const task_ref = makeManualTaskRef(
        input.item_name,
        existing.map((r) => r.task_ref),
      );
      const { error } = await sb.from("brief_task_sow_placements").insert({
        brief_id: briefId,
        task_ref,
        item_name: input.item_name,
        suggested_service_id: input.suggested_service_id,
        estimated_cents: input.estimated_cents,
        quantity: 1,
        disposition: "new_billable",
        // is_inside mirrors disposition for the legacy map visual; a billable
        // line is never inside agreed scope.
        is_inside: false,
        // Human-picked, so there's no AI confidence to sanity-check.
        ai_confidence: null,
        needs_review: false,
      });
      if (error) throw error;
    },
    onSettled: () => {
      if (briefId) qc.invalidateQueries({ queryKey: SCOPE_MAP_KEY(briefId) });
    },
  });
}

export type PlacementValuePatch = {
  task_ref: string;
  /** Per-unit sell price in cents. */
  estimated_cents?: number;
  /** Quantity (supports fractional, e.g. 1.5). */
  quantity?: number;
  /** Short display label for the line. */
  item_name?: string;
  /** Full-sentence description under the label. */
  item_description?: string | null;
  /** Client-facing coverage reason (receipt + CE PDF). Null clears it. */
  client_reason?: string | null;
  /** Operator untick — excluded lines drop out of totals, client view, PDF. */
  excluded?: boolean;
};

/**
 * Persist an operator's inline edit of a placement's price, quantity, name or
 * description.
 * Optimistic: the row updates immediately and rolls back on error. Update (not
 * upsert) — the row always exists (it's on screen) so we only touch the given
 * numeric fields and never clobber disposition/is_inside.
 */
export function useUpdatePlacementValue(briefId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ task_ref, ...fields }: PlacementValuePatch) => {
      if (!briefId) throw new Error("Missing brief id");
      const { error } = await sb
        .from("brief_task_sow_placements")
        .update(fields)
        .eq("brief_id", briefId)
        .eq("task_ref", task_ref);
      if (error) throw error;
    },
    onMutate: async ({ task_ref, ...fields }) => {
      if (!briefId) return { previous: undefined as BriefTaskSowPlacement[] | undefined };
      await qc.cancelQueries({ queryKey: SCOPE_MAP_KEY(briefId) });
      const previous = qc.getQueryData<BriefTaskSowPlacement[]>(SCOPE_MAP_KEY(briefId));
      qc.setQueryData<BriefTaskSowPlacement[]>(SCOPE_MAP_KEY(briefId), (rows) =>
        (rows ?? []).map((r) => (r.task_ref === task_ref ? { ...r, ...fields } : r)),
      );
      return { previous };
    },
    onError: (_err, _patch, ctx) => {
      if (briefId && ctx?.previous) qc.setQueryData(SCOPE_MAP_KEY(briefId), ctx.previous);
    },
    onSettled: () => {
      if (briefId) qc.invalidateQueries({ queryKey: SCOPE_MAP_KEY(briefId) });
    },
  });
}
