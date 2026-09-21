// "Where is the team's time going" (Lisa, 2026-09-21). The Book's other tabs
// each answer for one category; this one reads across all of them.
//
// It never recomputes anything: every figure is the Completed total the tab
// beside it already shows, so the split and the tabs cannot disagree. See
// @/lib/retainer-split for what folds into what and why it is said out loud
// rather than folded quietly.
import { splitHours, type SplitInput } from "@/lib/retainer-split";

export interface SplitContributor {
  clientName: string;
  hours: number;
}

export interface SplitTabProps extends SplitInput {
  /** Per category, who the hours belonged to. Already sorted by the caller. */
  contributors: Record<"retainer" | "adhoc" | "internal", SplitContributor[]>;
}

const fmtHours = (h: number) => `${Math.round(h * 10) / 10}h`;
const TOP_N = 5;

export function SplitTab({ contributors, ...input }: SplitTabProps) {
  const rows = splitHours(input);
  const total = rows.reduce((n, r) => n + r.hours, 0);

  if (total <= 0) {
    return (
      <p className="rounded-md border border-m-outline-variant bg-m-surface-container-low px-4 py-6 text-body-medium text-m-on-surface-variant">
        Nothing has been completed in this month yet, so there is no split to show.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-label-small text-m-on-surface-variant">
        How the month's completed hours divide between the three. Counted the
        same way the Completed column is: logged time where somebody tracked it,
        the points on the task where nobody did. That is a different basis from
        the capacity page, which is points only, so the two will not match hour
        for hour.
      </p>

      {/* One bar, three segments, so the shares are compared against each
          other rather than each read on its own. */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-m-surface-container-high">
        {rows.map((r, i) => (
          r.pct > 0 && (
            <div
              key={r.key}
              className={
                i === 0 ? "bg-m-primary" : i === 1 ? "bg-m-tertiary" : "bg-m-outline"
              }
              style={{ width: `${r.pct}%` }}
              title={`${r.label} ${fmtHours(r.hours)}`}
            />
          )
        ))}
      </div>

      <div className="divide-y divide-m-outline-variant rounded-md border border-m-outline-variant">
        {rows.map((r, i) => {
          const who = contributors[r.key] ?? [];
          const shown = who.slice(0, TOP_N);
          const rest = who.length - shown.length;
          return (
            <div key={r.key} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      i === 0 ? "bg-m-primary" : i === 1 ? "bg-m-tertiary" : "bg-m-outline"
                    }`}
                  />
                  <span className="text-title-small text-m-on-surface">{r.label}</span>
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-title-medium tabular-nums text-m-on-surface">
                    {Math.round(r.pct)}%
                  </span>
                  <span className="font-mono text-body-medium tabular-nums text-m-on-surface-variant">
                    {fmtHours(r.hours)}
                  </span>
                </div>
              </div>
              {r.note && (
                <p className="mt-1 text-label-small text-m-on-surface-variant">{r.note}</p>
              )}
              {shown.length > 0 && (
                <p className="mt-2 text-label-small text-m-on-surface-variant">
                  {shown.map((c) => `${c.clientName} ${fmtHours(c.hours)}`).join(" · ")}
                  {rest > 0 && ` · and ${rest} more`}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
