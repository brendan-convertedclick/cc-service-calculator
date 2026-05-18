import { describe, expect, it } from "vitest";
import { classifyTier, initialStatusForTier } from "./extension-requests";

describe("classifyTier", () => {
  it("classifies <25% as auto", () => {
    const r = classifyTier(10, 2);
    expect(r.tier).toBe("auto");
    expect(r.deltaPct).toBe(20);
  });
  it("treats exactly 25% as admin (inclusive lower bound)", () => {
    const r = classifyTier(8, 2);
    expect(r.tier).toBe("admin");
    expect(r.deltaPct).toBe(25);
  });
  it("classifies 25-50% as admin", () => {
    expect(classifyTier(10, 4).tier).toBe("admin");
    expect(classifyTier(10, 5).tier).toBe("admin");
  });
  it("treats exactly 50% as admin (inclusive upper bound)", () => {
    expect(classifyTier(8, 4).tier).toBe("admin");
  });
  it("classifies >50% as owner", () => {
    expect(classifyTier(10, 6).tier).toBe("owner");
    expect(classifyTier(2, 5).tier).toBe("owner");
  });
  it("rejects non-positive inputs", () => {
    expect(() => classifyTier(0, 1)).toThrow();
    expect(() => classifyTier(1, 0)).toThrow();
    expect(() => classifyTier(-1, 1)).toThrow();
  });
});

describe("initialStatusForTier", () => {
  it("maps tier to initial status", () => {
    expect(initialStatusForTier("auto")).toBe("auto_approved");
    expect(initialStatusForTier("admin")).toBe("pending_admin");
    expect(initialStatusForTier("owner")).toBe("pending_owner");
  });
});
