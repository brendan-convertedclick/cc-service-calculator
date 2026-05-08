import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useBriefs, type BriefScope } from "@/hooks/useBriefs";
import { STATUS_LABEL } from "@/lib/brief-routing";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

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
}

export function BriefList({ scope, currentUserId, selectedBriefId }: BriefListProps) {
  const { data: briefs = [], isLoading } = useBriefs(scope, currentUserId);

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
              <Badge variant="secondary">{STATUS_LABEL[b.status]}</Badge>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
