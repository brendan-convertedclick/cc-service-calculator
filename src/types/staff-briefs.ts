// Hand-written interface for staff_briefs and the role enum.
// Until the 0052 migration is applied and `npm run gen:types` regenerates
// src/types/db.ts, queries against staff_briefs use these types.

export type TeamMemberRole = "staff" | "admin" | "owner";

export type StaffBriefStatus = "pending_approval" | "approved" | "rejected";

export type StaffBriefRow = {
  id: string;
  submitter_id: string;
  client_id: string;
  clickup_list_id: string;
  clickup_list_name: string;
  task_name: string;
  sprint_points: number;
  is_internal: boolean;
  goal: string;
  success_criteria: string;
  measurable_outcome: string;
  status: StaffBriefStatus;
  auto_approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  clickup_task_id: string | null;
  clickup_task_url: string | null;
  created_at: string;
  updated_at: string;
};

export type StaffBriefInsert = {
  submitter_id: string;
  client_id: string;
  clickup_list_id: string;
  clickup_list_name: string;
  task_name: string;
  sprint_points: number;
  is_internal: boolean;
  goal: string;
  success_criteria: string;
  measurable_outcome: string;
};

export function roleAllowsApprovals(role: TeamMemberRole | null): boolean {
  return role === "admin" || role === "owner";
}

export function roleIsStaffOnly(role: TeamMemberRole | null): boolean {
  return role === "staff";
}
