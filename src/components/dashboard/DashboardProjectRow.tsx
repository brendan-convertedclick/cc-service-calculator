import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/timeAgo";

const statusDot: Record<string, string> = {
  on_track: "bg-m-tertiary",
  needs_attention: "bg-amber-400",
  overdue: "bg-m-error",
};

interface Props {
  id: string;
  name: string;
  engagementType: string;
  scopeStatus: string;
  isSelected: boolean;
  isCompleted?: boolean;
  lastActivityAt?: string;
  onSelect: (id: string) => void;
  onHide: (id: string) => void;
}

export function DashboardProjectRow({ id, name, engagementType, scopeStatus, isSelected, isCompleted, lastActivityAt, onSelect, onHide }: Props) {
  return (
    <div className={cn("group relative", isCompleted && "opacity-60")}>

      <button
        aria-label={name}
        onClick={() => onSelect(id)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
          isSelected
            ? "bg-m-primary-container text-m-on-primary-container"
            : isCompleted
            ? "cursor-default text-m-on-surface-variant"
            : "text-m-on-surface-variant/60 hover:bg-m-surface-container hover:text-m-on-surface"
        )}
      >
        <span
          data-testid="status-dot"
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDot[scopeStatus] ?? "bg-gray-400")}
        />
        <span className="flex-1 truncate text-label-medium">{name}</span>
        {lastActivityAt && (
          <span className="shrink-0 text-[10px] tabular-nums text-current opacity-50">
            {timeAgo(lastActivityAt).replace(" ago", "")}
          </span>
        )}
        <span className="shrink-0 text-[9px] font-medium uppercase tracking-wider text-current opacity-40">
          {engagementType}
        </span>
      </button>


      <button
        aria-label="dismiss"
        onClick={(e) => { e.stopPropagation(); onHide(id); }}
        className="absolute right-1.5 top-1/2 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded bg-m-surface-container text-m-on-surface-variant hover:bg-m-surface-container-high hover:text-m-on-surface group-hover:flex"
      >
        <Check className="h-3 w-3" />
      </button>
    </div>
  );
}
