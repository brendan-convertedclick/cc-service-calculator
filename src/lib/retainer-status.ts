// Is a client's retainer over, under, or on track this month?
//
// Lisa, 2026-09-02: "this should be where the client retainer is over/ under or
// on track - surely?"
//
// The trap is the month you are standing in. On 2 September, Kings College has
// completed 0.8 of 21.3 planned hours — a plain ratio calls that a disaster,
// and it would call every client a disaster on the 2nd of every month. So a
// month still running is judged against the share of it that has actually
// happened, counted in working days; a month that is over is judged whole.
//
// Working days, not calendar days: retainer work happens Monday to Friday, and
// pro-rating by calendar days makes every client look behind on a Monday.

export type RetainerStatus = "none" | "under" | "on_track" | "over" | "not_started";

export interface StatusInput {
  /** Hours the fee buys this month. */
  planned: number;
  /** Hours completed in the month so far. */
  completed: number;
  /** "YYYY-MM" — the month being shown. */
  month: string;
  /** Injected for tests; defaults to now. */
  today?: Date;
}

export interface StatusResult {
  status: RetainerStatus;
  /** Hours we would expect by now. Equals `planned` for a finished month. */
  expected: number;
  /** completed / expected, or null when there is nothing to compare against. */
  ratio: number | null;
  /** Whether the month is still running — the label reads differently if so. */
  inProgress: boolean;
}

/** Mon–Fri days in `month`, or up to and including `upTo` when given. */
export function workingDays(month: string, upTo?: Date): number {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return 0;
  const last = upTo ? upTo.getDate() : new Date(y, m, 0).getDate();
  let n = 0;
  for (let d = 1; d <= last; d++) {
    const day = new Date(y, m - 1, d).getDay();
    if (day !== 0 && day !== 6) n++;
  }
  return n;
}

export function retainerStatus({ planned, completed, month, today = new Date() }: StatusInput): StatusResult {
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const inProgress = month === currentMonth;

  if (planned <= 0) {
    return { status: "none", expected: 0, ratio: null, inProgress };
  }

  const total = workingDays(month);
  const elapsed = inProgress ? workingDays(month, today) : total;
  const expected = total > 0 ? (planned * elapsed) / total : planned;

  if (completed <= 0) {
    // A month that has barely started has not gone wrong yet; one that is over
    // and delivered nothing has.
    return { status: inProgress && elapsed <= 2 ? "not_started" : "under", expected, ratio: 0, inProgress };
  }

  const ratio = expected > 0 ? completed / expected : null;
  if (ratio === null) return { status: "none", expected, ratio, inProgress };
  // 10% either way is noise on a book where a single task is often a whole
  // hour of a two-hour retainer.
  if (ratio > 1.1) return { status: "over", expected, ratio, inProgress };
  if (ratio < 0.9) return { status: "under", expected, ratio, inProgress };
  return { status: "on_track", expected, ratio, inProgress };
}

export const STATUS_LABEL: Record<RetainerStatus, string> = {
  none: "—",
  not_started: "Just started",
  under: "Under",
  on_track: "On track",
  over: "Over",
};
