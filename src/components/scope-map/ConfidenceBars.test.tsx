import { describe, expect, it } from "vitest";
import { confidenceBand } from "./ConfidenceBars";

describe("confidenceBand", () => {
  it("is green (high) at and above 80%", () => {
    expect(confidenceBand(0.8)).toBe("high");
    expect(confidenceBand(0.93)).toBe("high");
    expect(confidenceBand(1)).toBe("high");
  });

  it("is orange (med) from 50% up to (not including) 80%", () => {
    expect(confidenceBand(0.5)).toBe("med");
    expect(confidenceBand(0.6)).toBe("med");
    expect(confidenceBand(0.79)).toBe("med");
  });

  it("is red (low) below 50%", () => {
    expect(confidenceBand(0.49)).toBe("low");
    expect(confidenceBand(0)).toBe("low");
  });
});
