import { describe, expect, it } from "vitest";
import { buildVerdict, daysBetween, ordinal, type VerdictInput } from "./escalation-verdict";

const base: VerdictInput = {
  requesterName: "Stephanie Kotze",
  clientName: "Trellidor",
  extraPoints: 10,
  originalPoints: 4,
  pointsConsumed: 12.23,
  originalDueDate: null,
  requestedDueDate: null,
  billing: "retainer",
  billingResolved: true,
  burnPctAfter: 11,
  priorOverrunsThisMonth: 0,
  hoursMissingFromBurn: false,
};

describe("buildVerdict headline", () => {
  it("states the ask, the overrun and who absorbs it", () => {
    expect(buildVerdict(base).headline).toBe(
      "Stephanie needs 10 more points on a task that has already burned 306% of its 4-point budget. " +
        "Trellidor's retainer absorbs it — no invoice changes.",
    );
  });

  it("drops the overrun clause when ClickUp hasn't answered yet", () => {
    const v = buildVerdict({ ...base, pointsConsumed: null });
    expect(v.headline).toBe(
      "Stephanie needs 10 more points. Trellidor's retainer absorbs it — no invoice changes.",
    );
  });

  it("says used, not burned, when the task is still inside its budget", () => {
    expect(buildVerdict({ ...base, pointsConsumed: 2 }).headline).toContain("has used 50% of its");
  });

  it("counts days for a date-only push", () => {
    const v = buildVerdict({
      ...base,
      extraPoints: null,
      originalPoints: 2,
      pointsConsumed: 19.14,
      originalDueDate: "2026-07-19",
      requestedDueDate: "2026-08-19",
      clientName: "The Converted Click",
      billing: null,
    });
    expect(v.headline).toBe(
      "Stephanie wants 31 more days on a task that has already burned 957% of its 2-point budget. " +
        "There's no brief in Conductor for this task, so who pays for it can't be determined.",
    );
  });

  it("names ad-hoc work as billable to the client", () => {
    expect(buildVerdict({ ...base, billing: "adhoc" }).headline).toContain(
      "separately billable to Trellidor",
    );
  });

  it("falls back gracefully when the requester is unknown", () => {
    expect(buildVerdict({ ...base, requesterName: null }).headline).toMatch(/^Someone needs/);
  });

  it("says nothing about who pays until the lookup resolves", () => {
    const v = buildVerdict({ ...base, billing: null, billingResolved: false });
    expect(v.headline).toBe("Stephanie needs 10 more points on a task that has already burned 306% of its 4-point budget.");
    expect(v.flags.some((f) => f.label.includes("Billing"))).toBe(false);
    expect(v.flags.some((f) => f.label.includes("Costs nothing"))).toBe(false);
  });

  it("uses the singular for a one-point ask", () => {
    expect(buildVerdict({ ...base, extraPoints: 1 }).headline).toContain("needs 1 more point ");
  });
});

describe("buildVerdict flags", () => {
  it("leads with what it costs", () => {
    expect(buildVerdict(base).flags[0]).toEqual({ tone: "ok", label: "Costs nothing extra" });
    expect(buildVerdict({ ...base, billing: "adhoc" }).flags[0].label).toBe("Separately billable");
    expect(buildVerdict({ ...base, billing: null }).flags[0].label).toBe("Billing unknown");
  });

  it("names the unfunded overrun on a date-only push", () => {
    const v = buildVerdict({
      ...base,
      extraPoints: null,
      originalPoints: 2,
      pointsConsumed: 19.14,
      requestedDueDate: "2026-08-19",
    });
    expect(v.flags.map((f) => f.label)).toContain("17.14 pt · 4.3h already over, unfunded");
  });

  it("does not claim anything is unfunded when points were requested", () => {
    const labels = buildVerdict(base).flags.map((f) => f.label);
    expect(labels.some((l) => l.includes("unfunded"))).toBe(false);
  });

  it("does not claim anything is unfunded when the task is inside budget", () => {
    const v = buildVerdict({ ...base, extraPoints: null, pointsConsumed: 1, requestedDueDate: "2026-08-19" });
    expect(v.flags.some((f) => f.label.includes("unfunded"))).toBe(false);
  });

  it("counts the request itself in the repeat-overrun flag", () => {
    const v = buildVerdict({ ...base, priorOverrunsThisMonth: 3 });
    expect(v.flags.map((f) => f.label)).toContain("4th overrun for this client this month");
  });

  it("warns when the retainer would be nearly spent", () => {
    expect(buildVerdict({ ...base, burnPctAfter: 91 }).flags.map((f) => f.label)).toContain(
      "Retainer at 91% after this",
    );
    expect(buildVerdict({ ...base, burnPctAfter: 84 }).flags.some((f) => f.label.includes("Retainer at"))).toBe(false);
  });

  it("flags when the task's hours never reached the burn figures", () => {
    expect(buildVerdict({ ...base, hoursMissingFromBurn: true }).flags.map((f) => f.label)).toContain(
      "Retainer figures understated",
    );
  });
});

describe("daysBetween", () => {
  it("counts calendar days forward", () => {
    expect(daysBetween("2026-07-19", "2026-08-19")).toBe(31);
  });
  it("returns null when either end is missing or unparseable", () => {
    expect(daysBetween(null, "2026-08-19")).toBeNull();
    expect(daysBetween("2026-07-19", null)).toBeNull();
    expect(daysBetween("not-a-date", "2026-08-19")).toBeNull();
  });
});

describe("ordinal", () => {
  it("handles the teens, which are the ones that break naive rules", () => {
    expect(["11th", "12th", "13th"]).toEqual([ordinal(11), ordinal(12), ordinal(13)]);
  });
  it("handles the ordinary cases", () => {
    expect(["1st", "2nd", "3rd", "4th", "21st"]).toEqual(
      [1, 2, 3, 4, 21].map(ordinal),
    );
  });
});
