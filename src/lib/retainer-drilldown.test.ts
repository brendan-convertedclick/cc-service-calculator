import { describe, it, expect } from "vitest";
import { endOfMonth, dueByEndOf, openForMonth } from "./retainer-drilldown";

describe("endOfMonth", () => {
  it("knows the short months", () => {
    expect(endOfMonth("2026-02")).toBe("2026-02-28");
    expect(endOfMonth("2024-02")).toBe("2024-02-29"); // leap
    expect(endOfMonth("2026-09")).toBe("2026-09-30");
    expect(endOfMonth("2026-12")).toBe("2026-12-31"); // rolls the year
  });
});

describe("dueByEndOf", () => {
  it("keeps anything due on or before the month end", () => {
    expect(dueByEndOf("2026-09", "2026-09-30")).toBe(true);
    expect(dueByEndOf("2026-09", "2026-09-01")).toBe(true);
  });

  it("keeps overdue items from earlier months", () => {
    // The whole reason the rule is "by the end of" and not "inside": an item
    // three weeks late is the one you most need to see.
    expect(dueByEndOf("2026-09", "2026-06-15")).toBe(true);
  });

  it("drops work that is not due yet", () => {
    expect(dueByEndOf("2026-09", "2026-10-01")).toBe(false);
  });

  it("keeps an item with no due date at all", () => {
    // 22 briefs have none. "We never gave it a date" is not "it is not this
    // month", and excluding them would vanish them from every month at once.
    expect(dueByEndOf("2026-09", null)).toBe(true);
  });

  it("ignores a timestamp tail rather than mis-comparing it", () => {
    expect(dueByEndOf("2026-09", "2026-09-30T22:00:00Z")).toBe(true);
  });
});

describe("openForMonth", () => {
  const items = [
    { id: "late", dueDate: "2026-06-15", hours: 2 },
    { id: "this", dueDate: "2026-09-10", hours: 1 },
    { id: "next", dueDate: "2026-10-05", hours: 4 },
    { id: "none", dueDate: null, hours: 0.5 },
  ];

  it("returns the rows and their hours from one pass", () => {
    // The count and the list are derived together on purpose: a total summed
    // separately from the rows behind it is how this page keeps producing a
    // number that disagrees with what the row expands to show.
    const { items: kept, hours } = openForMonth("2026-09", items);
    expect(kept.map((i) => i.id)).toEqual(["late", "this", "none"]);
    expect(hours).toBe(3.5);
  });

  it("lets work through as its month arrives", () => {
    expect(openForMonth("2026-10", items).items.map((i) => i.id)).toContain("next");
  });
});
