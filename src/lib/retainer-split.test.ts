import { describe, expect, it } from "vitest";
import { salesMarked, splitHours } from "./retainer-split";

const base = { retainer: 0, recurring: 0, adhoc: 0, adhocUnlinked: 0, internal: 0, sales: 0 };

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

  it("adds a sales row only when something was marked as sales", () => {
    expect(splitHours({ ...base, retainer: 10 }).map((r) => r.key)).not.toContain("sales");
    const rows = splitHours({ ...base, retainer: 6, adhoc: 2, sales: 2 });
    expect(rows.at(-1)).toMatchObject({ key: "sales", hours: 2, pct: 20 });
  });

  it("takes sales hours from the bucket the Book had them in", () => {
    const m = salesMarked([
      { client_name: "Trellidor", reason: "internal", hours: "1.5", dismissed_kind: "sales" },
      { client_name: "Trellidor", reason: "meeting", hours: 1, dismissed_kind: "sales" },
      { client_name: "Trellidor", reason: "meeting", hours: 4, dismissed_kind: "internal" },
    ]);
    expect(m.fromInternal.get("Trellidor")).toBe(1.5);
    expect(m.fromAdhoc.get("Trellidor")).toBe(1);
  });
});
