// src/lib/calendar-month.ts
//
// A month, as a grid, with things on days. Pure — no React, no network, no
// Intl beyond naming the month — so both calendars (the client's and the
// staff one) are laid out by the same function rather than by two that agree
// until one of them is edited.
//
// DATES ARE LOCAL AND STRING-KEYED. Every date in this feature is a
// "YYYY-MM-DD" — client_approvals.due_date is a Postgres `date`, which has no
// timezone and must never be round-tripped through toISOString(). Converted
// Click runs on SAST; a UTC round trip moves every date before 02:00 back a
// day, which on a calendar is not a rounding error, it is the wrong square.

import { todayISO } from "@/lib/dates";

/** One thing sitting on a day. Whatever put it there has already been resolved. */
export type CalendarEntry = {
  id: string;
  /** "YYYY-MM-DD", local. */
  date: string;
  label: string;
  /**
   * What kind of mark it is, which is the whole visual grammar:
   *   event → a date in the client's world; nobody acts on it
   *   due   → something on the list with a date on it
   *   task  → a briefed ClickUp task's due date (staff calendar only)
   */
  kind: "event" | "due" | "task";
  /** Past its date and still open. Events are never late — they just happen. */
  late?: boolean;
  /** Shown on the all-clients calendar, omitted when one client is picked. */
  clientName?: string | null;
};

export type CalendarDay = {
  /** "YYYY-MM-DD" */
  date: string;
  /** 1–31, for the number in the corner. */
  dayOfMonth: number;
  /** False for the leading/trailing days that pad the grid to whole weeks. */
  inMonth: boolean;
  isToday: boolean;
  entries: CalendarEntry[];
};

/** Monday first: the working week is the unit these people plan in. */
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Local "YYYY-MM-DD" for a Date. Never toISOString() — see the header. */
function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** "2026-09" → the month it names, as a local Date on the 1st. */
function firstOf(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1);
}

/** The month a date falls in: "2026-09-14" → "2026-09". */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** This month, as the calendar's initial position. */
export function currentMonth(): string {
  return monthOf(todayISO());
}

/** "2026-09" + 1 → "2026-10". Handles the year boundary via Date, not maths. */
export function shiftMonth(month: string, delta: number): string {
  const d = firstOf(month);
  d.setMonth(d.getMonth() + delta);
  return ymd(d).slice(0, 7);
}

/** "September 2026" — the heading. */
export function monthLabel(month: string): string {
  return firstOf(month).toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
}

/**
 * The grid: whole weeks, Monday first, padded either side so every row has
 * seven days. Five or six rows depending on the month — never a fixed six,
 * because a trailing row of nothing but greyed-out days is a row of noise.
 *
 * Entries are placed by exact date string, so an entry outside the visible
 * range simply does not appear. Within a day they keep the order they were
 * given, which lets the caller decide what leads.
 */
export function monthGrid(
  month: string,
  entries: CalendarEntry[],
  today: string = todayISO(),
): CalendarDay[][] {
  const first = firstOf(month);
  // getDay() is Sunday-based (0=Sun); Monday-first makes Monday 0.
  const lead = (first.getDay() + 6) % 7;

  const start = new Date(first);
  start.setDate(start.getDate() - lead);

  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const trail = (7 - ((lead + last.getDate()) % 7)) % 7;
  const total = lead + last.getDate() + trail;

  const byDate = new Map<string, CalendarEntry[]>();
  for (const e of entries) {
    const list = byDate.get(e.date);
    if (list) list.push(e);
    else byDate.set(e.date, [e]);
  }

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < total; i += 1) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const date = ymd(d);
    const day: CalendarDay = {
      date,
      dayOfMonth: d.getDate(),
      inMonth: monthOf(date) === month,
      isToday: date === today,
      entries: byDate.get(date) ?? [],
    };
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push(day);
  }
  return weeks;
}

/**
 * The months that actually have something on them, oldest first — so "jump to
 * where the work is" is possible on a list that spans a year. Always includes
 * the current month, or an empty calendar has nowhere to start.
 */
export function monthsWithEntries(entries: CalendarEntry[], from: string = currentMonth()): string[] {
  const set = new Set<string>([from]);
  for (const e of entries) set.add(monthOf(e.date));
  return [...set].sort();
}
