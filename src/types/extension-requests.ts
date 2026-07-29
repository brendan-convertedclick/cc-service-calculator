// Hand-written interface for extension_requests until 0053 lands in db.ts.

export type ExtensionTier = "auto" | "admin" | "owner";
export type ExtensionStatus =
  | "auto_approved"
  | "pending_admin"
  | "pending_owner"
  | "needs_info"
  | "approved"
  | "rejected";

export type ExtensionRequestRow = {
  id: string;
  requester_id: string;
  client_id: string;
  parent_clickup_task_id: string;
  parent_task_name: string;
  original_points: number | null;
  extra_points: number | null;
  delta_pct: number | null;
  original_due_date: string | null;
  requested_due_date: string | null;
  due_date_reason: string | null;
  tier: ExtensionTier;
  reason: string | null;
  status: ExtensionStatus;
  approver_id: string | null;
  approved_at: string | null;
  admin_approver_id: string | null;
  admin_approved_at: string | null;
  info_request: string | null;
  info_requested_by: string | null;
  info_requested_at: string | null;
  info_response: string | null;
  info_responded_at: string | null;
  rejected_reason: string | null;
  clickup_subtask_id: string | null;
  clickup_subtask_url: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * A request with the joins the approval surfaces need. The escalations page
 * fetches this one shape; the table uses part of it and the detail pane the
 * rest, so the join list lives here rather than in either component.
 */
export type EscalationRow = ExtensionRequestRow & {
  client: { id: string; name: string } | null;
  requester: { id: string; full_name: string; email: string | null } | null;
  admin_approver: { id: string; full_name: string } | null;
};

/** Which of the four queues a request sits in — who is holding it right now. */
export type EscalationHolder = "owner" | "admin" | "requester" | "done";

export function holderOf(row: { status: ExtensionStatus }): EscalationHolder {
  if (row.status === "pending_owner") return "owner";
  if (row.status === "pending_admin") return "admin";
  if (row.status === "needs_info") return "requester";
  return "done";
}

export const HOLDER_LABEL: Record<EscalationHolder, string> = {
  owner: "Needs you",
  admin: "With admin",
  requester: "Waiting on requester",
  done: "Decided",
};

/**
 * Whether the request actually asks for budget.
 *
 * Since the budget field became mandatory, `extra_points` is present on every
 * new row — and a stated 0 is an answer ("this needs more time, not more
 * money"), not an ask. Summaries key off this so a date push doesn't grow a
 * meaningless `+0 pt` chip. Postgres hands numerics back as strings, hence the
 * Number().
 */
export function askedForPoints(row: { extra_points: number | string | null }): boolean {
  return row.extra_points !== null && Number(row.extra_points) > 0;
}

/**
 * Classify an extension request into an approval tier from the % delta of
 * extra_points over original_points.
 *
 *   < 25%  → auto       (immediate approval, push to ClickUp)
 *   25–50% → admin      (queued for admin approval)
 *   > 50%  → owner      (escalated to owner)
 */
export function classifyTier(originalPoints: number, extraPoints: number): {
  tier: ExtensionTier;
  deltaPct: number;
} {
  if (originalPoints <= 0) throw new Error("originalPoints must be > 0");
  if (extraPoints <= 0) throw new Error("extraPoints must be > 0");
  const deltaPct = (extraPoints / originalPoints) * 100;
  let tier: ExtensionTier;
  if (deltaPct < 25) tier = "auto";
  else if (deltaPct <= 50) tier = "admin";
  else tier = "owner";
  return { tier, deltaPct: Math.round(deltaPct * 100) / 100 };
}

/**
 * Every request needing a human enters at the admin leg — owner-tier included.
 * The owner queue is reached only by an admin promoting the row (see
 * supabase/functions/_shared/extension-logic.ts), so an admin reject is
 * terminal and never reaches the owner.
 */
export function initialStatusForTier(tier: ExtensionTier): ExtensionStatus {
  return tier === "auto" ? "auto_approved" : "pending_admin";
}

/**
 * Classify a due-date push into an approval tier from days requested.
 *
 *   <= 2 days → auto
 *   3-7 days  → admin
 *   > 7 days  → owner
 */
export function classifyDueDateTier(daysRequested: number): { tier: ExtensionTier } {
  if (daysRequested <= 0) throw new Error("daysRequested must be > 0");
  if (daysRequested <= 2) return { tier: "auto" };
  if (daysRequested <= 7) return { tier: "admin" };
  return { tier: "owner" };
}

const TIER_RANK: Record<ExtensionTier, number> = { auto: 0, admin: 1, owner: 2 };

/** The more restrictive of two tiers — used when a request combines extra
 * points and a due-date push, each classified independently. */
export function maxTier(a: ExtensionTier, b: ExtensionTier): ExtensionTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}
