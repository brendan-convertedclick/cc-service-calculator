import type { ProjectEventRow } from "@/types/project-problems";

const EVENT_LABEL: Record<string, string> = {
  task_created: "Task created",
  task_completed: "Task completed",
  task_reopened: "Task reopened",
  status_changed: "Status changed",
  points_changed: "Sprint points changed",
  extension_submitted: "Extension submitted",
  extension_approved: "Extension approved",
  extension_rejected: "Extension rejected",
  brief_approved: "Brief approved",
  ce_drafted: "CE drafted",
  ce_sent: "CE sent",
  ce_approved: "CE approved",
  ce_rejected: "CE rejected",
  time_logged: "Time logged",
};

export function EventTimeline({ events }: { events: ProjectEventRow[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-m-outline-variant px-4 py-10 text-center text-body-medium text-m-on-surface-variant">
        No events yet. Run "Sync now" to pull from ClickUp.
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {events.map((e) => (
        <li
          key={e.id}
          className="grid grid-cols-[auto,1fr] gap-3 border-l-2 border-m-outline-variant pl-4 pb-1"
        >
          <div className="text-label-small text-m-on-surface-variant whitespace-nowrap pt-0.5">
            {new Date(e.occurred_at).toLocaleString()}
          </div>
          <div>
            <div className="text-body-medium text-m-on-surface">
              {EVENT_LABEL[e.event_type] ?? e.event_type}
            </div>
            {Object.keys(e.payload ?? {}).length > 0 && (
              <pre className="mt-1 overflow-x-auto rounded bg-m-surface-container px-2 py-1 text-label-small text-m-on-surface-variant">
                {JSON.stringify(e.payload, null, 2)}
              </pre>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
