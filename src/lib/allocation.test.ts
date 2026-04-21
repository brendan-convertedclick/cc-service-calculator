import { describe, expect, it } from "vitest";
import {
  DepartmentRef,
  isSumValid,
  resolveAllocation,
  sumPct,
  totalHours,
} from "./allocation";

const depts: DepartmentRef[] = [
  { id: "dev", name: "Development", hourlyRateCents: 107500 },
  { id: "seo", name: "SEO", hourlyRateCents: 107500 },
  { id: "pm", name: "Project Management", hourlyRateCents: 115000 },
];

describe("sumPct / isSumValid", () => {
  it("sums clean allocations", () => {
    expect(sumPct([{ departmentId: "dev", pct: 60 }, { departmentId: "seo", pct: 40 }])).toBe(100);
  });

  it("accepts values inside 99.5..100.5 tolerance", () => {
    expect(isSumValid([{ departmentId: "dev", pct: 99.7 }])).toBe(true);
    expect(isSumValid([{ departmentId: "dev", pct: 100.4 }])).toBe(true);
  });

  it("rejects values outside tolerance", () => {
    expect(isSumValid([{ departmentId: "dev", pct: 99.4 }])).toBe(false);
    expect(isSumValid([{ departmentId: "dev", pct: 100.6 }])).toBe(false);
    expect(isSumValid([{ departmentId: "dev", pct: 90 }, { departmentId: "seo", pct: 10 }])).toBe(true);
    expect(isSumValid([{ departmentId: "dev", pct: 50 }])).toBe(false);
  });
});

describe("resolveAllocation — worked example from the plan", () => {
  // R3,300 price, 60% Dev / 25% SEO / 15% PM; Dev & SEO @ R1,075/hr, PM @ R1,150/hr.
  const price = 330000; // cents
  const rows = resolveAllocation(
    price,
    [
      { departmentId: "dev", pct: 60 },
      { departmentId: "seo", pct: 25 },
      { departmentId: "pm", pct: 15 },
    ],
    depts
  );

  it("gives exact price shares", () => {
    expect(rows[0].priceShareCents).toBe(198000); // R1,980
    expect(rows[1].priceShareCents).toBe(82500); // R825
    expect(rows[2].priceShareCents).toBe(49500); // R495
  });

  it("gives hours to 2dp", () => {
    // R1,980 / R1,075 = 1.8418... -> 1.84
    expect(rows[0].hours).toBe(1.84);
    // R825 / R1,075 = 0.7674... -> 0.77
    expect(rows[1].hours).toBe(0.77);
    // R495 / R1,150 = 0.4304... -> 0.43
    expect(rows[2].hours).toBe(0.43);
  });

  it("totals hours across departments", () => {
    expect(totalHours(rows)).toBe(3.04);
  });
});

describe("resolveAllocation — override vs inherit produces different results", () => {
  const price = 330000;
  const inherit = resolveAllocation(
    price,
    [{ departmentId: "dev", pct: 100 }],
    depts
  );
  const override = resolveAllocation(
    price,
    [
      { departmentId: "dev", pct: 50 },
      { departmentId: "seo", pct: 50 },
    ],
    depts
  );

  it("inherit path allocates everything to dev", () => {
    expect(inherit).toHaveLength(1);
    expect(inherit[0].departmentId).toBe("dev");
    expect(inherit[0].hours).toBe(3.07); // 330000/107500 = 3.069... -> 3.07
  });

  it("override path splits across two departments", () => {
    expect(override).toHaveLength(2);
    expect(override[0].hours).toBeCloseTo(1.53, 2);
    expect(override[1].hours).toBeCloseTo(1.53, 2);
    // Override total differs from inherit total by only rounding
    expect(totalHours(override)).not.toBe(totalHours(inherit));
  });
});

describe("edge cases", () => {
  it("handles zero-rate department without Infinity", () => {
    const rows = resolveAllocation(
      100000,
      [{ departmentId: "free", pct: 100 }],
      [{ id: "free", name: "Freebie", hourlyRateCents: 0 }]
    );
    expect(rows[0].hours).toBe(0);
    expect(Number.isFinite(rows[0].hours)).toBe(true);
  });

  it("throws on unknown department id", () => {
    expect(() =>
      resolveAllocation(100000, [{ departmentId: "ghost", pct: 100 }], depts)
    ).toThrow(/Unknown department/);
  });
});
