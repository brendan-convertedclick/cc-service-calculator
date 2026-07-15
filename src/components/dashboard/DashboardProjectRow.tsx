import { Check, CheckCheck, CheckCircle, TriangleAlert, CircleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/timeAgo";

const statusIcon: Record<string, { icon: LucideIcon; color: string }> = {
  on_track: { icon: CheckCircle, color: "text-m-tertiary" },
  needs_attention: { icon: TriangleAlert, color: "text-amber-500" },
  overdue: { icon: CircleAlert, color: "text-m-error" },
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
  const status = isCompleted
    ? { icon: CheckCheck, color: "text-green-600" }
    : statusIcon[scopeStatus] ?? { icon: CircleAlert, color: "text-gray-400" };
  const StatusIcon = status.icon;

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
            : "text-m-on-surface hover:bg-m-surface-container"
        )}
      >
        <StatusIcon
          data-testid="status-dot"
          className={cn("h-3.5 w-3.5 shrink-0", status.color)}
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
