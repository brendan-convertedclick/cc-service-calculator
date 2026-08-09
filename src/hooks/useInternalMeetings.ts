// src/hooks/useInternalMeetings.ts
//
// Staff-scheduled internal meetings (standups, syncs, etc). Each meeting gets
// a Google Calendar event with a Meet link and a ClickUp task in the internal
// overhead list, both managed via the manage-internal-meeting edge function.
// RLS on internal_meetings / internal_meeting_attendees already restricts
// SELECT to the caller's own meetings (organiser or attendee) or admin/owner
// — no client-side filtering needed on top of the bare select below.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { callEdgeFn } from "@/lib/edge";
import type {
  CreateMeetingArgs,
  InternalMeetingWithDetails,
  ManageMeetingResponse,
  UpdateMeetingArgs,
} from "@/types/internal-meetings";

// internal_meetings isn't in the generated Database types yet — query untyped.
const sb = supabase as unknown as SupabaseClient;

const KEY = ["internal-meetings"] as const;

// Raw shape of the joined select below. clients/projects are to-one FKs so
// PostgREST returns single objects (not arrays); projects is null whenever
// project_id is null.
type MeetingJoinRow = {
  id: string;
  organiser_id: string;
  client_id: string;
  project_id: string | null;
  title: string;
  agenda: string | null;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "cancelled";
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
  clients: { name: string } | null;
  projects: { name: string } | null;
  internal_meeting_attendees: Array<{
    team_member_id: string;
    team_members: { full_name: string } | null;
  }>;
};

export function useInternalMeetings() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<InternalMeetingWithDetails[]> => {
      const { data, error } = await sb
        .from("internal_meetings")
        .select(
          `*, clients ( name ), projects ( name ),
           internal_meeting_attendees ( team_member_id, team_members ( full_name ) )`,
        )
        .order("starts_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as MeetingJoinRow[]).map((row) => ({
        ...row,
        client_name: row.clients?.name ?? null,
        project_name: row.projects?.name ?? null,
        attendees: row.internal_meeting_attendees.map((a) => ({
          team_member_id: a.team_member_id,
          full_name: a.team_members?.full_name ?? "Unknown",
        })),
      }));
    },
  });
}

async function callManageMeeting(body: Record<string, unknown>): Promise<ManageMeetingResponse> {
  return callEdgeFn<ManageMeetingResponse>("manage-internal-meeting", body);
}

export function useCreateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateMeetingArgs) => callManageMeeting({ action: "create", ...args }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: UpdateMeetingArgs) => callManageMeeting({ action: "update", ...args }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCancelMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meeting_id: string) => callManageMeeting({ action: "cancel", meeting_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
