// Meetings, Admin or Delivery (0217, Lisa 2026-11-16): where logged time goes,
// so admin, which nobody can bill, can be seen and cut. The type belongs to
// the ClickUp task and is decided in SQL (task_time_types_resolved); this file
// only adds it up against the Split's bars.

export type TimeType = "meetings" | "admin" | "delivery" | "unclassified";
export const TIME_TYPES: TimeType[] = ["meetings", "admin", "delivery", "unclassified"];
export const TIME_TYPE_LABEL: Record<TimeType, string> = {
  meetings: "Meetings",
  admin: "Admin",
  delivery: "Delivery",
  unclassified: "Unclassified",
};

/** The Split's bars, plus everything logged on a task the Book has no row for. */
export type SplitCategory = "retainer" | "adhoc" | "internal" | "sales" | "offbook";
export const CATEGORY_LABEL: Record<SplitCategory, string> = {
  retainer: "Retainer work",
  adhoc: "Ad hoc work",
  internal: "Our own work",
  sales: "Sales",
  offbook: "Not on the Book",
};

/**
 * Months before this one are shown greyed and kept out of every average.
 * August 2026 logged half of October's hours, so its 6% admin says more about
 * what was not being logged than about the work (Lisa, 2026-11-16). Once three
 * full months after it exist it falls out of the window on its own.
 */
export const FIRST_COUNTED_MONTH = "2026-09";

export interface TypeHoursRow {
  clickup_task_id: string;
  task_name: string | null;
  month: string;
  time_type: TimeType;
  rule: string;
  hours: number | string;
}

export type TypeTotals = Record<TimeType, number> & { total: number };

const zero = (): TypeTotals => ({ meetings: 0, admin: 0, delivery: 0, unclassified: 0, total: 0 });

function add(t: TypeTotals, type: TimeType, h: number) {
  t[type in t ? type : "unclassified"] += h;
  t.total += h;
}

/** One month, per bar and overall. */
export function splitByType(
  rows: TypeHoursRow[],
  month: string,
  categoryOf: (taskId: string) => SplitCategory,
): { all: TypeTotals; byCategory: Record<SplitCategory, TypeTotals> } {
  const all = zero();
  const byCategory = {
    retainer: zero(), adhoc: zero(), internal: zero(), sales: zero(), offbook: zero(),
  } as Record<SplitCategory, TypeTotals>;
  for (const r of rows) {
    if (r.month !== month) continue;
    const h = Number(r.hours) || 0;
    add(all, r.time_type, h);
    add(byCategory[categoryOf(r.clickup_task_id)], r.time_type, h);
  }
  return { all, byCategory };
}

/** Share of a total, 0-100; zero total gives zero, never NaN. */
export const share = (t: TypeTotals, type: TimeType) => (t.total > 0 ? (t[type] / t.total) * 100 : 0);

/** `YYYY-MM` n months before `month`. */
export function monthsBefore(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The trend window: the three full months before `current`, then `current` itself. */
export const trendMonths = (current: string) =>
  [3, 2, 1, 0].map((n) => monthsBefore(current, n));

/**
 * Pooled over the full months in the window that count: hours over hours, not
 * an average of percentages, so a thin month does not weigh as much as a full
 * one. Null when no month counts.
 */
export function averageShare(
  totalsByMonth: Map<string, TypeTotals>,
  current: string,
  type: TimeType,
): { pct: number; months: string[] } | null {
  const months = trendMonths(current)
    .slice(0, 3)
    .filter((m) => m >= FIRST_COUNTED_MONTH && (totalsByMonth.get(m)?.total ?? 0) > 0);
  if (months.length === 0) return null;
  const sum = months.reduce(
    (acc, m) => {
      const t = totalsByMonth.get(m)!;
      return { part: acc.part + t[type], total: acc.total + t.total };
    },
    { part: 0, total: 0 },
  );
  return { pct: (sum.part / sum.total) * 100, months };
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthShort = (m: string) => MONTH_SHORT[Number(m.slice(5, 7)) - 1] ?? m;

/** "Sep–Oct average" or "Sep–Nov average": the label says which months it pooled. */
export const averageLabel = (months: string[]) =>
  months.length === 1
    ? `${monthShort(months[0])} only`
    : `${monthShort(months[0])}–${monthShort(months[months.length - 1])} average`;
