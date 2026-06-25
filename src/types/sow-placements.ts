export type SowServiceArea = {
  id: string;
  sow_slug: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
};

export type BriefTaskSowPlacement = {
  id: string;
  brief_id: string;
  task_ref: string;
  service_area_id: string | null;
  is_inside: boolean;
  ai_match_quote: string | null;
  ai_confidence: number | null;
  override_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  // Columns added by migration 0061 — self-contained scope-map items.
  item_name: string | null;
  item_description: string | null;
  sow_slug: string | null;
  suggested_service_id: string | null;
  estimated_cents: number | null;
  // Scope Ledger Rail (migration 0071). disposition is the three-way coverage
  // truth resolved deterministically server-side; is_inside mirrors
  // disposition === 'in_agreed_scope' for back-compat.
  disposition: "in_agreed_scope" | "new_billable" | "out_of_scope" | null;
  quantity: number | null;
  grounding_quote: string | null;
  needs_review: boolean | null;
};

// client_sows added by migration 0061 — which master SOW engagements a
// client has. Remembered so the scope map never re-asks per brief.
export type ClientSow = {
  client_id: string;
  sow_slug: string;
  status: "active" | "ended";
  created_at: string;
};

export type ProposedTaskForPlacement = {
  task_ref: string;
  name: string;
  description?: string;
};

export type Disposition = "in_agreed_scope" | "new_billable" | "out_of_scope";

/**
 * Resolve a placement's disposition, falling back to the legacy is_inside
 * binary for rows written before migration 0071 (disposition is nullable).
 * Pre-0071 rows only ever distinguished inside vs outside, so an outside legacy
 * row maps to new_billable (its historical estimate behaviour) — out_of_scope
 * is only ever produced by the deterministic resolver.
 */
export function placementDisposition(p: BriefTaskSowPlacement): Disposition {
  if (p.disposition) return p.disposition;
  return p.is_inside ? "in_agreed_scope" : "new_billable";
}

/** New billable work the client must be quoted for (feeds the estimate). */
export function isBillablePlacement(p: BriefTaskSowPlacement): boolean {
  return placementDisposition(p) === "new_billable";
}
