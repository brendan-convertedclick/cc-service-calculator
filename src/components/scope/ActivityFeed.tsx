import { FeedEvent } from "./FeedEvent";
import type { ActivityEvent } from "@/hooks/useProjectActivity";

interface Props {
  events: ActivityEvent[];
  isLoading: boolean;
  onAddBrief?: () => void;
}

export function ActivityFeed({ events, isLoading, onAddBrief }: Props) {
  if (isLoading) {
    return (
      <div data-testid="activity-loading" className="flex flex-col gap-4 p-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-m-surface-container" />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
        <p className="text-body-medium text-m-on-surface-variant">No activity yet</p>
        <p className="text-label-small text-m-on-surface-variant">
          Activity from emails, tasks, and quotes will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {events.map((event) => (
        <FeedEvent key={`${event.type}-${event.id}`} event={event} />
      ))}
      {onAddBrief && (
        <button
          onClick={onAddBrief}
          className="mt-2 w-full rounded-lg border border-dashed border-m-outline-variant py-3 text-label-medium text-m-on-surface-variant transition-colors hover:bg-m-surface-container"
        >
          + Add brief to project
        </button>
      )}
    </div>
  );
}
