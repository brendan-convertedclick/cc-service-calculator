import { Badge } from "@/components/ui/badge";
import { confidenceTier } from "@/lib/scope-receipt";

const TIER_META = {
  high: { variant: "success" as const, label: "High" },
  med: { variant: "warning" as const, label: "Med" },
  low: { variant: "muted" as const, label: "Low" },
};

export interface ConfidenceChipProps {
  confidence: number | null;
  className?: string;
}

/**
 * Small match-confidence chip. Reuses Badge variants — high=success(emerald),
 * med=warning(amber), low=muted(grey). Renders nothing when confidence is
 * unknown so callers can drop it inline without guards.
 */
export function ConfidenceChip({ confidence, className }: ConfidenceChipProps) {
  const tier = confidenceTier(confidence);
  if (!tier) return null;
  const meta = TIER_META[tier];
  const pct = Math.round(Math.max(0, Math.min(1, confidence ?? 0)) * 100);
  return (
    <Badge
      variant={meta.variant}
      className={className}
      title={`Match confidence ${pct}%`}
    >
      {meta.label} {pct}%
    </Badge>
  );
}
