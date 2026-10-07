// Hand-written interface for revision_requests until 0095 lands in db.ts.

export const REVISION_SUFFIXES = ["DFT V2.1", "DFT V2.2", "REV V1.1", "REV 2.1"] as const;
export type RevisionSuffix = (typeof REVISION_SUFFIXES)[number];

export type RevisionStatus = "pending_admin" | "approved" | "rejected";

export type RevisionRequestRow = {
  id: string;
  requester_id: string;
  client_id: string;
  parent_clickup_task_id: string;
  parent_task_name: string;
  revision_suffix: RevisionSuffix;
  /** Time asked for. Null on requests from before 0199. */
  sprint_points: number | null;
  /** Time approved, when it differs from the ask (or no ask was recorded). */
  approved_points: number | null;
  status: RevisionStatus;
  approver_id: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  clickup_new_task_id: string | null;
  clickup_new_task_url: string | null;
  created_at: string;
  updated_at: string;
};
