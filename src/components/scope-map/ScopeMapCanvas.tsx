import { useMemo } from "react";
import { layoutScopeMap, type LayoutItem } from "@/lib/scope-map-layout";
import { ScopeItemChip } from "@/components/scope-map/ScopeItemChip";
import type { BriefTaskSowPlacement } from "@/types/sow-placements";

export type ScopeMapItem = BriefTaskSowPlacement;

export interface ScopeMapCanvasProps {
  items: ScopeMapItem[];
  /** Titles of the SOWs the analysis ran against — chips along the top of the circle. */
  sowTitles: string[];
  /** Outside items chosen for the cost estimate. */
  selectedRefs: Set<string>;
  onToggleSelect: (ref: string) => void;
  onOverride: (ref: string, isInside: boolean) => void;
}

/** Layout-space size — everything is computed in an 800-unit square and
 * rendered responsively via SVG viewBox + %-positioned HTML chips. */
const LAYOUT_SIZE = 800;

/**
 * The scope map: in-scope asks rendered inside a circle (confidence-scaled
 * golden-angle placement), out-of-scope asks on an outer ring with connector
 * lines. Pure presentation — all data and writes live with the caller.
 */
export function ScopeMapCanvas({
  items,
  sowTitles,
  selectedRefs,
  onToggleSelect,
  onOverride,
}: ScopeMapCanvasProps) {
  const layout = useMemo(() => {
    const layoutItems: LayoutItem[] = items.map((i) => ({
      ref: i.task_ref,
      isInside: i.is_inside,
      confidence: i.ai_confidence ?? 0.5,
    }));
    return layoutScopeMap(layoutItems, LAYOUT_SIZE);
  }, [items]);

  const positionByRef = useMemo(
    () => new Map(layout.positions.map((p) => [p.ref, p])),
    [layout],
  );

  const insideCount = items.filter((i) => i.is_inside).length;
  const { cx, cy, r } = layout.circle;
  const pct = (n: number) => `${(n / LAYOUT_SIZE) * 100}%`;

  if (items.length === 0) {
    return (
      <div className="mx-auto flex aspect-square w-full max-w-[760px] items-center justify-center rounded-xl border border-dashed border-m-outline-variant">
        <p className="max-w-xs text-center text-body-medium text-m-on-surface-variant">
          No scope items yet. Run the analysis to map this request against the
          client's SOWs.
        </p>
      </div>
    );
  }

  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-[760px]"
      data-testid="scope-map-canvas"
    >
      <svg
        viewBox={`0 0 ${LAYOUT_SIZE} ${LAYOUT_SIZE}`}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label={`Scope map: ${insideCount} item(s) in scope, ${items.length - insideCount} outside`}
      >
        {/* Connector lines from the circle edge to each outside chip. */}
        {items
          .filter((i) => !i.is_inside)
          .map((i) => {
            const pos = positionByRef.get(i.task_ref);
            if (!pos) return null;
            const dx = pos.x - cx;
            const dy = pos.y - cy;
            const dist = Math.hypot(dx, dy) || 1;
            const edgeX = cx + (dx / dist) * r;
            const edgeY = cy + (dy / dist) * r;
            return (
              <line
                key={i.task_ref}
                x1={edgeX}
                y1={edgeY}
                x2={pos.x}
                y2={pos.y}
                stroke="hsl(var(--mcolor-outline-variant))"
                strokeWidth={2}
              />
            );
          })}
        {/* Main scope circle — soft fill + soft edge. */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="hsl(var(--mcolor-primary-container) / 0.25)"
          stroke="hsl(var(--mcolor-primary) / 0.35)"
          strokeWidth={2}
        />
        {/* Dashed boundary ring for emphasis. */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="hsl(var(--mcolor-primary))"
          strokeWidth={2}
          strokeDasharray="10 12"
        />
      </svg>

      {/* SOW title chips along the top of the circle. */}
      {sowTitles.length > 0 && (
        <div
          className="absolute left-1/2 flex max-w-[80%] -translate-x-1/2 -translate-y-full flex-wrap items-center justify-center gap-1.5 pb-2"
          style={{ top: pct(cy - r) }}
        >
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

      {/* Centre label. */}
      <div
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-label-small text-m-on-surface-variant"
        style={{ left: pct(cx), top: pct(cy) }}
        aria-hidden="true"
      >
        In scope · {insideCount}
      </div>

      {/* Item chips. */}
      {items.map((item) => {
        const pos = positionByRef.get(item.task_ref);
        if (!pos) return null;
        return (
          <ScopeItemChip
            key={item.task_ref}
            item={item}
            x={pos.x}
            y={pos.y}
            size={LAYOUT_SIZE}
            selected={selectedRefs.has(item.task_ref)}
            onToggleSelect={onToggleSelect}
            onOverride={onOverride}
          />
        );
      })}
    </div>
  );
}

export default ScopeMapCanvas;
