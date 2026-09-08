// src/components/review/ItemHistory.tsx
//
// How one item has gone, for the client who is holding it.
//
// It slides in OVER the page rather than taking a column of it: the detail
// pane is already the readable measure it should be, and a history that pushes
// the ask, the thread and the buttons sideways every time it opens makes the
// page move under someone mid-read. Nothing behind it shifts by a pixel.
//
// The lines are sentences and times, never bodies. The thread underneath is
// where the words live; a history that repeats them IS the thread, and then
// there is no reason to open it. See historyOf for what it carries instead.

import { ArrowLeftRight, CheckCircle2, Eye, FileText, Mail, MessageSquare } from "lucide-react";
import { historyOf, type ClientEventKind } from "@/lib/client-review";
// The formatter only — client-timeline itself is the STAFF merge and none of
// its event-building reaches this page. "31 Aug at 13:45" is the same sentence
// on both sides and does not deserve a second copy.
import { formatEventTime } from "@/lib/client-timeline";
import type { ReviewItem, ReviewOpen } from "@/types/client-review";

const ICON: Record<ClientEventKind, typeof Mail> = {
  asked: FileText,
  emailed: Mail,
  opened: Eye,
  message: MessageSquare,
  moved: ArrowLeftRight,
  decided: CheckCircle2,
};

/** The list only. The heading is the Sheet's own title, so there is exactly one
 *  "History" heading on the page rather than a visible one and an sr-only one
 *  saying almost the same thing. */
export function ItemHistory({ item, opens }: { item: ReviewItem; opens: ReviewOpen[] }) {
  const events = historyOf(item, opens);
  return (
    <ol className="flex flex-col gap-4">
      {events.map((event) => {
        const Icon = ICON[event.kind];
        return (
          <li key={event.id} className="flex gap-3">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-m-on-surface-variant" />
            <div className="min-w-0">
              <p className="text-body-medium text-m-on-surface">{event.summary}</p>
              <p className="text-label-small text-m-on-surface-variant">
                {formatEventTime(event.at)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
