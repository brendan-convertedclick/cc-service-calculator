// Hand-written interface for extension_requests until 0053 lands in db.ts.

export type ExtensionTier = "auto" | "admin" | "owner";
export type ExtensionStatus =
  | "auto_approved"
  | "pending_admin"
  | "pending_owner"
  | "approved"
  | "rejected";

export type ExtensionRequestRow = {
  id: string;
  requester_id: string;
  client_id: string;
  parent_clickup_task_id: string;
  parent_task_name: string;
  original_points: number;
  extra_points: number;
  delta_pct: number;
  tier: ExtensionTier;
  reason: string;
  status: ExtensionStatus;
  approver_id: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  clickup_subtask_id: string | null;
  clickup_subtask_url: string | null;
  created_at: string;
  updated_at: string;
};

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

export function initialStatusForTier(tier: ExtensionTier): ExtensionStatus {
  if (tier === "auto") return "auto_approved";
  if (tier === "admin") return "pending_admin";
  return "pending_owner";
}
