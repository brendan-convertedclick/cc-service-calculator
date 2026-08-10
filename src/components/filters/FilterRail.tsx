import type { ReactNode } from "react";

/**
 * Left filter rail building blocks shared by Briefs, Projects, RetainersList
 * and Escalations: a heading over a list of checkbox-style toggle buttons.
 *
 * Presentational only — each page keeps its own selection state and
 * filtering logic and just passes `active` + `onToggle` per option.
 */
export function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-label-medium text-m-on-surface-variant">{label}</h4>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function FilterOption({
  label,
  count,
  active,
  onToggle,
}: {
  label: string;
  count?: number;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-label-medium tracking-normal transition-colors ${
        active
          ? "bg-m-secondary-container text-m-on-secondary-container"
          : "text-m-on-surface hover:bg-m-surface-container"
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          active ? "border-m-primary bg-m-primary text-m-on-primary" : "border-m-outline"
        }`}
      >
        {active && (
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="truncate">{label}</span>
      {count !== undefined && (
        <span className="ml-auto shrink-0 font-mono text-label-small tabular-nums text-m-on-surface-variant">
          {count}
        </span>
      )}
    </button>
  );
}
