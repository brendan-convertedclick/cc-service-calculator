import type { ReactNode } from "react";
import { Check, ChevronDown, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export type StageStatus = "active" | "locked" | "done";

interface StageSectionProps {
  index: number;
  title: string;
  subtitle?: string;
  status: StageStatus;
  open: boolean;
  /** Toggle handler — omitted/ignored when the stage is locked. */
  onToggle?: () => void;
  children: ReactNode;
}

/**
 * One numbered section of the 3-stage brief accordion. Renders a clickable
 * header (number badge + title + status affordance) and a collapsible body.
 * A `locked` stage cannot be opened; `done`/`active` stages toggle freely.
 */
export function StageSection({
  index,
  title,
  subtitle,
  status,
  open,
  onToggle,
  children,
}: StageSectionProps) {
  const locked = status === "locked";
  const done = status === "done";
  const isOpen = open && !locked;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border bg-m-surface shadow-elev-1 transition-colors",
        locked ? "border-m-outline-variant/60 opacity-70" : "border-m-outline-variant",
      )}
    >
      <button
        type="button"
        disabled={locked}
        onClick={onToggle}
        aria-expanded={isOpen}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-3 text-left",
          locked ? "cursor-not-allowed" : "cursor-pointer hover:bg-m-surface-container/40",
        )}
      >
        {/* Number / status badge */}
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-label-large font-medium",
            done && "bg-m-primary text-m-on-primary",
            status === "active" && "bg-m-primary-container text-m-on-primary-container",
            locked && "bg-m-surface-container-high text-m-on-surface-variant",
          )}
        >
          {done ? <Check className="h-4 w-4" /> : locked ? <Lock className="h-3.5 w-3.5" /> : index}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-title-small text-m-on-surface">{title}</span>
          {subtitle && (
            <span className="block truncate text-body-small text-m-on-surface-variant">
              {subtitle}
            </span>
          )}
        </span>

        {done && (
          <span className="shrink-0 rounded-md bg-m-primary/10 px-2 py-0.5 text-label-small text-m-primary">
            Done
          </span>
        )}
        {!locked && (
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-m-on-surface-variant transition-transform",
              isOpen && "rotate-180",
            )}
          />
        )}
      </button>

      {isOpen && (
        <div className="border-t border-m-outline-variant px-4 py-4">{children}</div>
      )}
    </section>
  );
}
