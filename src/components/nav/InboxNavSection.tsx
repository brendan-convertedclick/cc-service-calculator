import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInboxBriefs } from "@/hooks/useInboxBriefs";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

interface Props {
  onSelectBrief: (brief: Brief) => void;
}

export function InboxNavSection({ onSelectBrief }: Props) {
  const { data: briefs = [], isLoading } = useInboxBriefs();

  if (isLoading || briefs.length === 0) return null;

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Inbox className="h-3.5 w-3.5 text-m-on-surface-variant" />
        <span className="text-label-small uppercase tracking-wide text-m-on-surface-variant">
          Inbox
        </span>
        <span className="ml-auto rounded-full bg-m-primary px-1.5 py-0.5 text-[10px] font-medium text-m-on-primary">
          {briefs.length}
        </span>
      </div>

      <div className="flex flex-col gap-0.5 pl-2">
        {briefs.map((brief) => (
          <button
            key={brief.id}
            onClick={() => onSelectBrief(brief)}
            className={cn(
              "flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition-colors",
              "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
            )}
          >
            <span className="truncate text-label-medium">
              {brief.raw_subject ?? "(no subject)"}
            </span>
            <span className="text-label-small text-m-on-surface-variant">
              {brief.sender_email}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
