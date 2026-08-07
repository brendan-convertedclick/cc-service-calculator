// Hand-written interface for internal_meetings / internal_meeting_attendees /
// google_user_tokens until 0093 lands in db.ts.

export type InternalMeetingStatus = "scheduled" | "cancelled";

export type InternalMeetingRow = {
  id: string;
  organiser_id: string;
  client_id: string;
  project_id: string | null;
  title: string;
  agenda: string | null;
  starts_at: string;
  ends_at: string;
  status: InternalMeetingStatus;
  google_event_id: string | null;
  google_calendar_email: string | null;
  google_meet_url: string | null;
  google_html_link: string | null;
  google_sync_error: string | null;
  clickup_task_id: string | null;
  clickup_task_url: string | null;
  clickup_sync_error: string | null;
  work_stream_override: string | null;
  clickup_status_override: string | null;
  created_at: string;
  updated_at: string;
};

export type InternalMeetingAttendee = {
  team_member_id: string;
  full_name: string;
};

/** Meeting row joined with the display fields the staff portal needs. */
export type InternalMeetingWithDetails = InternalMeetingRow & {
  client_name: string | null;
  project_name: string | null;
  attendees: InternalMeetingAttendee[];
};

export type CreateMeetingArgs = {
  organiser_member_id: string;
  client_id: string;
  project_id: string | null;
  title: string;
  agenda: string | null;
  starts_at: string;
  ends_at: string;
  attendee_member_ids: string[];
  work_stream_override?: string | null;
  clickup_status_override?: string | null;
};

export type UpdateMeetingArgs = {
  meeting_id: string;
  title?: string;
  agenda?: string | null;
  client_id?: string;
  project_id?: string | null;
  starts_at?: string;
  ends_at?: string;
  attendee_member_ids?: string[];
  work_stream_override?: string | null;
  clickup_status_override?: string | null;
};

export type ManageMeetingResponse = {
  meeting_id?: string;
  ok?: boolean;
  google_meet_url?: string | null;
  google_html_link?: string | null;
  clickup_task_url?: string | null;
  google_sync_error?: string | null;
  clickup_sync_error?: string | null;
  error?: string;
};
