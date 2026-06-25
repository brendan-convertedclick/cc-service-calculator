import { ScopeItemChip } from "@/components/scope-map/ScopeItemChip";
import { cn } from "@/lib/utils";
import type { BriefTaskSowPlacement } from "@/types/sow-placements";

export type ScopeMapItem = BriefTaskSowPlacement;

export interface ScopeMapCanvasProps {
  items: ScopeMapItem[];
  /** Titles of the SOWs the analysis ran against — shown as chips above the columns. */
  sowTitles: string[];
  /** Outside items chosen for the cost estimate. */
  selectedRefs: Set<string>;
  onToggleSelect: (ref: string) => void;
  onOverride: (ref: string, isInside: boolean) => void;
}

interface ScopeColumnProps {
  title: string;
  tone: "inside" | "outside";
  items: ScopeMapItem[];
  selectedRefs: Set<string>;
  onToggleSelect: (ref: string) => void;
  onOverride: (ref: string, isInside: boolean) => void;
  emptyHint: string;
}

/** One vertical column — a titled panel that stacks its items top-to-bottom. */
function ScopeColumn({
  title,
  tone,
  items,
  selectedRefs,
  onToggleSelect,
  onOverride,
  emptyHint,
}: ScopeColumnProps) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-xl border",
        tone === "inside"
          ? "border-emerald-200 bg-emerald-50/40"
          : "border-m-outline-variant bg-m-surface-container/40",
      )}
    >
      <header
        className={cn(
          "flex items-center gap-2 border-b px-4 py-2.5",
          tone === "inside" ? "border-emerald-200" : "border-m-outline-variant",
        )}
      >
        <span
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full",
            tone === "inside" ? "bg-emerald-500" : "bg-m-error",
          )}
          aria-hidden="true"
        />
        <span className="text-title-small text-m-on-surface">
          {title} · {items.length}
        </span>
      </header>
      <div className="flex flex-col gap-2 p-3">
        {items.length === 0 ? (
          <p className="px-1 py-8 text-center text-body-small text-m-on-surface-variant">
            {emptyHint}
          </p>
        ) : (
          items.map((item) => (
            <ScopeItemChip
              key={item.task_ref}
              item={item}
              selected={selectedRefs.has(item.task_ref)}
              onToggleSelect={onToggleSelect}
              onOverride={onOverride}
            />
          ))
        )}
      </div>
    </section>
  );
}

/**
 * The scope map: a two-column layout. In-scope asks stack vertically on the
 * left, out-of-scope asks stack vertically on the right. Each row opens a
 * popover with the AI reasoning + override actions. Pure presentation — all
 * data and writes live with the caller.
 */
export function ScopeMapCanvas({
  items,
  sowTitles,
  selectedRefs,
  onToggleSelect,
  onOverride,
}: ScopeMapCanvasProps) {
  if (items.length === 0) {
    return (
      <div className="mx-auto flex min-h-[200px] w-full items-center justify-center rounded-xl border border-dashed border-m-outline-variant">
        <p className="max-w-xs text-center text-body-medium text-m-on-surface-variant">
          No scope items yet. Run the analysis to map this request against the
          client's SOWs.
        </p>
      </div>
    );
  }

  const inside = items.filter((i) => i.is_inside);
  const outside = items.filter((i) => !i.is_inside);

  return (
    <div className="space-y-4" data-testid="scope-map-canvas">
      {sowTitles.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-label-small text-m-on-surface-variant">Mapped against:</span>
          {sowTitles.map((title) => (
            <span
              key={title}
              className="rounded-full bg-m-surface-container px-2.5 py-0.5 text-label-small text-m-on-surface-variant shadow-elev-1"
            >
              {title}
            </span>
          ))}
        </div>
      )}

      <div className="grid items-start gap-4 md:grid-cols-2">
        <ScopeColumn
          title="In scope"
          tone="inside"
          items={inside}
          selectedRefs={selectedRefs}
          onToggleSelect={onToggleSelect}
          onOverride={onOverride}
          emptyHint="Nothing landed in scope."
        />
        <ScopeColumn
          title="Out of scope"
          tone="outside"
          items={outside}
          selectedRefs={selectedRefs}
          onToggleSelect={onToggleSelect}
          onOverride={onOverride}
          emptyHint="Everything is covered — nothing falls outside the SOW."
        />
      </div>
    </div>
  );
}

export default ScopeMapCanvas;
