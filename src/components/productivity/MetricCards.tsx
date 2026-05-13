// src/components/productivity/MetricCards.tsx
import type { ProductivityMeta } from "@/hooks/useProductivity";

interface Props {
  meta: ProductivityMeta;
  goalPoints: number;
}

export function MetricCards({ meta, goalPoints }: Props) {
  const pct = goalPoints > 0 ? meta.dailyAvg / goalPoints : 0;
  const avgColor =
    pct >= 1 ? "text-[#34d399]" : pct >= 0.9 ? "text-[#fbbf24]" : "text-[#f87171]";

  return (
    <div className="grid grid-cols-4 gap-3">
      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-4">
        <p className="text-label-small uppercase tracking-widest text-m-on-surface-variant">
          Points
        </p>
        <p className="mt-1 text-2xl font-bold text-m-on-surface">
          {meta.totalPoints}
          <span className="ml-1 text-sm font-normal text-m-on-surface-variant">pts</span>
        </p>
      </div>

      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-4">
        <p className="text-label-small uppercase tracking-widest text-m-on-surface-variant">
          Daily avg
        </p>
        <p className={`mt-1 text-2xl font-bold ${avgColor}`}>
          {meta.dailyAvg}
          <span className="ml-1 text-sm font-normal text-m-on-surface-variant">
            / {goalPoints} goal
          </span>
        </p>
      </div>

      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-4">
        <p className="text-label-small uppercase tracking-widest text-m-on-surface-variant">
          Hours tracked
        </p>
        <p className="mt-1 text-2xl font-bold text-m-on-surface">
          {meta.totalHours}
          <span className="ml-1 text-sm font-normal text-m-on-surface-variant">hrs</span>
        </p>
        <p className="mt-1 text-label-small text-m-on-surface-variant">
          <span className="font-medium text-m-on-surface">{meta.totalOverheadHours}</span> Overhead hrs
        </p>
      </div>

      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-4">
        <p className="text-label-small uppercase tracking-widest text-m-on-surface-variant">
          Contributors
        </p>
        <p className="mt-1 text-2xl font-bold text-m-on-surface">
          {meta.activeContributors}
        </p>
      </div>
    </div>
  );
}
