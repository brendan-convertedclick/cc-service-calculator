import { describe, it, expect } from "vitest";
import { retainerStatus, workingDays } from "./retainer-status";

describe("retainerStatus", () => {
  it("counts working days, not calendar days", () => {
    // August 2026 starts on a Saturday and has 21 Mon–Fri days.
    expect(workingDays("2026-08")).toBe(21);
    expect(workingDays("2026-08", new Date(2026, 7, 3))).toBe(1); // Mon 3 Aug
  });

  it("judges a finished month whole", () => {
    const r = retainerStatus({ planned: 20, completed: 10, month: "2026-08", today: new Date(2026, 8, 2) });
    expect(r.inProgress).toBe(false);
    expect(r.expected).toBe(20);
    expect(r.status).toBe("under");
  });

  it("pro-rates a month still running, so nobody is 'under' on the 2nd", () => {
    // 2 September 2026 is a Wednesday: 2 working days of 22.
    const r = retainerStatus({ planned: 22, completed: 2, month: "2026-09", today: new Date(2026, 8, 2) });
    expect(r.inProgress).toBe(true);
    expect(r.expected).toBeCloseTo(2, 5);
    expect(r.status).toBe("on_track");
  });

  it("does not call a two-day-old month a failure just because nothing has closed", () => {
    const r = retainerStatus({ planned: 22, completed: 0, month: "2026-09", today: new Date(2026, 8, 2) });
    expect(r.status).toBe("not_started");
  });

  it("does call a finished month with nothing delivered a failure", () => {
    const r = retainerStatus({ planned: 22, completed: 0, month: "2026-08", today: new Date(2026, 8, 2) });
    expect(r.status).toBe("under");
  });

  it("flags over-delivery", () => {
    const r = retainerStatus({ planned: 10, completed: 15, month: "2026-08", today: new Date(2026, 8, 2) });
    expect(r.status).toBe("over");
  });

  it("has no opinion when the fee buys no hours", () => {
    const r = retainerStatus({ planned: 0, completed: 3, month: "2026-08", today: new Date(2026, 8, 2) });
    expect(r.status).toBe("none");
  });
});
