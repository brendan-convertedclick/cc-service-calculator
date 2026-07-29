// supabase/functions/_shared/extension-logic.ts
//
// The approval gate for extension requests, as a pure function.
//
// Every request that needs a human goes to the admin (Lisa) leg first.
// An admin reject is terminal — it never reaches the owner. An admin approve
// on an owner-tier row *promotes* it to the owner queue instead of executing.
//
// `status` — not `tier` — is the single authority on who acts next. `tier`
// only says whether an owner leg exists at all.

export type ExtensionTier = "auto" | "admin" | "owner";
export type ExtensionStatus =
  | "auto_approved"
  | "pending_admin"
  | "pending_owner"
  | "needs_info"
  | "approved"
  | "rejected";
export type MemberRole = "staff" | "admin" | "owner";

export type ApprovalAction =
  /** Push to ClickUp and mark approved. */
  | { action: "execute" }
  /** Admin signed off an owner-tier row — hand it to the owner queue. */
  | { action: "promote" }
  /** Already done; return the existing subtask ids. */
  | { action: "already_approved" }
  | { action: "denied"; reason: string };

export function decideApprovalAction(
  row: { tier: ExtensionTier; status: ExtensionStatus; requester_id: string },
  caller: { id: string; role: MemberRole },
): ApprovalAction {
  if (row.status === "approved") return { action: "already_approved" };
  if (row.status === "rejected") return { action: "denied", reason: "Extension already rejected" };
  if (row.status === "needs_info") {
    return { action: "denied", reason: "Waiting on more information from the requester" };
  }

  // tier=auto never queued for a human — the requester's own submit finalises
  // it. Admin/owner can also finalise if the auto-push failed on submit.
  if (row.status === "auto_approved") {
    if (caller.role === "staff" && row.requester_id !== caller.id) {
      return { action: "denied", reason: "Not your row" };
    }
    return { action: "execute" };
  }

  if (row.status === "pending_admin") {
    if (caller.role !== "admin" && caller.role !== "owner") {
      return { action: "denied", reason: "Admin or owner role required" };
    }
    return row.tier === "owner" ? { action: "promote" } : { action: "execute" };
  }

  if (row.status === "pending_owner") {
    if (caller.role !== "owner") {
      return { action: "denied", reason: "Owner role required for this extension" };
    }
    return { action: "execute" };
  }

  return { action: "denied", reason: `Unhandled status: ${row.status}` };
}

/**
 * Where a request goes once the requester answers an information request.
 * Back to the owner only if the admin leg is already signed off — an
 * unanswered admin leg must never be skipped.
 */
export function statusAfterInfoResponse(row: {
  admin_approved_at: string | null;
}): "pending_admin" | "pending_owner" {
  return row.admin_approved_at ? "pending_owner" : "pending_admin";
}
