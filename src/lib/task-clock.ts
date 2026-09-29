// src/lib/task-clock.ts
//
// The clock on a pipeline card: green "Due in 3d", or red "12d rotting" once
// the date has passed. Pure, string-keyed on "YYYY-MM-DD" like the rest of
// the pipeline (a toISOString round trip moves SAST dates a day).
//
// Which cards carry one:
//  * a task with a real due_date, always — that date was set for a reason and
//    a missed one must not go quiet because it sits in an old column;
//  * a task without one only while its column is the calendar month or the
//    one before it. Its date is then the column's last day, the same rule
//    school_task_due_on uses. Older plans carry no clock, or every untouched
//    row of a year mapped from January would be red.
//
// "Calendar month" is read from starts_on, not from currentMonthNo: that one
// is the first month nobody has closed, which is a bookkeeping fact, not a
// date.

export interface TaskClock {
  kind: "due" | "rot";
  days: number;
}

interface ClockTask {
  state: "planned" | "scheduled" | "done";
  due_date: string | null;
  month_no: number;
}

interface ClockMonth {
  month_no: number;
  starts_on: string;
}

const DAY_MS = 86_400_000;

function dayNo(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** Last day of the month a column starts in. */
function monthEnd(startsOn: string): string {
  const [y, m] = startsOn.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0));
  return last.toISOString().slice(0, 10);
}

/** The column the calendar is in today, or null outside the year. */
export function calendarMonthNo(months: ClockMonth[], today: string): number | null {
  let hit: number | null = null;
  for (const m of [...months].sort((a, b) => a.month_no - b.month_no)) {
    if (m.starts_on <= today) hit = m.month_no;
  }
  const last = hit == null ? undefined : months.find((m) => m.month_no === hit);
  return last && monthEnd(last.starts_on) >= today ? hit : null;
}

export function taskClock(task: ClockTask, months: ClockMonth[], today: string): TaskClock | null {
  if (task.state === "done") return null;

  let due = task.due_date;
  if (!due) {
    const current = calendarMonthNo(months, today);
    if (current == null || (task.month_no !== current && task.month_no !== current - 1)) return null;
    const column = months.find((m) => m.month_no === task.month_no);
    if (!column) return null;
    due = monthEnd(column.starts_on);
  }

  const days = dayNo(due) - dayNo(today);
  return days >= 0 ? { kind: "due", days } : { kind: "rot", days: -days };
}

export function clockLabel(c: TaskClock): string {
  if (c.kind === "rot") return `${c.days}d rotting`;
  return c.days === 0 ? "Due today" : `Due in ${c.days}d`;
}
