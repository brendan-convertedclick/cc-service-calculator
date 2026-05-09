import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useBriefs, type BriefScope, type BriefFilterOptions } from "@/hooks/useBriefs";
import { STATUS_LABEL } from "@/lib/brief-routing";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

type IntentType = "new_brief" | "project_thread" | "retainer_thread" | "general_query" | "quick_response";

const INTENT_LABEL: Record<IntentType, string> = {
  new_brief: "NEW",
  project_thread: "PROJECT",
  retainer_thread: "RETAINER",
  general_query: "QUERY",
  quick_response: "QUICK",
};

const INTENT_CLASS: Record<IntentType, string> = {
  new_brief: "bg-blue-100 text-blue-800",
  project_thread: "bg-purple-100 text-purple-800",
  retainer_thread: "bg-orange-100 text-orange-800",
  general_query: "bg-gray-100 text-gray-700",
  quick_response: "bg-green-100 text-green-800",
};

function IntentBadge({ type }: { type: string | null }) {
  if (!type) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-label-small text-gray-400">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-gray-300" />
        pending
      </span>
    );
  }
  const cls = INTENT_CLASS[type as IntentType] ?? "bg-gray-100 text-gray-700";
  const label = INTENT_LABEL[type as IntentType] ?? type;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-label-small font-medium ${cls}`}>
      {label}
    </span>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-ZA");
}

const EMPTY: Record<BriefScope, string> = {
  mine: "No briefs assigned to you.",
  unassigned: "All briefs are assigned.",
  waiting: "No briefs awaiting client response.",
  all: "No briefs yet.",
};

interface BriefListProps {
  scope: BriefScope;
  currentUserId?: string | null;
  selectedBriefId?: string;
  filterOptions?: BriefFilterOptions;
}

export function BriefList({ scope, currentUserId, selectedBriefId, filterOptions }: BriefListProps) {
  const { data: briefs = [], isLoading } = useBriefs(scope, currentUserId, filterOptions);

  if (isLoading) {
    return <div className="text-body-medium text-m-on-surface-variant p-4">Loading…</div>;
  }
  if (briefs.length === 0) {
    return <div className="text-body-medium text-m-on-surface-variant p-4">{EMPTY[scope]}</div>;
  }

  return (
    <div className="space-y-2">
      {briefs.map((b: Brief) => (
        <Link key={b.id} to={`/inbox/${b.id}`} className="block">
          <Card
            className={`transition-colors hover:bg-m-surface-container ${
              selectedBriefId === b.id ? "ring-2 ring-m-primary" : ""
            }`}
          >
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="truncate text-title-small">
                  {b.raw_subject ?? "(no subject)"}
                </div>
                <div className="text-label-small text-m-on-surface-variant">
                  {b.sender_email ?? "manual"}
                  {b.message_count > 0 &&
                    ` · ${b.message_count} msg${b.message_count !== 1 ? "s" : ""}`}
                  {b.last_message_at && ` · ${relativeTime(b.last_message_at)}`}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <IntentBadge type={b.intent_type ?? null} />
                <Badge variant="secondary">{STATUS_LABEL[b.status]}</Badge>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
