// src/hooks/useScopeMap.ts
//
// Data layer for the Scope map page (/briefs/:id/sow-check). Placements live
// in brief_task_sow_placements (0059, self-contained item columns added by
// 0061); the client→SOW link lives in client_sows (0061). Analysis runs in
// the analyze-brief-sow edge function.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import type { BriefTaskSowPlacement, ClientSow } from "@/types/sow-placements";

// brief_task_sow_placements (0059, item columns 0061) and client_sows (0061)
// aren't in the generated Database types yet — query untyped and cast rows
// (same pattern as useRetainerSubItems).
const sb = supabase as unknown as SupabaseClient;

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export const SCOPE_MAP_KEY = (briefId: string) => ["scope-map", briefId] as const;
export const CLIENT_SOWS_KEY = (clientId: string) => ["client-sows", clientId] as const;

export type SowOption = { slug: string; title: string };

export type AnalyzeBriefInput = {
  sow_slugs?: string[];
  persist_client_sows?: boolean;
  force?: boolean;
};

/** First run with no client→SOW link: the fn proposes slugs, writes nothing. */
export type AnalyzeSuggestResult = {
  ok: true;
  needs_sow_selection: true;
  suggested_slugs: string[];
  available: SowOption[];
};

/** Analysis ran: freshly inserted rows + kept approved rows. */
export type AnalyzeRunResult = {
  ok: true;
  needs_sow_selection?: false;
  sow_slugs: string[];
  placements: BriefTaskSowPlacement[];
};

export type AnalyzeBriefResult = AnalyzeSuggestResult | AnalyzeRunResult;

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

export function useClientSows(clientId: string | null | undefined) {
  return useQuery({
    enabled: !!clientId,
    queryKey: clientId ? CLIENT_SOWS_KEY(clientId) : ["client-sows", "none"],
    queryFn: async (): Promise<ClientSow[]> => {
      if (!clientId) return [];
      const { data, error } = await sb
        .from("client_sows")
        .select("*")
        .eq("client_id", clientId)
        .eq("status", "active")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as ClientSow[];
    },
  });
}

/**
 * Run the analyze-brief-sow edge function. Returns either a SOW-selection
 * request (first run, nothing persisted) or the persisted placements.
 */
export function useAnalyzeBrief(briefId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AnalyzeBriefInput = {}): Promise<AnalyzeBriefResult> => {
      if (!briefId) throw new Error("Missing brief id");
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${FUNCTIONS_BASE}/analyze-brief-sow`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ brief_id: briefId, ...input }),
      });
      const body = (await res.json().catch(() => ({}))) as AnalyzeBriefResult & {
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `Analysis failed (HTTP ${res.status})`);
      return body;
    },
    // onSettled (not onSuccess): the edge fn deletes/reinserts rows server-side
    // before a failure can surface, so a failed/aborted re-analysis must still
    // resync the cache with whatever the server now holds.
    onSettled: () => {
      if (briefId) qc.invalidateQueries({ queryKey: SCOPE_MAP_KEY(briefId) });
      qc.invalidateQueries({ queryKey: ["client-sows"] });
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

/**
 * Stamp every placement on the brief as approved. approved_by stays null
 * under the shared team@ login (no team_members row) — allowed by 0061.
 */
export function useApprovePlacements(briefId: string | undefined) {
  const qc = useQueryClient();
  const { currentUserId } = useAuth();
  return useMutation({
    mutationFn: async () => {
      if (!briefId) throw new Error("Missing brief id");
      const { error } = await sb
        .from("brief_task_sow_placements")
        .update({
          approved_by: currentUserId ?? null,
          approved_at: new Date().toISOString(),
        })
        .eq("brief_id", briefId);
      if (error) throw error;
    },
    onSuccess: () => {
      if (briefId) qc.invalidateQueries({ queryKey: SCOPE_MAP_KEY(briefId) });
    },
  });
}
