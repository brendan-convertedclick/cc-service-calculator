import { describe, expect, it } from "vitest";
import { aggregateTotals, buildLineItems, type QuoteLine } from "./quotes";

const depts = [
  { id: "dev", name: "Development", hourly_rate_cents: 107500 },
  { id: "seo", name: "SEO", hourly_rate_cents: 107500 },
];

const baseLine: QuoteLine = {
  service_id: "svc-1",
  service_name: "Full Page Build",
  xero_code: "002",
  qty: 1,
  unit_price_cents: 330000,
  allocation: [
    { dept_id: "dev", pct: 60 },
    { dept_id: "seo", pct: 40 },
  ],
};

describe("aggregateTotals", () => {
  it("sums subtotal and applies margin + discount_room", () => {
    const t = aggregateTotals([{ ...baseLine, qty: 2 }], { margin_pct: 0, discount_room_pct: 0 });
    expect(t.subtotal_cents).toBe(660000);
    expect(t.total_cents).toBe(660000);
  });

  it("applies margin uplift (cost → sell)", () => {
    const t = aggregateTotals([baseLine], { margin_pct: 10, discount_room_pct: 0 });
    // total = subtotal * (1 + margin_pct/100)
    expect(t.total_cents).toBe(363000);
  });

  it("applies discount_room_pct downward on post-margin total", () => {
    const t = aggregateTotals([baseLine], { margin_pct: 0, discount_room_pct: 10 });
    expect(t.total_cents).toBe(297000);
  });
});

describe("buildLineItems snapshot", () => {
  it("expands allocation into per-dept cost_share and hours", () => {
    const items = buildLineItems([baseLine], depts);
    expect(items).toHaveLength(1);
    expect(items[0].subtotal_cents).toBe(330000);
    const dev = items[0].allocation.find((a) => a.dept_id === "dev")!;
    expect(dev.cost_share_cents).toBe(198000);
    expect(dev.hours).toBeCloseTo(1.84, 2); // 198000 / 107500
  });

  it("preserves snapshot fields (service_name, xero_code, qty)", () => {
    const items = buildLineItems([{ ...baseLine, qty: 3 }], depts);
    expect(items[0].service_name).toBe("Full Page Build");
    expect(items[0].xero_code).toBe("002");
    expect(items[0].qty).toBe(3);
    expect(items[0].subtotal_cents).toBe(990000);
  });

  it("emits hours=0 when department has zero rate", () => {
    const items = buildLineItems(
      [baseLine],
      [
        { id: "dev", name: "Development", hourly_rate_cents: 0 },
        { id: "seo", name: "SEO", hourly_rate_cents: 107500 },
      ],
    );
    expect(items[0].allocation.find((a) => a.dept_id === "dev")!.hours).toBe(0);
  });
});
