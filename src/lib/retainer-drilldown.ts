// Which still-open items belong on the month you picked.
//
// Lisa, 2026-09-09: "when you select your month, and then click on any of the
// retainer or non retainer dropdowns, can we only show tasks that are due in
// that month selected?"
//
// The strict reading — due date inside the month, nothing else — hides 67 items
// that are overdue from earlier months, which is the opposite of useful: an item
// three weeks late is the one you most need to see. So the rule is everything
// due BY THE END of the month you picked, with the due date shown beside it so
// an old one reads as old rather than as this month's work.
//
// An item with no due date at all is shown. "We never gave it a date" is not
// the same as "it is not this month", and 22 of them would otherwise vanish
// from every month at once.

/** Last day of a "YYYY-MM" month, as "YYYY-MM-DD". Local strings throughout —
 *  `original_due_date` is a Postgres date with no timezone, and a toISOString
 *  round trip moves every SAST date before 02:00 into the previous day. */
export function endOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  // Day 0 of the next month is the last day of this one.
  const last = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 0));
  return `${month}-${String(last.getUTCDate()).padStart(2, "0")}`;
}

/** Is this open item's due date on or before the end of the selected month? */
export function dueByEndOf(month: string, dueDate: string | null | undefined): boolean {
  if (!dueDate) return true;
  return dueDate.slice(0, 10) <= endOfMonth(month);
}

/** Open items that belong on `month`, and the points they carry. Returned
 *  together so the number on the row and the list behind it are computed once
 *  and cannot disagree — the two drifting apart is the defect this page keeps
 *  producing when a count is summed separately from the rows it counts. */
export function openForMonth<T extends { dueDate: string | null; hours: number }>(
  month: string,
  items: T[],
): { items: T[]; hours: number } {
  const kept = items.filter((i) => dueByEndOf(month, i.dueDate));
  return { items: kept, hours: kept.reduce((n, i) => n + i.hours, 0) };
}
