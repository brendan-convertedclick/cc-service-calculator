import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useClientProjects } from "@/hooks/useClientProjects";
import { useTeam } from "@/hooks/useTeam";
import { useDepartments } from "@/hooks/useDepartments";
import { useCreateMeeting, useUpdateMeeting } from "@/hooks/useInternalMeetings";
import type { InternalMeetingWithDetails, ManageMeetingResponse } from "@/types/internal-meetings";
import { errorMessage } from "@/lib/utils";
import { callEdgeFn } from "@/lib/edge";
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

const NO_PROJECT = "__none__";
const NO_WORK_STREAM = "__none__";
const STATUS_DEFAULT = "__default__";

/** Same priority order manage-internal-meeting's resolveMeetingListId uses to
 * pick a meeting's ClickUp list — mirrored here purely to scope the Status
 * dropdown to the right list's options; the server remains the source of
 * truth for which list the task actually lands in. */
const MEETING_LIST_NAMES = ["meetings", "overhead", "admin", "administration"];

type MeetingListStatus = { status: string; color: string | null; type: string; orderindex: number };
type MeetingListOption = { id: string; name: string; statuses: MeetingListStatus[] };
type MeetingWorkStreamOption = { id: string; name: string };

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
  const { data: departments = [] } = useDepartments();
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
  const [workStream, setWorkStream] = useState(meeting?.work_stream_override ?? NO_WORK_STREAM);
  const [status, setStatus] = useState(meeting?.clickup_status_override ?? STATUS_DEFAULT);
  const [submitting, setSubmitting] = useState(false);
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);

  // Connection status only matters when scheduling fresh — surfacing it
  // inside the edit dialog for an already-synced meeting is just noise.
  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;
    (async () => {
      try {
        const body = await callEdgeFn<{ connected?: boolean }>("google-token?action=status");
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

  // Real ClickUp Work Stream options + the meeting-list's statuses, for the
  // client's folder — mirrors QuickBriefSheet's fetch pattern. Gated on
  // clientId so picking a client is what triggers the lookup.
  const [listOptions, setListOptions] = useState<MeetingListOption[]>([]);
  const [workStreamOptions, setWorkStreamOptions] = useState<MeetingWorkStreamOption[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [listsError, setListsError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) {
      setListOptions([]);
      setWorkStreamOptions([]);
      return;
    }
    let cancelled = false;
    setLoadingLists(true);
    setListsError(null);
    (async () => {
      try {
        const body = await callEdgeFn<{
          lists?: MeetingListOption[];
          work_stream_options?: MeetingWorkStreamOption[];
        }>("list-client-clickup-lists", { client_id: clientId });
        if (cancelled) return;
        setListOptions(body.lists ?? []);
        setWorkStreamOptions(body.work_stream_options ?? []);
      } catch (e) {
        if (!cancelled) setListsError(errorMessage(e));
      } finally {
        if (!cancelled) setLoadingLists(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // Same list-name priority the server (resolveMeetingListId) uses, so the
  // Status dropdown reflects the list the task will actually land in.
  const meetingList = useMemo(() => {
    for (const name of MEETING_LIST_NAMES) {
      const hit = listOptions.find((l) => l.name.trim().toLowerCase() === name);
      if (hit) return hit;
    }
    return listOptions[0];
  }, [listOptions]);

  // ClickUp's real "Work Stream" options are the correct label set; fall
  // back to Conductor's department names if the fetch failed or came back
  // empty, so staff are never hard-blocked from picking one.
  const workStreamSource = workStreamOptions.length > 0 ? workStreamOptions : departments;

  // Reset to the list default whenever the resolved meeting list changes
  // (e.g. client switched) — an edit's saved status only applies to its own
  // meeting list.
  useEffect(() => {
    if (!isEdit) setStatus(STATUS_DEFAULT);
  }, [meetingList?.id, isEdit]);

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
      const workStreamValue = workStream === NO_WORK_STREAM ? null : workStream;
      const statusValue = status === STATUS_DEFAULT ? null : status;
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
          work_stream_override: workStreamValue,
          clickup_status_override: statusValue,
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
          work_stream_override: workStreamValue,
          clickup_status_override: statusValue,
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
        setWorkStream(NO_WORK_STREAM);
        setStatus(STATUS_DEFAULT);
      }
      onSaved?.();
    } catch (err) {
      toast.error(`Failed to save meeting: ${errorMessage(err)}`);
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="meeting-work-stream">Work stream (optional)</Label>
          <Select
            value={workStream}
            onValueChange={setWorkStream}
            disabled={!clientId || loadingLists}
          >
            <SelectTrigger id="meeting-work-stream">
              <SelectValue
                placeholder={
                  !clientId
                    ? "Pick a client first"
                    : loadingLists
                      ? "Loading…"
                      : "Project/list default"
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_WORK_STREAM}>Project/list default</SelectItem>
              {workStreamSource.map((d) => (
                <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {listsError && (
            <p className="text-body-small text-m-on-surface-variant">
              Couldn't load ClickUp's Work Stream options ({listsError}) — showing departments instead.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="meeting-status">Status (optional)</Label>
          <Select value={status} onValueChange={setStatus} disabled={!meetingList}>
            <SelectTrigger id="meeting-status">
              <SelectValue placeholder="— List default —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={STATUS_DEFAULT}>— List default —</SelectItem>
              {(meetingList?.statuses ?? []).map((s) => (
                <SelectItem key={s.status} value={s.status}>{s.status}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
