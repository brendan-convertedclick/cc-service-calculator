import { describe, expect, it } from "vitest";
import {
  DepartmentRef,
  hoursToPct,
  isSumValid,
  resolveAllocation,
  sumPct,
  totalHours,
} from "./allocation";

const depts: DepartmentRef[] = [
  { id: "dev", name: "Development", hourly_rate_cents: 107500 },
  { id: "seo", name: "SEO", hourly_rate_cents: 107500 },
  { id: "pm", name: "Project Management", hourly_rate_cents: 115000 },
];

describe("sumPct / isSumValid", () => {
  it("sums clean allocations", () => {
    expect(sumPct([{ department_id: "dev", pct: 60 }, { department_id: "seo", pct: 40 }])).toBe(100);
  });

  it("accepts values inside 99.5..100.5 tolerance", () => {
    expect(isSumValid([{ department_id: "dev", pct: 99.7 }])).toBe(true);
    expect(isSumValid([{ department_id: "dev", pct: 100.4 }])).toBe(true);
  });

  it("rejects values outside tolerance", () => {
    expect(isSumValid([{ department_id: "dev", pct: 99.4 }])).toBe(false);
    expect(isSumValid([{ department_id: "dev", pct: 100.6 }])).toBe(false);
    expect(isSumValid([{ department_id: "dev", pct: 90 }, { department_id: "seo", pct: 10 }])).toBe(true);
    expect(isSumValid([{ department_id: "dev", pct: 50 }])).toBe(false);
  });
});

describe("resolveAllocation — worked example from the plan", () => {
  // R3,300 price, 60% Dev / 25% SEO / 15% PM; Dev & SEO @ R1,075/hr, PM @ R1,150/hr.
  const price = 330000; // cents
  const rows = resolveAllocation(
    price,
    [
      { department_id: "dev", pct: 60 },
      { department_id: "seo", pct: 25 },
      { department_id: "pm", pct: 15 },
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
    [{ department_id: "dev", pct: 100 }],
    depts
  );
  const override = resolveAllocation(
    price,
    [
      { department_id: "dev", pct: 50 },
      { department_id: "seo", pct: 50 },
    ],
    depts
  );

  it("inherit path allocates everything to dev", () => {
    expect(inherit).toHaveLength(1);
    expect(inherit[0].department_id).toBe("dev");
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

describe("hoursToPct", () => {
  it("converts hours-per-dept to % using dept rates and total price", () => {
    // Service price R3,300 (330000 cents).
    // Dev 1.84h @ R1,075/hr (107500 cents) = 197800 cents = 59.94%
    // SEO 0.77h @ R1,075/hr = 82775 cents = 25.08%
    // PM 0.43h @ R1,150/hr (115000 cents) = 49450 cents = 14.98%
    const result = hoursToPct({
      hoursByDept: { dev: 1.84, seo: 0.77, pm: 0.43 },
      departmentRates: { dev: 107500, seo: 107500, pm: 115000 },
      priceCents: 330000,
    });
    expect(result.dev).toBeCloseTo(59.94, 1);
    expect(result.seo).toBeCloseTo(25.08, 1);
    expect(result.pm).toBeCloseTo(14.98, 1);
    const sum = Object.values(result).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 0);
  });

  it("skips depts with zero hours", () => {
    const result = hoursToPct({
      hoursByDept: { dev: 1, seo: 0, pm: 0 },
      departmentRates: { dev: 100000, seo: 100000, pm: 100000 },
      priceCents: 100000,
    });
    expect(result).toEqual({ dev: 100 });
  });

  it("returns empty object when priceCents is 0", () => {
    const result = hoursToPct({
      hoursByDept: { dev: 1 },
      departmentRates: { dev: 100000 },
      priceCents: 0,
    });
    expect(result).toEqual({});
  });
});

describe("edge cases", () => {
  it("handles zero-rate department without Infinity", () => {
    const rows = resolveAllocation(
      100000,
      [{ department_id: "free", pct: 100 }],
      [{ id: "free", name: "Freebie", hourly_rate_cents: 0 }]
    );
    expect(rows[0].hours).toBe(0);
    expect(Number.isFinite(rows[0].hours)).toBe(true);
  });

  it("throws on unknown department id", () => {
    expect(() =>
      resolveAllocation(100000, [{ department_id: "ghost", pct: 100 }], depts)
    ).toThrow(/Unknown department/);
  });
});
