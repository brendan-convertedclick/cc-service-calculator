import { Mail, FileText, Clock } from "lucide-react";
import type { ActivityEvent } from "@/hooks/useProjectActivity";

const intentLabels: Record<string, string> = {
  new_brief: "New brief",
  project_thread: "Project thread",
  retainer_thread: "Retainer thread",
  general_query: "Query",
  quick_response: "Quick response",
};

function formatZAR(cents: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
    cents / 100
  );
}

function relativeDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

interface Props {
  event: ActivityEvent;
}

export function FeedEvent({ event }: Props) {
  if (event.type === "brief") {
    const { brief } = event;
    return (
      <div className="flex gap-3">
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-m-primary-container">
          <Mail className="h-3.5 w-3.5 text-m-on-primary-container" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-body-medium text-m-on-surface">
              {brief.raw_subject ?? "(no subject)"}
            </span>
            {brief.intent_type && (
              <span className="rounded px-1.5 py-0.5 text-[10px] bg-m-surface-container text-m-on-surface-variant">
                {intentLabels[brief.intent_type] ?? brief.intent_type}
              </span>
            )}
          </div>
          <div className="text-label-small text-m-on-surface-variant">
            {brief.sender_email} · {relativeDate(event.timestamp)}
          </div>
        </div>
      </div>
    );
  }

  if (event.type === "quote") {
    const { quote } = event;
    return (
      <div className="flex gap-3">
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-m-surface-container">
          <FileText className="h-3.5 w-3.5 text-m-on-surface-variant" />
        </div>
        <div className="flex-1">
          <div className="text-body-medium text-m-on-surface">
            Quote {quote.status === "sent" ? "sent" : quote.status} —{" "}
            {formatZAR(quote.total_cents ?? 0)}
          </div>
          <div className="text-label-small text-m-on-surface-variant">
            {relativeDate(event.timestamp)}
          </div>
        </div>
      </div>
    );
  }

  if (event.type === "actuals_update") {
    return (
      <div className="flex gap-3">
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-m-surface-container">
          <Clock className="h-3.5 w-3.5 text-m-on-surface-variant" />
        </div>
        <div className="flex-1">
          <div className="text-body-medium text-m-on-surface">
            {event.departmentName} — {event.totalHours}h logged
          </div>
          <div className="text-label-small text-m-on-surface-variant">
            {relativeDate(event.timestamp)}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
