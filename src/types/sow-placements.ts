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
