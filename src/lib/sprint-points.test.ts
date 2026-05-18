import { describe, expect, it } from "vitest";
import {
  classifyProgress,
  hoursToPoints,
  maxPointsFromValue,
  pointsToHours,
  productizedPct,
} from "./sprint-points";

describe("sprint-points conversions", () => {
  it("hours <-> points round-trip", () => {
    expect(hoursToPoints(1)).toBe(4);
    expect(hoursToPoints(0.25)).toBe(1);
    expect(pointsToHours(4)).toBe(1);
    expect(pointsToHours(1)).toBe(0.25);
  });
});

describe("maxPointsFromValue", () => {
  it("computes max from value and rate", () => {
    // R5,000 project at R250/pt → 20 points max
    expect(maxPointsFromValue(500_000, 25_000)).toBe(20);
  });
  it("returns null for missing inputs", () => {
    expect(maxPointsFromValue(null, 25_000)).toBeNull();
    expect(maxPointsFromValue(500_000, null)).toBeNull();
    expect(maxPointsFromValue(500_000, 0)).toBeNull();
  });
});

describe("classifyProgress", () => {
  it("ok under budget", () => {
    expect(classifyProgress(10, 20, 30)).toBe("ok");
    expect(classifyProgress(20, 20, 30)).toBe("ok");
  });
  it("warn between budget and max", () => {
    expect(classifyProgress(25, 20, 30)).toBe("warn");
    expect(classifyProgress(30, 20, 30)).toBe("warn");
  });
  it("over above max", () => {
    expect(classifyProgress(40, 20, 30)).toBe("over");
  });
  it("over if no max defined and over budget", () => {
    expect(classifyProgress(25, 20, null)).toBe("over");
  });
  it("ok if no max but under budget", () => {
    expect(classifyProgress(10, 20, null)).toBe("ok");
  });
});

describe("productizedPct", () => {
  it("computes pct rounded to one decimal", () => {
    expect(productizedPct(75, 100)).toBe(75);
    expect(productizedPct(1, 3)).toBe(33.3);
  });
  it("returns null when no points", () => {
    expect(productizedPct(0, 0)).toBeNull();
  });
});
