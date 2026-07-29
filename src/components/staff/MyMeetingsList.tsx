import { useState } from "react";
import { CalendarClock, ExternalLink, Pencil, Video, X } from "lucide-react";
import { toast } from "sonner";
import { useCancelMeeting, useInternalMeetings } from "@/hooks/useInternalMeetings";
import type { InternalMeetingWithDetails } from "@/types/internal-meetings";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MeetingFormBody } from "@/components/staff/MeetingFormBody";

const dateTimeFmt = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Johannesburg",
});
const timeFmt = new Intl.DateTimeFormat("en-ZA", {
  timeStyle: "short",
  timeZone: "Africa/Johannesburg",
});

function formatWhen(startsAt: string, endsAt: string): string {
  return `${dateTimeFmt.format(new Date(startsAt))} – ${timeFmt.format(new Date(endsAt))} SAST`;
}

function isFuture(m: InternalMeetingWithDetails): boolean {
  return new Date(m.ends_at).getTime() >= Date.now();
}

/**
 * The caller's own meetings (organiser or attendee — RLS already scopes the
 * query), split into upcoming vs. past/cancelled. Edit opens the same
 * MeetingFormBody inside a dialog; cancel uses an inline confirm swap
 * (no window.confirm, no alert-dialog dependency).
 */
export function MyMeetingsList() {
  const { data: meetings = [], isLoading } = useInternalMeetings();
  const cancelMeeting = useCancelMeeting();
  const [editing, setEditing] = useState<InternalMeetingWithDetails | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const isLiveUpcoming = (m: InternalMeetingWithDetails) => m.status === "scheduled" && isFuture(m);
  const upcoming = meetings.filter(isLiveUpcoming);
  const others = meetings.filter((m) => !isLiveUpcoming(m));

  async function confirmCancel(meeting: InternalMeetingWithDetails) {
    setCancelling(true);
    try {
      const res = await cancelMeeting.mutateAsync(meeting.id);
      if (res.google_sync_error) toast.warning(`Calendar: ${res.google_sync_error}`);
      if (res.clickup_sync_error) toast.warning(`ClickUp: ${res.clickup_sync_error}`);
      toast.success("Meeting cancelled.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel meeting.");
    } finally {
      setCancelling(false);
      setConfirmingId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (meetings.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-m-outline-variant px-4 py-8 text-center text-body-small text-m-on-surface-variant">
        No meetings scheduled yet — use the form above to set one up.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MeetingGroup
        title="Upcoming"
        meetings={upcoming}
        emptyLabel="No upcoming meetings."
        confirmingId={confirmingId}
        cancelling={cancelling}
        onEdit={setEditing}
        onCancelRequest={setConfirmingId}
        onCancelConfirm={confirmCancel}
        onCancelAbort={() => setConfirmingId(null)}
      />
      <MeetingGroup
        title="Past & cancelled"
        meetings={[...others].reverse()}
        emptyLabel="Nothing here yet."
        confirmingId={confirmingId}
        cancelling={cancelling}
        onEdit={setEditing}
        onCancelRequest={setConfirmingId}
        onCancelConfirm={confirmCancel}
        onCancelAbort={() => setConfirmingId(null)}
      />

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit meeting</DialogTitle>
            <DialogDescription>
              Changes are pushed to Google Calendar and the ClickUp task.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <MeetingFormBody key={editing.id} meeting={editing} onSaved={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MeetingGroup({
  title,
  meetings,
  emptyLabel,
  confirmingId,
  cancelling,
  onEdit,
  onCancelRequest,
  onCancelConfirm,
  onCancelAbort,
}: {
  title: string;
  meetings: InternalMeetingWithDetails[];
  emptyLabel: string;
  confirmingId: string | null;
  cancelling: boolean;
  onEdit: (m: InternalMeetingWithDetails) => void;
  onCancelRequest: (id: string) => void;
  onCancelConfirm: (m: InternalMeetingWithDetails) => void;
  onCancelAbort: () => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-title-small text-m-on-surface">{title}</h3>
      {meetings.length === 0 ? (
        <p className="text-body-small text-m-on-surface-variant">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">
          {meetings.map((m) => (
            <div key={m.id} className="rounded-md border border-m-outline-variant bg-m-surface px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-body-medium font-medium text-m-on-surface">{m.title}</span>
                    {m.status === "cancelled" && <Badge variant="destructive">Cancelled</Badge>}
                  </div>
                  <div className="text-body-small text-m-on-surface-variant">
                    {m.client_name ?? "Unknown client"}
                    {m.project_name ? ` · ${m.project_name}` : ""}
                  </div>
                  <div className="flex items-center gap-1.5 text-label-small text-m-on-surface-variant">
                    <CalendarClock className="h-3.5 w-3.5" />
                    {formatWhen(m.starts_at, m.ends_at)}
                  </div>
                  {m.attendees.length > 0 && (
                    <div className="text-label-small text-m-on-surface-variant">
                      {m.attendees.map((a) => a.full_name).join(", ")}
                    </div>
                  )}
                  {m.status === "scheduled" && m.google_sync_error && (
                    <div className="text-label-small text-destructive">Calendar: {m.google_sync_error}</div>
                  )}
                  {m.status === "scheduled" && m.clickup_sync_error && (
                    <div className="text-label-small text-destructive">ClickUp: {m.clickup_sync_error}</div>
                  )}
                </div>

                {m.status === "scheduled" && (
                  <div className="flex flex-wrap items-center gap-2">
                    {isFuture(m) && m.google_meet_url && (
                      <Button asChild variant="outline" size="sm" className="gap-1.5">
                        <a href={m.google_meet_url} target="_blank" rel="noreferrer">
                          <Video className="h-3.5 w-3.5" /> Join
                        </a>
                      </Button>
                    )}
                    {m.clickup_task_url && (
                      <Button asChild variant="outline" size="sm" className="gap-1.5">
                        <a href={m.clickup_task_url} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" /> ClickUp
                        </a>
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => onEdit(m)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    {/* Cancelling deletes the ClickUp task (and any time logged
                        against it), so it's only offered while the meeting is
                        still upcoming — a past meeting's actuals must survive. */}
                    {isFuture(m) &&
                      (confirmingId === m.id ? (
                        <>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={cancelling}
                            onClick={() => onCancelConfirm(m)}
                          >
                            Confirm cancel
                          </Button>
                          <Button variant="ghost" size="sm" onClick={onCancelAbort} disabled={cancelling}>
                            Keep
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-destructive hover:text-destructive"
                          onClick={() => onCancelRequest(m.id)}
                        >
                          <X className="h-3.5 w-3.5" /> Cancel
                        </Button>
                      ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
