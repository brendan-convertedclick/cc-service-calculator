/**
 * Local-timezone date helpers.
 *
 * The repo-wide idiom `new Date().toISOString().slice(0, 10)` yields the **UTC**
 * date. Converted Click runs on SAST (UTC+2), so between 00:00 and 02:00 local
 * that expression returns *yesterday* — every "today" default, due-date filter
 * and date-stamped write was wrong for two hours a day.
 */

/** `YYYY-MM-DD` for a date, in the local timezone. */
export function toISODate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Today as `YYYY-MM-DD`, in the local timezone. */
export function todayISO(): string {
  return toISODate(new Date());
}
