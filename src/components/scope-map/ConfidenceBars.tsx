import { cn } from "@/lib/utils";

export type ConfidenceBand = "high" | "med" | "low";

/** Confidence bands: green ≥ 80%, orange 50–80%, red < 50%. */
export function confidenceBand(value: number): ConfidenceBand {
  if (value >= 0.8) return "high";
  if (value >= 0.5) return "med";
  return "low";
}

const BAND_COLOR: Record<ConfidenceBand, string> = {
  high: "bg-emerald-500",
  med: "bg-amber-500",
  low: "bg-red-500",
};

const BAND_LIT: Record<ConfidenceBand, number> = { high: 3, med: 2, low: 1 };

// Ascending bar heights — a little three-line bar graph.
const BAR_HEIGHTS = ["h-1.5", "h-2.5", "h-3.5"];

export interface ConfidenceBarsProps {
  /** Confidence, 0..1. */
  value: number;
  className?: string;
}

/**
 * A small three-bar signal-style graph for match confidence. The number of lit
 * bars and their colour both reflect the band (green ≥80%, orange 50–80%,
 * red <50%); unlit bars are muted.
 */
export function ConfidenceBars({ value, className }: ConfidenceBarsProps) {
  const band = confidenceBand(value);
  const lit = BAND_LIT[band];
  return (
    <span
      className={cn("inline-flex items-end gap-0.5", className)}
      role="img"
      aria-label={`Match confidence ${Math.round(value * 100)}%`}
      title={`Match confidence ${Math.round(value * 100)}%`}
    >
      {BAR_HEIGHTS.map((h, i) => (
        <span
          key={i}
          className={cn(
            "w-1 rounded-sm",
            h,
            i < lit ? BAND_COLOR[band] : "bg-m-outline-variant",
          )}
        />
      ))}
    </span>
  );
}

export default ConfidenceBars;
