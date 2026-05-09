import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/timeAgo";

const statusDot: Record<string, string> = {
  on_track: "bg-green-500",
  needs_attention: "bg-amber-400",
  overdue: "bg-red-500",
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
          "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-label-medium transition-colors text-left",
          isSelected
            ? "bg-m-primary-container text-m-on-primary-container"
            : isCompleted
            ? "text-m-on-surface-variant cursor-default"
            : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
        )}
      >
        <span
          data-testid="status-dot"
          className={cn("h-2 w-2 shrink-0 rounded-full", statusDot[scopeStatus] ?? "bg-gray-400")}
        />
        <span className="flex-1 truncate">{name}</span>
        {lastActivityAt && (
          <span className="shrink-0 text-[10px] text-m-on-surface-variant">
            {timeAgo(lastActivityAt)}
          </span>
        )}
        <span className="shrink-0 rounded px-1 py-0.5 text-[10px] bg-m-surface-container text-m-on-surface-variant">
          {engagementType}
        </span>
      </button>

      <button
        aria-label="dismiss"
        onClick={(e) => { e.stopPropagation(); onHide(id); }}
        className="absolute right-8 top-1/2 -translate-y-1/2 hidden group-hover:flex h-5 w-5 items-center justify-center rounded text-[10px] text-m-on-surface-variant hover:bg-m-surface-container-high"
      >
        ✓
      </button>
    </div>
  );
}
