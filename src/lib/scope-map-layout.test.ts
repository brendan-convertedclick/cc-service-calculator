import { describe, expect, it } from "vitest";
import { layoutScopeMap, type LayoutItem } from "./scope-map-layout";

const SIZE = 800;

function makeItems(insideCount: number, outsideCount: number): LayoutItem[] {
  const items: LayoutItem[] = [];
  for (let i = 0; i < insideCount; i++) {
    items.push({ ref: `in_${i}`, isInside: true, confidence: (i % 10) / 10 });
  }
  for (let i = 0; i < outsideCount; i++) {
    items.push({ ref: `out_${i}`, isInside: false, confidence: 0.8 });
  }
  return items;
}

const distFromCentre = (x: number, y: number) =>
  Math.hypot(x - SIZE / 2, y - SIZE / 2);

describe("layoutScopeMap — circle geometry", () => {
  it("centres the circle and sizes r at 36% of the canvas", () => {
    const { circle } = layoutScopeMap(makeItems(3, 2), SIZE);
    expect(circle.cx).toBe(SIZE / 2);
    expect(circle.cy).toBe(SIZE / 2);
    expect(circle.r).toBeCloseTo(SIZE * 0.36);
  });
});

describe("layoutScopeMap — placement invariants", () => {
  it("places all inside items within the circle radius", () => {
    const { circle, positions } = layoutScopeMap(makeItems(8, 4), SIZE);
    for (const p of positions.filter((p) => p.ref.startsWith("in_"))) {
      expect(distFromCentre(p.x, p.y)).toBeLessThanOrEqual(circle.r + 1e-6);
    }
  });

  it("places all outside items beyond the circle radius and within the canvas", () => {
    const { circle, positions } = layoutScopeMap(makeItems(8, 4), SIZE);
    for (const p of positions.filter((p) => p.ref.startsWith("out_"))) {
      expect(distFromCentre(p.x, p.y)).toBeGreaterThan(circle.r);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(SIZE);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(SIZE);
    }
  });

  it("keeps invariants under crowding (25 items, >10 outside → 360° spread)", () => {
    const { circle, positions } = layoutScopeMap(makeItems(13, 12), SIZE);
    expect(positions).toHaveLength(25);
    for (const p of positions) {
      const d = distFromCentre(p.x, p.y);
      if (p.ref.startsWith("in_")) {
        expect(d).toBeLessThanOrEqual(circle.r + 1e-6);
      } else {
        expect(d).toBeGreaterThan(circle.r);
      }
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(SIZE);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(SIZE);
    }
  });

  it("scales radius by confidence: higher confidence sits nearer the centre", () => {
    const { positions } = layoutScopeMap(
      [
        { ref: "sure", isInside: true, confidence: 1 },
        { ref: "shaky", isInside: true, confidence: 0 },
      ],
      SIZE,
    );
    const sure = positions.find((p) => p.ref === "sure")!;
    const shaky = positions.find((p) => p.ref === "shaky")!;
    expect(distFromCentre(sure.x, sure.y)).toBeLessThan(distFromCentre(shaky.x, shaky.y));
  });
});

describe("layoutScopeMap — determinism", () => {
  it("returns identical output across repeated calls", () => {
    const items = makeItems(9, 7);
    const a = layoutScopeMap(items, SIZE);
    const b = layoutScopeMap(items, SIZE);
    expect(a).toEqual(b);
  });
});

describe("layoutScopeMap — edge cases", () => {
  it("handles zero items", () => {
    const { circle, positions } = layoutScopeMap([], SIZE);
    expect(positions).toEqual([]);
    expect(circle.r).toBeCloseTo(SIZE * 0.36);
  });

  it("handles a single inside item", () => {
    const { circle, positions } = layoutScopeMap(
      [{ ref: "only", isInside: true, confidence: 0.9 }],
      SIZE,
    );
    expect(positions).toHaveLength(1);
    expect(distFromCentre(positions[0].x, positions[0].y)).toBeLessThanOrEqual(circle.r);
  });

  it("handles a single outside item", () => {
    const { circle, positions } = layoutScopeMap(
      [{ ref: "only", isInside: false, confidence: 0.2 }],
      SIZE,
    );
    expect(positions).toHaveLength(1);
    expect(distFromCentre(positions[0].x, positions[0].y)).toBeGreaterThan(circle.r);
  });

  it("never produces NaN, even with bogus confidence values", () => {
    const items: LayoutItem[] = [
      { ref: "nan", isInside: true, confidence: Number.NaN },
      { ref: "inf", isInside: true, confidence: Number.POSITIVE_INFINITY },
      { ref: "neg", isInside: true, confidence: -5 },
      { ref: "big", isInside: true, confidence: 99 },
      { ref: "out", isInside: false, confidence: Number.NaN },
    ];
    const { positions } = layoutScopeMap(items, SIZE);
    for (const p of positions) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.angleDeg)).toBe(true);
    }
  });

  it("separates identically-placed duplicates deterministically", () => {
    // Two items with identical confidence at the same golden-angle index
    // cannot exist, but coincident refs via duplicate confidence + tight
    // packing exercise the zero-distance fallback.
    const items: LayoutItem[] = Array.from({ length: 6 }, (_, i) => ({
      ref: `dup_${i}`,
      isInside: false,
      confidence: 0.5,
    }));
    const a = layoutScopeMap(items, SIZE);
    const b = layoutScopeMap(items, SIZE);
    expect(a).toEqual(b);
    // All pairwise distances should be > 0 after relaxation.
    for (let i = 0; i < a.positions.length; i++) {
      for (let j = i + 1; j < a.positions.length; j++) {
        const d = Math.hypot(
          a.positions[i].x - a.positions[j].x,
          a.positions[i].y - a.positions[j].y,
        );
        expect(d).toBeGreaterThan(0);
      }
    }
  });

  it("preserves input order in the output positions", () => {
    const items = makeItems(3, 3);
    const { positions } = layoutScopeMap(items, SIZE);
    expect(positions.map((p) => p.ref)).toEqual(items.map((i) => i.ref));
  });
});
