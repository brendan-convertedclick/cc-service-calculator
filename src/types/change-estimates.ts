export type CEStatus = "draft" | "sent" | "approved" | "rejected" | "cancelled";
export type CESource = "intake_outside_scope" | "mid_project_adjust";
export type CELineKind = "add" | "cancel" | "reduce";

export type ChangeEstimateRow = {
  id: string;
  project_id: string;
  brief_id: string | null;
  client_id: string;
  source: CESource;
  status: CEStatus;
  reason: string | null;
  summary: string | null;
  delta_value_cents: number;
  delta_points: number;
  outbound_email_id: string | null;
  external_approval_id: string | null;
  approved_at: string | null;
  approver_email: string | null;
  approval_note: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ChangeEstimateLineItem = {
  id: string;
  change_estimate_id: string;
  service_id: string | null;
  description: string;
  qty: number;
  unit_points: number;
  unit_value_cents: number;
  line_kind: CELineKind;
  target_task_id: string | null;
  sort_order: number;
};

/**
 * Rollup of delta values across line items. `cancel` and `reduce` lines
 * subtract; `add` lines add.
 */
export function rollupCE(items: ChangeEstimateLineItem[]): {
  delta_points: number;
  delta_value_cents: number;
} {
  let dp = 0;
  let dv = 0;
  for (const i of items) {
    const sign = i.line_kind === "add" ? 1 : -1;
    dp += sign * i.qty * i.unit_points;
    dv += sign * Math.round(i.qty * i.unit_value_cents);
  }
  return { delta_points: round2(dp), delta_value_cents: dv };
}

export const CE_STATUS_LABEL: Record<CEStatus, string> = {
  draft: "Draft",
  sent: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
