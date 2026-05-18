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
};

export type ProposedTaskForPlacement = {
  task_ref: string;
  name: string;
  description?: string;
};

/**
 * Group a set of placements into buckets keyed by service_area_id. The
 * sentinel key "__outside" collects placements that are out of scope.
 */
export function bucketPlacements(
  placements: BriefTaskSowPlacement[],
): Map<string, BriefTaskSowPlacement[]> {
  const out = new Map<string, BriefTaskSowPlacement[]>();
  for (const p of placements) {
    const key = p.is_inside && p.service_area_id ? p.service_area_id : "__outside";
    const list = out.get(key) ?? [];
    list.push(p);
    out.set(key, list);
  }
  return out;
}

/**
 * Aggregate counts useful for the CE branching decision after the operator
 * approves placements.
 */
export function placementCounts(placements: BriefTaskSowPlacement[]): {
  inside: number;
  outside: number;
} {
  let inside = 0;
  let outside = 0;
  for (const p of placements) {
    if (p.is_inside) inside += 1;
    else outside += 1;
  }
  return { inside, outside };
}
