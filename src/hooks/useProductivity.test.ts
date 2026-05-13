// src/hooks/useProductivity.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

import { buildChartData, buildHoursData, MEMBER_COLORS } from "./useProductivity";

describe("buildChartData", () => {
  it("aggregates points by bucket using _business and _self keys", () => {
    const sprintPoints = [
      { bucket: "2026-05-01", userId: 1, points: 10, businessCreatedPoints: 10, selfCreatedPoints: 0 },
      { bucket: "2026-05-01", userId: 2, points: 5, businessCreatedPoints: 3, selfCreatedPoints: 2 },
      { bucket: "2026-05-02", userId: 1, points: 8, businessCreatedPoints: 5, selfCreatedPoints: 3 },
    ];

    const result = buildChartData(sprintPoints);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      bucket: "2026-05-01",
      "1_business": 10,
      "1_self": 0,
      "2_business": 3,
      "2_self": 2,
    });
    expect(result[1]).toMatchObject({ bucket: "2026-05-02", "1_business": 5, "1_self": 3 });
  });

  it("returns empty array for empty input", () => {
    expect(buildChartData([])).toEqual([]);
  });

  it("sorts week buckets chronologically", () => {
    const sprintPoints = [
      { bucket: "Fri", userId: 1, points: 5, businessCreatedPoints: 5, selfCreatedPoints: 0 },
      { bucket: "Mon", userId: 1, points: 10, businessCreatedPoints: 10, selfCreatedPoints: 0 },
      { bucket: "Wed", userId: 1, points: 7, businessCreatedPoints: 7, selfCreatedPoints: 0 },
    ];
    const result = buildChartData(sprintPoints);
    expect(result.map((r) => r.bucket)).toEqual(["Mon", "Wed", "Fri"]);
  });

  it("splits self-created and business-created points into separate keys", () => {
    const sprintPoints = [
      { bucket: "2026-05-01", userId: 123, points: 15, businessCreatedPoints: 10, selfCreatedPoints: 5 },
    ];
    const result = buildChartData(sprintPoints);
    expect(result).toHaveLength(1);
    expect(result[0]["123_business"]).toBe(10);
    expect(result[0]["123_self"]).toBe(5);
    expect(result[0]["123"]).toBeUndefined();
  });

  it("accumulates multiple rows for same bucket and user", () => {
    const sprintPoints = [
      { bucket: "2026-05-01", userId: 1, points: 6, businessCreatedPoints: 4, selfCreatedPoints: 2 },
      { bucket: "2026-05-01", userId: 1, points: 4, businessCreatedPoints: 3, selfCreatedPoints: 1 },
    ];
    const result = buildChartData(sprintPoints);
    expect(result).toHaveLength(1);
    expect(result[0]["1_business"]).toBe(7);
    expect(result[0]["1_self"]).toBe(3);
  });
});

describe("buildHoursData", () => {
  it("sums hours per user per bucket", () => {
    const timeEntries = [
      { bucket: "2026-05-01", userId: 1, hours: 3 },
      { bucket: "2026-05-01", userId: 2, hours: 2 },
      { bucket: "2026-05-02", userId: 1, hours: 4 },
    ];
    const result = buildHoursData(timeEntries);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ bucket: "2026-05-01", "1_hours": 3, "2_hours": 2 });
    expect(result[1]).toMatchObject({ bucket: "2026-05-02", "1_hours": 4 });
  });

  it("returns empty array for empty input", () => {
    expect(buildHoursData([])).toEqual([]);
  });
});

describe("MEMBER_COLORS", () => {
  it("has at least 7 colours", () => {
    expect(MEMBER_COLORS.length).toBeGreaterThanOrEqual(7);
  });
});
