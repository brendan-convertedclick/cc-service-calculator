// Month > Week > Day for the capacity dashboard (Lisa, 2026-09-21).
//
// One rule makes the three granularities agree: a period is a half-open range
// of LOCAL days, [start, end), and every query that fills the dashboard is
// filtered on that same range. The month view used to hand Postgres a bare
// "2026-09-01", which it reads as UTC midnight — 02:00 SAST — while the
// ongoing-hours reducer bucketed its intervals in browser-local time. The two
// therefore disagreed by two hours at each boundary. Two hours inside 22 days
// is invisible; two hours inside ONE day is a task closed at 01:00 Wednesday
// landing on Tuesday, so the fix is a prerequisite for the day view rather
// than a tidy-up. Same reasoning as `todayISO` in @/lib/dates.
//
// Weeks are ISO, Monday to Sunday, and are NOT clipped to the month: week 40
// of 2026 starts on 28 September and ends on 4 October, and showing four
// fifths of a week would misstate every person's capacity in it. The
// consequence is that the weeks of a month do not sum to the month, which the
// page says out loud rather than hiding.

export type PeriodKind = "month" | "week" | "day";

export interface Period {
  kind: PeriodKind;
  /** What the picker holds: "YYYY-MM", "YYYY-Www" or "YYYY-MM-DD". */
  anchor: string;
  /** First local day in the period, "YYYY-MM-DD". */
  startDate: string;
  /** First local day AFTER the period, "YYYY-MM-DD". Half-open. */
  endDate: string;
  /** The same bounds as instants, for timestamptz columns. */
  startISO: string;
  endISO: string;
  label: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local "YYYY-MM-DD" for a Date, never a UTC round trip. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Midnight local on that date, as an instant the database can compare. */
export function localMidnightISO(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toISOString();
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return localDate(new Date(y, m - 1, d + n));
}

/** The Monday of an ISO week, e.g. "2026-W39". ISO week 1 is the week holding
 *  4 January, so that date's Monday anchors the year. */
export function isoWeekStart(anchor: string): string {
  const [ys, ws] = anchor.split("-W");
  const y = Number(ys);
  const w = Number(ws);
  const jan4 = new Date(y, 0, 4);
  // getDay() is 0 for Sunday; ISO wants Monday=1..Sunday=7.
  const isoDow = jan4.getDay() === 0 ? 7 : jan4.getDay();
  const week1Monday = new Date(y, 0, 4 - (isoDow - 1));
  return localDate(new Date(week1Monday.getFullYear(), week1Monday.getMonth(), week1Monday.getDate() + (w - 1) * 7));
}

/** The ISO week anchor ("YYYY-Www") a local date falls in. */
export function isoWeekOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const isoDow = dt.getDay() === 0 ? 7 : dt.getDay();
  // The Thursday of this week decides which year and week number it is.
  const thursday = new Date(y, m - 1, d - (isoDow - 1) + 3);
  const jan4 = new Date(thursday.getFullYear(), 0, 4);
  const jan4Dow = jan4.getDay() === 0 ? 7 : jan4.getDay();
  const week1Monday = new Date(jan4.getFullYear(), 0, 4 - (jan4Dow - 1));
  const week = Math.round((thursday.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
  return `${thursday.getFullYear()}-W${pad(week)}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function labelFor(kind: PeriodKind, startDate: string, endDate: string): string {
  const [y, m, d] = startDate.split("-").map(Number);
  if (kind === "month") return `${MONTHS[m - 1]} ${y}`;
  if (kind === "day") {
    return new Date(y, m - 1, d).toLocaleDateString("en-ZA", {
      weekday: "short", day: "numeric", month: "short", year: "numeric",
    });
  }
  const last = addDays(endDate, -1);
  const [, lm, ld] = last.split("-").map(Number);
  const fmt = (dd: number, mm: number) => `${dd} ${MONTHS[mm - 1].slice(0, 3)}`;
  // A week that straddles a month or a year says so: "28 Sep to 4 Oct 2026".
  return `${fmt(d, m)} to ${fmt(ld, lm)} ${last.slice(0, 4)}`;
}

/** Build a period from what the picker holds. */
export function periodFor(kind: PeriodKind, anchor: string): Period {
  let startDate: string;
  let endDate: string;
  if (kind === "month") {
    const [y, m] = anchor.split("-").map(Number);
    startDate = `${anchor}-01`;
    endDate = localDate(new Date(y, m, 1));
  } else if (kind === "week") {
    startDate = isoWeekStart(anchor);
    endDate = addDays(startDate, 7);
  } else {
    startDate = anchor;
    endDate = addDays(anchor, 1);
  }
  return {
    kind,
    anchor,
    startDate,
    endDate,
    startISO: localMidnightISO(startDate),
    endISO: localMidnightISO(endDate),
    label: labelFor(kind, startDate, endDate),
  };
}

/** The anchor a picker should hold to show the period containing `date`. */
export function anchorFor(kind: PeriodKind, date: string): string {
  if (kind === "month") return date.slice(0, 7);
  if (kind === "week") return isoWeekOf(date);
  return date;
}

/** Mon–Fri days in [startDate, endDate), optionally only those up to and
 *  including `upTo`. The elapsed half of a period that is still running. */
export function workingDaysBetween(startDate: string, endDate: string, upTo?: Date): number {
  const limit = upTo ? localDate(upTo) : null;
  let n = 0;
  for (let d = startDate; d < endDate; d = addDays(d, 1)) {
    if (limit && d > limit) break;
    const [y, m, dd] = d.split("-").map(Number);
    const dow = new Date(y, m - 1, dd).getDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

/** Whether the period is still running — i.e. `today` falls inside it. */
export function periodInProgress(p: Period, today = new Date()): boolean {
  const t = localDate(today);
  return t >= p.startDate && t < p.endDate;
}
