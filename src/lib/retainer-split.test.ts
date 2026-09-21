import { describe, expect, it } from "vitest";
import { splitHours } from "./retainer-split";

const base = { retainer: 0, recurring: 0, adhoc: 0, adhocUnlinked: 0, internal: 0 };

describe("splitHours", () => {
  it("folds recurring into retainer and says so", () => {
    const [r] = splitHours({ ...base, retainer: 100, recurring: 50 });
    expect(r.hours).toBe(150);
    expect(r.note).toBe("includes 50h of standing monthly tasks");
  });

  it("shares add to 100 across the three", () => {
    const rows = splitHours({ ...base, retainer: 50, recurring: 50, adhoc: 50, internal: 50 });
    expect(rows.map((r) => r.pct)).toEqual([50, 25, 25]);
    expect(rows.reduce((n, r) => n + r.pct, 0)).toBeCloseTo(100);
  });

  it("an empty month is zero, not NaN", () => {
    const rows = splitHours(base);
    expect(rows.map((r) => r.pct)).toEqual([0, 0, 0]);
    expect(rows.every((r) => Number.isFinite(r.pct))).toBe(true);
  });

  it("calls out unbooked retainer work sitting inside ad hoc", () => {
    const [, adhoc] = splitHours({ ...base, adhoc: 20, adhocUnlinked: 8.8 });
    // It stays IN ad hoc — the Book puts it there — but it is named.
    expect(adhoc.hours).toBe(20);
    expect(adhoc.note).toContain("8.8h");
  });

  it("says nothing when there is nothing to qualify", () => {
    const rows = splitHours({ ...base, retainer: 10, adhoc: 5, internal: 1 });
    expect(rows.map((r) => r.note)).toEqual([null, null, null]);
  });
});
