import { describe, expect, it } from "vitest";
import { roleAllowsApprovals, roleIsStaffOnly } from "./staff-briefs";

describe("staff-briefs role helpers", () => {
  it("admin and owner can approve; staff and null cannot", () => {
    expect(roleAllowsApprovals("admin")).toBe(true);
    expect(roleAllowsApprovals("owner")).toBe(true);
    expect(roleAllowsApprovals("staff")).toBe(false);
    expect(roleAllowsApprovals(null)).toBe(false);
  });

  it("only staff is staff-only", () => {
    expect(roleIsStaffOnly("staff")).toBe(true);
    expect(roleIsStaffOnly("admin")).toBe(false);
    expect(roleIsStaffOnly("owner")).toBe(false);
    expect(roleIsStaffOnly(null)).toBe(false);
  });
});
