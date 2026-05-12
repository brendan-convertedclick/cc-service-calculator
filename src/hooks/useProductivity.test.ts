// src/hooks/useProductivity.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

import { buildChartData, buildHoursData, MEMBER_COLORS } from "./useProductivity";

describe("buildChartData", () => {
  it("aggregates points by bucket", () => {
    const sprintPoints = [
      { bucket: "2026-05-01", userId: 1, points: 10 },
      { bucket: "2026-05-01", userId: 2, points: 5 },
      { bucket: "2026-05-02", userId: 1, points: 8 },
    ];

    const result = buildChartData(sprintPoints);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ bucket: "2026-05-01", "1": 10, "2": 5 });
    expect(result[1]).toMatchObject({ bucket: "2026-05-02", "1": 8 });
  });

  it("returns empty array for empty input", () => {
    expect(buildChartData([])).toEqual([]);
  });

  it("sorts week buckets chronologically", () => {
    const sprintPoints = [
      { bucket: "Fri", userId: 1, points: 5 },
      { bucket: "Mon", userId: 1, points: 10 },
      { bucket: "Wed", userId: 1, points: 7 },
    ];
    const result = buildChartData(sprintPoints);
    expect(result.map((r) => r.bucket)).toEqual(["Mon", "Wed", "Fri"]);
  });
});

describe("buildHoursData", () => {
  it("sums hours by bucket", () => {
    const timeEntries = [
      { bucket: "2026-05-01", userId: 1, hours: 3 },
      { bucket: "2026-05-01", userId: 2, hours: 2 },
      { bucket: "2026-05-02", userId: 1, hours: 4 },
    ];
    const result = buildHoursData(timeEntries);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ bucket: "2026-05-01", hours: 5 });
    expect(result[1]).toMatchObject({ bucket: "2026-05-02", hours: 4 });
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
