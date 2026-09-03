// src/lib/pipeline-year.ts
//
// Pure derivation: a school's five planning answers → its twelve themed
// months and the tasks seeded into them. No Supabase, no React — this is the
// half of create_school_year() that vitest can reach; schedule_school_year_month
// in the migration does the date maths (due dates, client_approvals) because
// that needs "today" and a live row, not a plan.
//
// DATES ARE "YYYY-MM-DD" STRINGS THROUGHOUT, never a toISOString() round trip
// — see src/lib/dates.ts and src/lib/calendar-month.ts's header for why.

import { monthOf, shiftMonth } from "@/lib/calendar-month";
import { todayISO } from "@/lib/dates";

export type ThemeRole =
  | "spine" | "open_day_before" | "open_day" | "open_day_after" | "prize" | "filler" | "overlay";

export interface TemplateTheme {
  id: string;
  theme: string;
  role: ThemeRole;
  pinned_month: number | null;
  ordinal: number;
  /** Overlay themes only: which of the twelve months this theme's tasks are
   *  seeded into, ON TOP of the month's own theme. Null/absent on the six slot
   *  roles, whose month deriveMonths decides. Optional (not required) only so
   *  older fixtures that don't set it still typecheck — see is_gate below. */
  months?: number[] | null;
}

export interface TemplateTask {
  theme_id: string;
  label: string;
  side: "us" | "school";
  department_id: string | null;
  est_hours: number | null;
  ordinal: number;
  /** True on exactly one row per template: the six-week hard deadline in the
   *  open_day_before theme. Optional (not boolean) only so older fixtures
   *  that don't set it still typecheck — seedTasks below defaults it. */
  is_gate?: boolean;
}

/** The five answers, verbatim. Only open_days shapes the year. */
export interface PlanningAnswers {
  applications_open_on: string | null;
  applications_close_on: string | null;
  open_days: string[]; // real "YYYY-MM-DD" dates, sorted ascending, deduped — NOT month chips (D1)
  offers_out_on: string | null;
  deposits_due_on: string | null;
  budget_set_month: string | null;
  grade_variations: string;
}

export interface DerivedMonth {
  month_no: number;
  theme: string;
  role: ThemeRole;
  starts_on: string;
  theme_id: string;
}

export interface SeedTask {
  month_no: number;
  label: string;
  side: "us" | "school";
  department_id: string | null;
  est_hours: number | null;
  source: "template";
  service_id: null;
  ordinal: number;
  is_gate: boolean;
}

export type PlanningWarning =
  | { kind: "open_day_in_pinned_month"; month_no: number; date: string }
  | { kind: "open_day_outside_year"; date: string }
  | { kind: "six_week_breach"; month_no: number; date: string; days: number }
  | { kind: "build_month_unplaced"; date: string; blocked_by_month_no: number };

const SIX_WEEKS_DAYS = 42;

/** Whole days from `a` to `b` ("YYYY-MM-DD" each), local — no toISOString(). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = new Date(ay, am - 1, ad).getTime();
  const db = new Date(by, bm - 1, bd).getTime();
  return Math.round((db - da) / 86_400_000);
}

/** Twelve first-of-month dates ("YYYY-MM-01"), starting the school's own month 1. */
export function monthStarts(startedOn: string): string[] {
  const base = monthOf(startedOn);
  return Array.from({ length: 12 }, (_, i) => `${shiftMonth(base, i)}-01`);
}

/** 1–12 for a date inside the twelve-month window, else null. */
export function monthNoOf(starts: string[], date: string): number | null {
  const idx = starts.findIndex((s) => monthOf(s) === monthOf(date));
  return idx === -1 ? null : idx + 1;
}

/**
 * Spine pinned first (from the template, not hardcoded), then the six open
 * months are shaped by where the school's open days land — in that literal
 * order of precedence: a month already claimed by an earlier pass is never
 * reclaimed by a later one.
 *
 *   pass 1  open_day        every open day's own month
 *   pass 2  open_day_before the month right before each open day
 *   pass 3  open_day_after  the month right after each open day
 *   pass 4  prize           one remaining month, only once a season exists
 *   pass 5  filler          whatever is left
 *
 * An open day landing on a spine month or outside the twelve-month window is
 * silently skipped here — planningWarnings() is what reports it.
 */
export function deriveMonths(
  startedOn: string,
  openDays: string[],
  themes: TemplateTheme[],
): DerivedMonth[] {
  const starts = monthStarts(startedOn);
  const byRole = new Map<ThemeRole, TemplateTheme>();
  for (const t of themes) if (t.role !== "spine") byRole.set(t.role, t);

  const slots: (TemplateTheme | null)[] = Array(13).fill(null); // 1-indexed, [0] unused
  for (const t of themes) {
    if (t.role === "spine" && t.pinned_month) slots[t.pinned_month] = t;
  }

  const openDayMonths = openDays
    .map((d) => monthNoOf(starts, d))
    .filter((n): n is number => n !== null && slots[n] === null);

  const assign = (role: Exclude<ThemeRole, "spine">, monthNos: number[]) => {
    const theme = byRole.get(role);
    if (!theme) return;
    for (const n of monthNos) {
      if (n >= 1 && n <= 12 && slots[n] === null) slots[n] = theme;
    }
  };

  assign("open_day", openDayMonths);
  assign("open_day_before", openDayMonths.map((n) => n - 1));
  assign("open_day_after", openDayMonths.map((n) => n + 1));

  // Prize is a single month, and only once there is an open-day season to
  // follow — a school with no open days gets no prize campaign, just filler.
  // It goes in the lowest empty slot AFTER the last open-day month (D6): the
  // prize campaign follows the season, it doesn't precede it. Only if nothing
  // is free after the season do we fall back to the lowest empty slot overall.
  if (openDayMonths.length > 0) {
    const lastOpenMonth = Math.max(...openDayMonths);
    let prizeSlot = slots.findIndex((s, i) => i > lastOpenMonth && i <= 12 && s === null);
    if (prizeSlot === -1) {
      prizeSlot = slots.findIndex((s, i) => i >= 1 && i <= 12 && s === null);
    }
    assign("prize", prizeSlot === -1 ? [] : [prizeSlot]);
  }

  const fillerTheme = byRole.get("filler");
  for (let n = 1; n <= 12; n += 1) {
    if (slots[n] === null && fillerTheme) slots[n] = fillerTheme;
  }

  return Array.from({ length: 12 }, (_, i) => {
    const n = i + 1;
    const t = slots[n];
    if (!t) throw new Error(`deriveMonths: no theme resolved for month ${n} — template is missing a role`);
    return { month_no: n, theme: t.theme, role: t.role, starts_on: starts[i], theme_id: t.id };
  });
}

/**
 * A theme used in three months seeds its task list into all three.
 *
 * OVERLAYS SEED ON TOP. A slot theme owns its month; an overlay
 * (role 'overlay', with a `months` array) owns none and is copied into every
 * month it names, alongside whatever theme that month resolved to. That is
 * what lets one month be both "the month after the open day" and "the month
 * the guide publishes" — the two things the workbook's rollout does constantly
 * and a one-theme-per-month template cannot say. Ordinal decides the reading
 * order within the month, so the standing rhythm sits below the month's own
 * work by carrying a higher number in the template.
 *
 * `themes` is optional so a caller with no overlays (and every existing
 * fixture) is unchanged; without it, overlay tasks simply are not seeded.
 */
export function seedTasks(
  months: DerivedMonth[],
  tasks: TemplateTask[],
  themes: TemplateTheme[] = [],
): SeedTask[] {
  const byTheme = new Map<string, TemplateTask[]>();
  for (const t of tasks) {
    const list = byTheme.get(t.theme_id);
    if (list) list.push(t);
    else byTheme.set(t.theme_id, [t]);
  }

  const seeded: SeedTask[] = [];
  const push = (monthNo: number, t: TemplateTask) =>
    seeded.push({
      month_no: monthNo,
      label: t.label,
      side: t.side,
      department_id: t.department_id,
      est_hours: t.est_hours,
      source: "template",
      service_id: null,
      ordinal: t.ordinal,
      is_gate: t.is_gate ?? false,
    });

  for (const m of months) {
    for (const t of byTheme.get(m.theme_id) ?? []) push(m.month_no, t);
  }

  const derived = new Set(months.map((m) => m.month_no));
  for (const th of themes) {
    if (th.role !== "overlay") continue;
    for (const n of th.months ?? []) {
      // A month the derivation did not produce cannot hold anything, so an
      // out-of-range month in the template is skipped rather than seeding a
      // task the school_tasks composite FK would reject anyway.
      if (!derived.has(n)) continue;
      for (const t of byTheme.get(th.id) ?? []) push(n, t);
    }
  }

  return seeded;
}

/**
 * Recomputed on every keystroke in the planning dialog's preview — structural
 * checks only, from dates and the derived shape, before any task or state
 * exists to ask about. `sixWeekBreach` below is the live, runtime version of
 * the same rule once a year is actually running.
 */
export function planningWarnings(
  startedOn: string,
  openDays: string[],
  months: Pick<DerivedMonth, "month_no" | "role" | "starts_on">[],
  _today?: string,
): PlanningWarning[] {
  const starts = monthStarts(startedOn);
  const warnings: PlanningWarning[] = [];

  for (const d of openDays) {
    const n = monthNoOf(starts, d);
    if (n === null) {
      warnings.push({ kind: "open_day_outside_year", date: d });
      continue;
    }
    const m = months.find((x) => x.month_no === n);
    if (m && m.role !== "open_day") {
      warnings.push({ kind: "open_day_in_pinned_month", month_no: n, date: d });
      continue;
    }
    // D6: this open day got its own month, but the month right before it
    // (where "Build the open day machine" belongs) was already claimed by
    // something else — a pinned spine month, or another open day's own run.
    // Derived from the final `months` roles rather than re-run through
    // deriveMonths' slot bookkeeping — the placement rule already produced
    // the answer, this just reads it off.
    const beforeNo = n - 1;
    const beforeMonth = beforeNo >= 1 ? months.find((x) => x.month_no === beforeNo) : null;
    if (m && (beforeNo < 1 || !beforeMonth || beforeMonth.role !== "open_day_before")) {
      warnings.push({
        kind: "build_month_unplaced",
        date: d,
        blocked_by_month_no: beforeMonth ? beforeMonth.month_no : 0,
      });
    }
  }

  for (const m of months) {
    if (m.role !== "open_day_before") continue;
    const openMonth = months.find((x) => x.month_no === m.month_no + 1 && x.role === "open_day");
    if (!openMonth) continue;
    const dayInMonth = openDays
      .filter((d) => monthOf(d) === monthOf(openMonth.starts_on))
      .sort()[0];
    if (!dayInMonth) continue;
    const days = daysBetween(m.starts_on, dayInMonth);
    if (days < SIX_WEEKS_DAYS) {
      warnings.push({ kind: "six_week_breach", month_no: m.month_no, date: dayInMonth, days });
    }
  }

  return warnings;
}

/**
 * The live version: fires only while the gate task in an open_day_before
 * month is still open, past its six-week gate. Mirrors
 * schedule_school_year_month's v_gate maths exactly (open_day − 42 days) so
 * the board and the DB never disagree about the date.
 *
 * Read off role, never off theme text, and off is_gate, never off the label:
 * both are renameable, and the DB has read the flag since 0151 while this
 * function was still matching a literal string. A template whose gate task is
 * worded differently would have left the banner silently dead — the exact
 * drift is_gate was added to end.
 */
export function sixWeekBreach(
  openDays: string[],
  months: Pick<DerivedMonth, "month_no" | "role" | "starts_on">[],
  tasks: { month_no: number; side: "us" | "school"; state: string; is_gate?: boolean }[],
  today?: string,
): { month_no: number; open_day: string; days: number; passed: boolean } | null {
  const now = today ?? todayISO();

  for (const m of months) {
    if (m.role !== "open_day_before") continue;
    const openMonth = months.find((x) => x.month_no === m.month_no + 1 && x.role === "open_day");
    if (!openMonth) continue;
    const dayInMonth = openDays
      .filter((d) => monthOf(d) === monthOf(openMonth.starts_on))
      .sort()[0];
    if (!dayInMonth) continue;

    const gateTask = tasks.find((t) => t.month_no === m.month_no && t.is_gate);
    if (!gateTask || gateTask.state === "done") continue;

    // daysUntil is signed — negative once the open day is in the past — but
    // the reported `days` never is (D1): the sign becomes `passed` instead,
    // so nothing downstream ever renders "-12 day(s) away".
    const daysUntil = daysBetween(now, dayInMonth);
    const gate = daysUntil - SIX_WEEKS_DAYS; // days left minus six weeks
    if (gate < 0) {
      return { month_no: m.month_no, open_day: dayInMonth, days: Math.abs(daysUntil), passed: daysUntil < 0 };
    }
  }
  return null;
}
