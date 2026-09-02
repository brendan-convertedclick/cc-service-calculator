import { describe, expect, it } from "vitest";
import {
  deriveMonths,
  monthNoOf,
  monthStarts,
  planningWarnings,
  seedTasks,
  sixWeekBreach,
  type TemplateTask,
  type TemplateTheme,
} from "@/lib/pipeline-year";

// The real template's spine + six open roles, exactly as seeded in
// 0150_school_pipeline.sql — id values are just stable strings for the test.
const DEFAULT_THEMES: TemplateTheme[] = [
  { id: "spine-1", theme: "Set the year up", role: "spine", pinned_month: 1, ordinal: 1 },
  { id: "before", theme: "Build the open day machine", role: "open_day_before", pinned_month: null, ordinal: 2 },
  { id: "open", theme: "Open day runs", role: "open_day", pinned_month: null, ordinal: 3 },
  { id: "after", theme: "Convert the interest", role: "open_day_after", pinned_month: null, ordinal: 4 },
  { id: "prize", theme: "Build the audience", role: "prize", pinned_month: null, ordinal: 5 },
  { id: "filler", theme: "Applications and housekeeping", role: "filler", pinned_month: null, ordinal: 6 },
  { id: "spine-8", theme: "Offers go out", role: "spine", pinned_month: 8, ordinal: 7 },
  { id: "spine-9", theme: "Acceptances land", role: "spine", pinned_month: 9, ordinal: 8 },
  { id: "spine-10", theme: "Fill the gaps", role: "spine", pinned_month: 10, ordinal: 9 },
  { id: "spine-11", theme: "Close the year out", role: "spine", pinned_month: 11, ordinal: 10 },
  { id: "spine-12", theme: "Build the bank", role: "spine", pinned_month: 12, ordinal: 11 },
];

const START = "2027-01-15";

describe("monthStarts / monthNoOf", () => {
  it("gives twelve consecutive first-of-months from the school's own start", () => {
    const starts = monthStarts(START);
    expect(starts).toHaveLength(12);
    expect(starts[0]).toBe("2027-01-01");
    expect(starts[11]).toBe("2027-12-01");
  });

  it("resolves a date to its month number, or null outside the window", () => {
    const starts = monthStarts(START);
    expect(monthNoOf(starts, "2027-05-20")).toBe(5);
    expect(monthNoOf(starts, "2028-01-05")).toBeNull();
  });
});

describe("deriveMonths", () => {
  it("places spine months from the template's own pinned_month, not a hardcoded list", () => {
    const reshuffled: TemplateTheme[] = DEFAULT_THEMES.map((t) =>
      t.role === "spine" && t.pinned_month === 1 ? { ...t, pinned_month: 2 } : t,
    ).map((t) => (t.role === "spine" && t.pinned_month === 9 ? { ...t, pinned_month: 1 } : t));
    const months = deriveMonths(START, [], reshuffled);
    expect(months.find((m) => m.month_no === 1)?.theme).toBe("Acceptances land");
    expect(months.find((m) => m.month_no === 2)?.theme).toBe("Set the year up");
  });

  it("zero open days: every open month is filler, no prize", () => {
    const months = deriveMonths(START, [], DEFAULT_THEMES);
    for (const n of [2, 3, 4, 5, 6, 7]) {
      expect(months.find((m) => m.month_no === n)?.role).toBe("filler");
    }
  });

  it("one open day seeds a before/open/after run either side of it", () => {
    const months = deriveMonths(START, ["2027-04-01"], DEFAULT_THEMES);
    expect(months.find((m) => m.month_no === 3)?.role).toBe("open_day_before");
    expect(months.find((m) => m.month_no === 4)?.role).toBe("open_day");
    expect(months.find((m) => m.month_no === 5)?.role).toBe("open_day_after");
    // One remaining slot picks up prize, the rest filler.
    const roles = [2, 6, 7].map((n) => months.find((m) => m.month_no === n)?.role);
    expect(roles).toContain("prize");
    expect(roles.filter((r) => r === "filler")).toHaveLength(2);
  });

  it("two open days one month apart: pass 1 (open_day) beats pass 2 (before)", () => {
    // Open days in month 3 and month 4 — month 4 is simultaneously "open_day"
    // for itself and "before" for nothing (no month 5 open day), and month 3
    // is "open_day" for itself and would be "after" for nothing either. The
    // real collision: month 3 is open_day for the first day AND would be
    // "before" for the second day's open_day (month 4 - 1 = month 3).
    const months = deriveMonths(START, ["2027-03-01", "2027-04-01"], DEFAULT_THEMES);
    expect(months.find((m) => m.month_no === 3)?.role).toBe("open_day");
    expect(months.find((m) => m.month_no === 4)?.role).toBe("open_day");
  });

  it("a month that is both after-A and before-B: pass 2 (before) beats pass 3 (after)", () => {
    // Open days in month 3 and month 5: month 4 is "after" month 3's open day
    // AND "before" month 5's open day. Before wins — the run-up matters more.
    const months = deriveMonths(START, ["2027-03-01", "2027-05-01"], DEFAULT_THEMES);
    expect(months.find((m) => m.month_no === 4)?.role).toBe("open_day_before");
  });

  it("three open days seed Open day runs three times", () => {
    const months = deriveMonths(START, ["2027-02-01", "2027-04-01", "2027-06-01"], DEFAULT_THEMES);
    const openMonths = months.filter((m) => m.role === "open_day");
    expect(openMonths).toHaveLength(3);
    expect(openMonths.every((m) => m.theme === "Open day runs")).toBe(true);
  });

  it("an open day landing outside the year is skipped, not thrown", () => {
    const months = deriveMonths(START, ["2029-01-01"], DEFAULT_THEMES);
    expect(months).toHaveLength(12);
  });

  it("four open days fill every one of the six open slots, leaving no prize or filler", () => {
    // Open days in months 2, 3, 5, 7. Pass 1 claims 2, 3, 5, 7 as open_day.
    // Pass 2 (before) claims 4 (before 5) and 6 (before 7) — 1 and 2 are
    // already open_day/spine. Pass 3 (after) finds nothing left. All six
    // slots gone before prize's pass ever gets a turn.
    const months = deriveMonths(START, ["2027-02-01", "2027-03-01", "2027-05-01", "2027-07-01"], DEFAULT_THEMES);
    expect(months.find((m) => m.month_no === 2)?.role).toBe("open_day");
    expect(months.find((m) => m.month_no === 3)?.role).toBe("open_day");
    expect(months.find((m) => m.month_no === 4)?.role).toBe("open_day_before");
    expect(months.find((m) => m.month_no === 5)?.role).toBe("open_day");
    expect(months.find((m) => m.month_no === 6)?.role).toBe("open_day_before");
    expect(months.find((m) => m.month_no === 7)?.role).toBe("open_day");
    expect(months.some((m) => m.role === "prize")).toBe(false);
    expect(months.some((m) => m.role === "filler")).toBe(false);
  });

  it("D6 minor: prize lands after the last open-day month, never before the season", () => {
    // One open day in M4 (before=3, open=4, after=5): the old bug put prize
    // in the first empty slot overall (M2, before the season even starts).
    // It must land in the first empty slot AFTER M4 instead — M6.
    const months = deriveMonths(START, ["2027-04-01"], DEFAULT_THEMES);
    expect(months.find((m) => m.month_no === 2)?.role).toBe("filler");
    expect(months.find((m) => m.month_no === 6)?.role).toBe("prize");
  });
});

describe("deriveMonths — build-month-unplaced (D6)", () => {
  it("an open day in M2 has no room for a build month — M1 is already spine", () => {
    const months = deriveMonths(START, ["2027-02-14"], DEFAULT_THEMES);
    expect(months.find((m) => m.month_no === 1)?.role).toBe("spine");
    expect(months.find((m) => m.month_no === 2)?.role).toBe("open_day");
    const warnings = planningWarnings(START, ["2027-02-14"], months);
    expect(warnings).toContainEqual({
      kind: "build_month_unplaced",
      date: "2027-02-14",
      blocked_by_month_no: 1,
    });
  });

  it("two consecutive open-day months: the second has no build month of its own", () => {
    // Open days in M3 and M4: pass 1 (open_day) claims both, so M3 — which
    // would otherwise be M4's build month — is never up for grabs.
    const months = deriveMonths(START, ["2027-03-05", "2027-04-10"], DEFAULT_THEMES);
    expect(months.find((m) => m.month_no === 3)?.role).toBe("open_day");
    expect(months.find((m) => m.month_no === 4)?.role).toBe("open_day");
    const warnings = planningWarnings(START, ["2027-03-05", "2027-04-10"], months);
    expect(warnings).toContainEqual({
      kind: "build_month_unplaced",
      date: "2027-04-10",
      blocked_by_month_no: 3,
    });
    // The first open day's own build month (M2) landed fine — no warning for it.
    expect(warnings.some((w) => w.kind === "build_month_unplaced" && w.date === "2027-03-05")).toBe(false);
  });

  it("one open day, cleanly placed: no build-month warning", () => {
    const months = deriveMonths(START, ["2027-04-01"], DEFAULT_THEMES);
    const warnings = planningWarnings(START, ["2027-04-01"], months);
    expect(warnings.some((w) => w.kind === "build_month_unplaced")).toBe(false);
  });

  it("four open days: several build months are unplaced", () => {
    // From the "four open days" deriveMonths case above: M3 and M5 both open
    // as open_day directly (their would-be build months, M2 and M4, are
    // themselves open_day/open_day_before for the day ahead of them).
    const openDays = ["2027-02-01", "2027-03-01", "2027-05-01", "2027-07-01"];
    const months = deriveMonths(START, openDays, DEFAULT_THEMES);
    const warnings = planningWarnings(START, openDays, months);
    const unplaced = warnings.filter((w) => w.kind === "build_month_unplaced");
    expect(unplaced.length).toBeGreaterThan(0);
  });
});

describe("seedTasks", () => {
  const TASKS: TemplateTask[] = [
    { theme_id: "open", label: "Campaign goes live", side: "us", department_id: null, est_hours: 4, ordinal: 1 },
    { theme_id: "open", label: "Attendance list on the day", side: "school", department_id: null, est_hours: null, ordinal: 2 },
  ];

  it("seeds a theme used in three months into all three, unchanged per month", () => {
    const months = deriveMonths(START, ["2027-02-01", "2027-04-01", "2027-06-01"], DEFAULT_THEMES);
    const seeded = seedTasks(months, TASKS);
    const openMonthNos = months.filter((m) => m.role === "open_day").map((m) => m.month_no);
    expect(openMonthNos).toHaveLength(3);
    for (const n of openMonthNos) {
      const inMonth = seeded.filter((t) => t.month_no === n);
      expect(inMonth.map((t) => t.label)).toEqual(["Campaign goes live", "Attendance list on the day"]);
    }
  });

  it("a month with no tasks in its theme seeds nothing", () => {
    const months = deriveMonths(START, [], DEFAULT_THEMES); // all filler; TASKS has no filler entries
    const seeded = seedTasks(months, TASKS);
    expect(seeded).toHaveLength(0);
  });
});

describe("planningWarnings", () => {
  it("warns when an open day lands in a pinned spine month", () => {
    const months = deriveMonths(START, ["2027-01-10"], DEFAULT_THEMES); // month 1 is spine
    const warnings = planningWarnings(START, ["2027-01-10"], months);
    expect(warnings).toContainEqual({ kind: "open_day_in_pinned_month", month_no: 1, date: "2027-01-10" });
  });

  it("warns when an open day falls outside the twelve-month window", () => {
    const months = deriveMonths(START, ["2029-06-01"], DEFAULT_THEMES);
    const warnings = planningWarnings(START, ["2029-06-01"], months);
    expect(warnings).toContainEqual({ kind: "open_day_outside_year", date: "2029-06-01" });
  });

  it("warns when the build month leaves fewer than six weeks before the open day", () => {
    // Open day on the 2nd of its month leaves the before-month only ~32 days.
    const months = deriveMonths(START, ["2027-04-02"], DEFAULT_THEMES);
    const warnings = planningWarnings(START, ["2027-04-02"], months);
    expect(warnings.some((w) => w.kind === "six_week_breach" && w.month_no === 3)).toBe(true);
  });

  it("no warnings for a clean plan", () => {
    const months = deriveMonths(START, [], DEFAULT_THEMES);
    expect(planningWarnings(START, [], months)).toHaveLength(0);
  });

  it("does not breach when the open day leaves a full six weeks of run-up", () => {
    // A real, non-1st date: March starts 2027-03-01, open day 2027-04-15 is
    // 45 days later — clear of the 42-day minimum.
    const months = deriveMonths(START, ["2027-04-15"], DEFAULT_THEMES);
    const warnings = planningWarnings(START, ["2027-04-15"], months);
    expect(warnings.some((w) => w.kind === "six_week_breach")).toBe(false);
  });

  it("breaches when a real (non-1st) open day date leaves under six weeks", () => {
    const months = deriveMonths(START, ["2027-04-02"], DEFAULT_THEMES);
    const warnings = planningWarnings(START, ["2027-04-02"], months);
    expect(warnings).toContainEqual({ kind: "six_week_breach", month_no: 3, date: "2027-04-02", days: 32 });
  });
});

describe("sixWeekBreach", () => {
  const months = deriveMonths(START, ["2027-04-01"], DEFAULT_THEMES); // before=3, open=4

  it("fires when the hard-deadline task is still open past the gate", () => {
    const tasks = [
      { month_no: 3, side: "school" as const, label: "Creative approved — the hard deadline", state: "scheduled" },
    ];
    // Six weeks before 2027-04-01 is 2027-02-18; "today" past that with the task still open.
    const breach = sixWeekBreach(["2027-04-01"], months, tasks, "2027-02-25");
    expect(breach).not.toBeNull();
    expect(breach?.month_no).toBe(3);
  });

  it("does not fire once the task is done, even past the gate", () => {
    const tasks = [
      { month_no: 3, side: "school" as const, label: "Creative approved — the hard deadline", state: "done" },
    ];
    expect(sixWeekBreach(["2027-04-01"], months, tasks, "2027-02-25")).toBeNull();
  });

  it("does not fire while there is still six clear weeks to go", () => {
    const tasks = [
      { month_no: 3, side: "school" as const, label: "Creative approved — the hard deadline", state: "scheduled" },
    ];
    expect(sixWeekBreach(["2027-04-01"], months, tasks, "2027-01-01")).toBeNull();
  });

  it("is read off role, not theme text — a renamed theme still fires", () => {
    const renamed = months.map((m) => (m.role === "open_day_before" ? { ...m, theme: "Whatever we call it" } : m));
    const tasks = [
      { month_no: 3, side: "school" as const, label: "Creative approved — the hard deadline", state: "scheduled" },
    ];
    expect(sixWeekBreach(["2027-04-01"], renamed, tasks, "2027-02-25")).not.toBeNull();
  });

  it("an open day in December (M12) does not crash the month-after lookup", () => {
    // M12 is spine (Build the bank) so there is no open_day_before/open_day
    // pair to find — the function must simply find nothing, not throw.
    const decMonths = deriveMonths(START, ["2027-12-15"], DEFAULT_THEMES);
    expect(() => sixWeekBreach(["2027-12-15"], decMonths, [], "2027-11-01")).not.toThrow();
    expect(sixWeekBreach(["2027-12-15"], decMonths, [], "2027-11-01")).toBeNull();
  });

  it("an open day in December is also reported by planningWarnings as landing on a spine month", () => {
    const decMonths = deriveMonths(START, ["2027-12-15"], DEFAULT_THEMES);
    const warnings = planningWarnings(START, ["2027-12-15"], decMonths);
    expect(warnings).toContainEqual({ kind: "open_day_in_pinned_month", month_no: 12, date: "2027-12-15" });
  });

  it("D1: never reports a negative day count, even once the open day has passed", () => {
    const tasks = [
      { month_no: 3, side: "school" as const, label: "Creative approved — the hard deadline", state: "scheduled" },
    ];
    // "Today" is two weeks after the open day itself — the gate is long blown.
    const breach = sixWeekBreach(["2027-04-01"], months, tasks, "2027-04-15");
    expect(breach).not.toBeNull();
    expect(breach?.days).toBeGreaterThanOrEqual(0);
    expect(breach?.days).toBe(14);
    expect(breach?.passed).toBe(true);
  });

  it("fires on a real (non-1st) open day date inside six weeks — passed is false while it's still ahead", () => {
    const realMonths = deriveMonths(START, ["2027-04-20"], DEFAULT_THEMES); // before=3, open=4
    const tasks = [
      { month_no: 3, side: "school" as const, label: "Creative approved — the hard deadline", state: "scheduled" },
    ];
    const breach = sixWeekBreach(["2027-04-20"], realMonths, tasks, "2027-03-15"); // 36 days out
    expect(breach).not.toBeNull();
    expect(breach?.days).toBe(36);
    expect(breach?.passed).toBe(false);
  });

  it("does not fire on a real (non-1st) open day date more than six weeks out", () => {
    const realMonths = deriveMonths(START, ["2027-04-20"], DEFAULT_THEMES);
    const tasks = [
      { month_no: 3, side: "school" as const, label: "Creative approved — the hard deadline", state: "scheduled" },
    ];
    const breach = sixWeekBreach(["2027-04-20"], realMonths, tasks, "2027-01-20"); // 90 days out
    expect(breach).toBeNull();
  });
});
