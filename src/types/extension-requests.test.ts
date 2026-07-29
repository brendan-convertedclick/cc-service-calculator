import { describe, expect, it } from "vitest";
import { classifyDueDateTier, classifyTier, initialStatusForTier, maxTier } from "./extension-requests";

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
  });
  it("routes owner-tier through the admin leg first, never straight to the owner", () => {
    expect(initialStatusForTier("owner")).toBe("pending_admin");
  });
});

describe("classifyDueDateTier", () => {
  it("classifies <=2 days as auto", () => {
    expect(classifyDueDateTier(1).tier).toBe("auto");
    expect(classifyDueDateTier(2).tier).toBe("auto");
  });
  it("classifies 3-7 days as admin", () => {
    expect(classifyDueDateTier(3).tier).toBe("admin");
    expect(classifyDueDateTier(7).tier).toBe("admin");
  });
  it("classifies >7 days as owner", () => {
    expect(classifyDueDateTier(8).tier).toBe("owner");
  });
  it("rejects non-positive inputs", () => {
    expect(() => classifyDueDateTier(0)).toThrow();
    expect(() => classifyDueDateTier(-1)).toThrow();
  });
});

describe("maxTier", () => {
  it("returns the more restrictive tier", () => {
    expect(maxTier("auto", "admin")).toBe("admin");
    expect(maxTier("owner", "auto")).toBe("owner");
    expect(maxTier("admin", "admin")).toBe("admin");
  });
});
