import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { useClientProjects } from "@/hooks/useClientProjects";
import { useTeam } from "@/hooks/useTeam";
import { useCreateMeeting, useUpdateMeeting } from "@/hooks/useInternalMeetings";
import type { InternalMeetingWithDetails, ManageMeetingResponse } from "@/types/internal-meetings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const NO_PROJECT = "__none__";

/**
 * Africa/Johannesburg is a fixed +02:00 offset (no DST), so a wall-clock
 * date + time picked in the form maps onto an ISO instant by literally
 * appending the offset — no Date/toISOString() round-trip that would shift
 * by whatever timezone the viewer's browser happens to be in.
 */
function sastToIso(date: string, time: string): string {
  return `${date}T${time.slice(0, 5)}:00+02:00`;
}

/**
 * Inverse, for pre-filling the edit form: split a timestamptz ISO string
 * into SAST wall-clock date/time parts. Adding 2h to the UTC instant and
 * then reading it back with toISOString() (always UTC) yields the SAST
 * components regardless of the viewer's own browser timezone.
 */
function isoToSastParts(iso: string): { date: string; time: string } {
  const shifted = new Date(new Date(iso).getTime() + 2 * 60 * 60 * 1000);
  const asIso = shifted.toISOString();
  return { date: asIso.slice(0, 10), time: asIso.slice(11, 16) };
}

function reportSyncWarnings(res: ManageMeetingResponse) {
  if (res.google_sync_error) toast.warning(`Calendar: ${res.google_sync_error}`);
  if (res.clickup_sync_error) toast.warning(`ClickUp: ${res.clickup_sync_error}`);
}

type MeetingFormBodyProps = {
  /** When set, the form edits this meeting instead of creating a new one. */
  meeting?: InternalMeetingWithDetails;
  onSaved?: () => void;
};

/**
 * Create/edit form for an internal meeting. Client + attendees + time are
 * required; a project is optional. Submitting POSTs to
 * manage-internal-meeting, which writes the DB row first and best-efforts
 * the Google Calendar + ClickUp legs — a sync failure is surfaced as a
 * warning toast, not a submit failure, because the meeting is saved either
 * way.
 */
export function MeetingFormBody({ meeting, onSaved }: MeetingFormBodyProps) {
  const { currentUserId } = useAuth();
  const { data: clients = [] } = useClientProjects();
  const { data: team = [] } = useTeam();
  const createMeeting = useCreateMeeting();
  const updateMeeting = useUpdateMeeting();

  const isEdit = !!meeting;
  const startParts = meeting ? isoToSastParts(meeting.starts_at) : null;
  const endParts = meeting ? isoToSastParts(meeting.ends_at) : null;

  const [clientId, setClientId] = useState(meeting?.client_id ?? "");
  const [projectId, setProjectId] = useState(meeting?.project_id ?? NO_PROJECT);
  const [title, setTitle] = useState(meeting?.title ?? "");
  const [agenda, setAgenda] = useState(meeting?.agenda ?? "");
  const [date, setDate] = useState(startParts?.date ?? "");
  const [startTime, setStartTime] = useState(startParts?.time ?? "");
  const [endTime, setEndTime] = useState(endParts?.time ?? "");
  const [attendeeIds, setAttendeeIds] = useState<string[]>(
    meeting?.attendees.map((a) => a.team_member_id) ?? [],
  );
  const [submitting, setSubmitting] = useState(false);
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);

  // Connection status only matters when scheduling fresh — surfacing it
  // inside the edit dialog for an already-synced meeting is just noise.
  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const res = await fetch(`${FUNCTIONS_BASE}/google-token?action=status`, {
          headers: { authorization: `Bearer ${session?.access_token ?? ""}` },
        });
        const body = (await res.json()) as { connected?: boolean };
        if (!cancelled) setGoogleConnected(!!body.connected);
      } catch {
        if (!cancelled) setGoogleConnected(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit]);

  const projectOptions = useMemo(
    () => clients.find((c) => c.id === clientId)?.projects ?? [],
    [clients, clientId],
  );

  const teamOptions = useMemo(
    () => team.map((m) => ({ value: m.id, label: m.full_name })),
    [team],
  );

  const startIso = date && startTime ? sastToIso(date, startTime) : null;
  const endIso = date && endTime ? sastToIso(date, endTime) : null;
  const timeOrderOk = !!startIso && !!endIso && endIso > startIso;

  const canSubmit =
    (isEdit || !!currentUserId) &&
    !!clientId &&
    title.trim().length > 0 &&
    attendeeIds.length > 0 &&
    timeOrderOk &&
    !submitting;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !startIso || !endIso) return;
    setSubmitting(true);
    try {
      const projectValue = projectId === NO_PROJECT ? null : projectId;
      if (isEdit && meeting) {
        const res = await updateMeeting.mutateAsync({
          meeting_id: meeting.id,
          title: title.trim(),
          agenda: agenda.trim() || null,
          client_id: clientId,
          project_id: projectValue,
          starts_at: startIso,
          ends_at: endIso,
          attendee_member_ids: attendeeIds,
        });
        reportSyncWarnings(res);
        toast.success("Meeting updated.");
      } else {
        const res = await createMeeting.mutateAsync({
          organiser_member_id: currentUserId as string,
          client_id: clientId,
          project_id: projectValue,
          title: title.trim(),
          agenda: agenda.trim() || null,
          starts_at: startIso,
          ends_at: endIso,
          attendee_member_ids: attendeeIds,
        });
        reportSyncWarnings(res);
        toast.success(
          res.google_meet_url ? `Meeting scheduled — ${res.google_meet_url}` : "Meeting scheduled.",
        );
        setClientId("");
        setProjectId(NO_PROJECT);
        setTitle("");
        setAgenda("");
        setDate("");
        setStartTime("");
        setEndTime("");
        setAttendeeIds([]);
      }
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save meeting.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {!isEdit && currentUserId === null && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-body-small text-amber-900">
          You're signed in as the shared team account, which can't organise a meeting. Sign out
          and sign in with your own @convertedclick.co.za account first.
        </div>
      )}
      {!isEdit && googleConnected === false && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-body-small text-amber-900">
          Your Google Calendar isn't connected — sign out and sign in with Google to let
          Conductor put meetings on your calendar.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="meeting-client">Client</Label>
          <Select
            value={clientId}
            onValueChange={(v) => {
              setClientId(v);
              setProjectId(NO_PROJECT);
            }}
          >
            <SelectTrigger id="meeting-client">
              <SelectValue placeholder="Pick a client" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="meeting-project">Project (optional)</Label>
          <Select value={projectId} onValueChange={setProjectId} disabled={!clientId}>
            <SelectTrigger id="meeting-project">
              <SelectValue placeholder={clientId ? "No project" : "Pick a client first"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PROJECT}>No project</SelectItem>
              {projectOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="meeting-attendees">Attendees</Label>
        <MultiSelect
          options={teamOptions}
          values={attendeeIds}
          onChange={setAttendeeIds}
          placeholder="Pick attendees"
          searchPlaceholder="Search team…"
          emptyLabel="No team members found."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="meeting-title">Title</Label>
        <Input
          id="meeting-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Weekly sync"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="meeting-agenda">Agenda</Label>
        <Textarea
          id="meeting-agenda"
          value={agenda}
          onChange={(e) => setAgenda(e.target.value)}
          placeholder="What's on the table? (optional)"
          rows={3}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="meeting-date">Date</Label>
          <Input
            id="meeting-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="meeting-start">Start</Label>
          <Input
            id="meeting-start"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="meeting-end">End</Label>
          <Input
            id="meeting-end"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>
      {date && startTime && endTime && !timeOrderOk && (
        <p className="text-body-small text-destructive">End time must be after start time.</p>
      )}

      <div className="flex items-center justify-end pt-2">
        <Button type="submit" disabled={!canSubmit} className="gap-2">
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CalendarPlus className="h-4 w-4" />
          )}
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Schedule meeting"}
        </Button>
      </div>
    </form>
  );
}
