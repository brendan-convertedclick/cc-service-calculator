// Meetings, Admin or Delivery on every Split bar (Lisa, 2026-11-16). Brendan
// wants to see where time goes, admin above all because nobody can bill it,
// and to model what moving some of it into delivery would be worth.
//
// Every task joins its bar through the same task → row map the Book's tabs
// use, so a bar here is exactly the tab's tracked hours, cut by type. Time on
// a task the Book has no row for is its own bar rather than folded away: it
// holds General Admin and the Sales buckets, about a fifth of the month.
import { useMemo, useState } from "react";
import { useCurrentUserId } from "@/context/AuthContext";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { useSetTaskTimeType, useTimeTypes, useTimeTypesByPerson } from "@/hooks/useTimeTypes";
import { errorMessage } from "@/lib/utils";
import {
  CATEGORY_LABEL, FIRST_COUNTED_MONTH, TIME_TYPES, TIME_TYPE_LABEL,
  averageLabel, averageShare, monthShort, share, splitByType, trendMonths,
  type SplitCategory, type TimeType, type TypeTotals,
} from "@/lib/time-types";

// Validated with the dataviz palette script against the light surface:
// adjacent pairs separate under every colour-vision deficiency. In dark mode
// the token steps sit above the lightness band, so identity is never colour
// alone: every bar carries its legend and its numbers in text.
const FILL: Record<TimeType, string> = {
  meetings: "bg-m-tertiary",
  admin: "bg-m-dept-creative",
  delivery: "bg-m-primary",
  unclassified: "bg-m-outline-variant",
};
// Unclassified is a gap in the data, not a fourth kind of work: hatched.
const HATCH = {
  backgroundImage:
    "repeating-linear-gradient(45deg, transparent 0 3px, hsl(var(--mcolor-on-surface-variant) / 0.35) 3px 4px)",
};

const fmtH = (h: number) => `${Math.round(h * 10) / 10}h`;
const fmtPct = (p: number) => `${Math.round(p)}%`;
const CATEGORIES: SplitCategory[] = ["retainer", "adhoc", "internal", "sales", "offbook"];

function StackedBar({ t }: { t: TypeTotals }) {
  return (
    <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-m-surface-container-high">
      {TIME_TYPES.map((k) =>
        t[k] > 0 ? (
          <div
            key={k}
            className={FILL[k]}
            style={{ width: `${share(t, k)}%`, ...(k === "unclassified" ? HATCH : {}) }}
            title={`${TIME_TYPE_LABEL[k]} ${fmtH(t[k])} · ${fmtPct(share(t, k))}`}
          />
        ) : null,
      )}
    </div>
  );
}

function BarLabels({ t }: { t: TypeTotals }) {
  return (
    <p className="mt-1 text-label-small tabular-nums text-m-on-surface-variant">
      {TIME_TYPES.filter((k) => t[k] > 0)
        .map((k) => `${TIME_TYPE_LABEL[k]} ${fmtH(t[k])} (${fmtPct(share(t, k))})`)
        .join(" · ")}
    </p>
  );
}

export function TimeTypeSplit({
  month,
  currentMonth,
  categoryOf,
}: {
  /** The month the page is showing. */
  month: string;
  /** Today's month: the trend runs up to it, marked in progress. */
  currentMonth: string;
  categoryOf: (taskId: string) => SplitCategory;
}) {
  const months = trendMonths(currentMonth);
  const first = month < months[0] ? month : months[0];
  const { data: rows = [], isLoading, error } = useTimeTypes(first, currentMonth);
  const { role } = useCurrentRole();
  const isLead = role === "admin" || role === "owner";
  const userId = useCurrentUserId();
  const setType = useSetTaskTimeType();
  const people = useTimeTypesByPerson(month, isLead);
  const [trendCat, setTrendCat] = useState<SplitCategory | "all">("all");
  const [onlyUnclassified, setOnlyUnclassified] = useState(true);

  const thisMonth = useMemo(() => splitByType(rows, month, categoryOf), [rows, month, categoryOf]);
  const byMonth = useMemo(
    () => new Map([...new Set([...months, month])].map((m) => [m, splitByType(rows, m, categoryOf)])),
    [rows, months.join(), month, categoryOf], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const pick = (m: string) => {
    const s = byMonth.get(m);
    return s ? (trendCat === "all" ? s.all : s.byCategory[trendCat]) : undefined;
  };
  const avg = averageShare(new Map([...byMonth].map(([m, s]) => [m, s.all])), currentMonth, "admin");

  const tasks = useMemo(() => {
    const m = new Map<string, { id: string; name: string; type: TimeType; rule: string; hours: number }>();
    for (const r of rows) {
      if (r.month !== month) continue;
      const cur = m.get(r.clickup_task_id) ?? {
        id: r.clickup_task_id, name: r.task_name ?? "Untitled task", type: r.time_type, rule: r.rule, hours: 0,
      };
      cur.hours += Number(r.hours) || 0;
      m.set(r.clickup_task_id, cur);
    }
    return [...m.values()]
      .filter((t) => !onlyUnclassified || t.type === "unclassified")
      .sort((a, b) => b.hours - a.hours);
  }, [rows, month, onlyUnclassified]);
  const [showAllTasks, setShowAllTasks] = useState(false);

  const personRows = useMemo(() => {
    const m = new Map<string, TypeTotals>();
    for (const r of people.data ?? []) {
      const t = m.get(r.person) ?? { meetings: 0, admin: 0, delivery: 0, unclassified: 0, total: 0 };
      const h = Number(r.hours) || 0;
      t[r.time_type] += h;
      t.total += h;
      m.set(r.person, t);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [people.data]);

  if (isLoading) return <p className="text-body-medium text-m-on-surface-variant">Loading time types…</p>;
  if (error) return <p className="text-body-medium text-m-error">Could not load time types: {errorMessage(error)}</p>;
  if (thisMonth.all.total <= 0) {
    return <p className="text-body-medium text-m-on-surface-variant">No time was logged in {monthShort(month)}.</p>;
  }

  const running = month === currentMonth;
  return (
    <section className="space-y-6 border-t border-m-outline-variant pt-6">
      <div className="space-y-1">
        <h2 className="text-title-medium text-m-on-surface">Meetings, admin and delivery</h2>
        <p className="text-title-small text-m-on-surface">
          Admin is {fmtPct(share(thisMonth.all, "admin"))} of logged time in {monthShort(month)}
          {running ? " so far" : ""}
          {avg ? ` (${averageLabel(avg.months)}: ${fmtPct(avg.pct)})` : ""}.
        </p>
        <p className="max-w-3xl text-label-small text-m-on-surface-variant">
          All time logged in ClickUp, by the type of work it was logged on. Not on the Book is time on
          tasks no tab counts, such as General Admin and the Sales buckets.
        </p>
      </div>

      <ul className="flex flex-wrap gap-4 text-label-medium text-m-on-surface-variant">
        {TIME_TYPES.map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${FILL[k]}`} style={k === "unclassified" ? HATCH : undefined} />
            {k === "meetings" ? "Meetings (person-hours)" : TIME_TYPE_LABEL[k]}
          </li>
        ))}
      </ul>

      <div className="space-y-4">
        {[["All logged time", thisMonth.all] as const, ...CATEGORIES.map((c) => [CATEGORY_LABEL[c], thisMonth.byCategory[c]] as const)]
          .filter(([, t]) => t.total > 0)
          .map(([label, t]) => (
            <div key={label}>
              <div className="mb-1 flex items-baseline justify-between gap-4">
                <span className="text-title-small text-m-on-surface">{label}</span>
                <span className="font-mono text-body-medium tabular-nums text-m-on-surface-variant">{fmtH(t.total)}</span>
              </div>
              <StackedBar t={t} />
              <BarLabels t={t} />
            </div>
          ))}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-title-small text-m-on-surface">Share by month</h3>
          <div className="flex flex-wrap gap-1">
            {(["all", ...CATEGORIES] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setTrendCat(c)}
                className={`rounded-full border px-3 py-1 text-label-medium ${
                  trendCat === c
                    ? "border-m-primary bg-m-primary-container text-m-on-primary-container"
                    : "border-m-outline-variant text-m-on-surface-variant hover:bg-m-surface-container"
                }`}
              >
                {c === "all" ? "All" : CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </div>
        <table className="w-full text-body-medium">
          <thead className="text-label-medium text-m-on-surface-variant">
            <tr>
              <th className="py-1 text-left font-normal">Month</th>
              <th className="w-1/3 py-1 text-left font-normal" aria-label="Share" />
              {TIME_TYPES.map((k) => (
                <th key={k} className="py-1 text-right font-normal">{TIME_TYPE_LABEL[k]}</th>
              ))}
              <th className="py-1 text-right font-normal">Logged</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const t = pick(m);
              const before = m < FIRST_COUNTED_MONTH;
              return (
                <tr key={m} className={`border-t border-m-outline-variant ${before ? "opacity-50" : ""}`}>
                  <td className="py-2 text-m-on-surface">
                    {monthShort(m)}
                    {m === currentMonth && <span className="ml-2 text-label-small text-m-on-surface-variant">in progress</span>}
                    {before && <span className="ml-2 text-label-small text-m-on-surface-variant">not in the average</span>}
                  </td>
                  <td className="py-2 pr-4">{t && t.total > 0 ? <StackedBar t={t} /> : null}</td>
                  {TIME_TYPES.map((k) => (
                    <td key={k} className="py-2 text-right font-mono tabular-nums text-m-on-surface">
                      {t && t.total > 0 ? fmtPct(share(t, k)) : "–"}
                    </td>
                  ))}
                  <td className="py-2 text-right font-mono tabular-nums text-m-on-surface-variant">
                    {t && t.total > 0 ? fmtH(t.total) : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isLead && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-title-small text-m-on-surface">Tasks in {monthShort(month)}</h3>
            <label className="flex items-center gap-2 text-label-medium text-m-on-surface-variant">
              <input type="checkbox" checked={onlyUnclassified} onChange={(e) => setOnlyUnclassified(e.target.checked)} />
              Unclassified only
            </label>
          </div>
          <p className="text-label-small text-m-on-surface-variant">
            A type you set holds for all future time on that task, so setting it on a bucket once is enough.
          </p>
          {tasks.length === 0 ? (
            <p className="text-body-medium text-m-on-surface-variant">Nothing unclassified this month.</p>
          ) : (
            <div className="divide-y divide-m-outline-variant rounded-md border border-m-outline-variant">
              {(showAllTasks ? tasks : tasks.slice(0, 25)).map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-body-medium text-m-on-surface">{t.name}</p>
                    <p className="text-label-small text-m-on-surface-variant">
                      {fmtH(t.hours)} · {TIME_TYPE_LABEL[t.type]}, {t.rule}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {(["meetings", "admin", "delivery"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        disabled={setType.isPending}
                        onClick={() => setType.mutate({ taskId: t.id, type: k, by: userId })}
                        className={`rounded-full border px-3 py-1 text-label-medium ${
                          t.type === k
                            ? "border-m-primary bg-m-primary-container text-m-on-primary-container"
                            : "border-m-outline-variant text-m-on-surface-variant hover:bg-m-surface-container"
                        }`}
                      >
                        {TIME_TYPE_LABEL[k]}
                      </button>
                    ))}
                    {t.rule === "set by hand" && (
                      <button
                        type="button"
                        disabled={setType.isPending}
                        onClick={() => setType.mutate({ taskId: t.id, type: null, by: userId })}
                        className="px-2 py-1 text-label-medium text-m-on-surface-variant underline"
                      >
                        Let the rules decide
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!showAllTasks && tasks.length > 25 && (
            <button type="button" onClick={() => setShowAllTasks(true)} className="text-label-medium text-m-primary">
              Show all {tasks.length}
            </button>
          )}
          {setType.error && <p className="text-label-medium text-m-error">{errorMessage(setType.error)}</p>}
        </div>
      )}

      {isLead && personRows.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-title-small text-m-on-surface">By person in {monthShort(month)}</h3>
          <p className="text-label-small text-m-on-surface-variant">Visible to Brendan and Lisa only.</p>
          <table className="w-full text-body-medium">
            <thead className="text-label-medium text-m-on-surface-variant">
              <tr>
                <th className="py-1 text-left font-normal">Person</th>
                {TIME_TYPES.map((k) => (
                  <th key={k} className="py-1 text-right font-normal">{TIME_TYPE_LABEL[k]}</th>
                ))}
                <th className="py-1 text-right font-normal">Admin share</th>
              </tr>
            </thead>
            <tbody>
              {personRows.map(([name, t]) => (
                <tr key={name} className="border-t border-m-outline-variant">
                  <td className="py-2 text-m-on-surface">{name}</td>
                  {TIME_TYPES.map((k) => (
                    <td key={k} className="py-2 text-right font-mono tabular-nums text-m-on-surface">{fmtH(t[k])}</td>
                  ))}
                  <td className="py-2 text-right font-mono tabular-nums text-m-on-surface">{fmtPct(share(t, "admin"))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-1 text-label-small text-m-on-surface-variant">
        <p>Meetings are person-hours: a 30-minute stand-up with five people counts as 2.5h.</p>
        <p>
          Rize decides which task time lands on. An email written while a design task&apos;s timer is running counts as
          delivery, so the real admin share is probably a little higher than shown.
        </p>
        <p>August is shown faded and left out of the average: it logged about half of October&apos;s hours.</p>
      </div>
    </section>
  );
}
