import { describe, expect, it } from "vitest";
import { resumeHref, type Brief } from "./brief-routing";

const brief = (status: Brief["status"]): Brief =>
  ({ id: "b1", status }) as Brief;

describe("resumeHref", () => {
  // The staged brief page hosts the whole journey (In/Out of Scope → The
  // Brief → Scope Edit → Cost Estimate → Approve & Schedule) and opens on the
  // first actionable stage, so every status resumes there.
  it("routes every status to the staged brief page", () => {
    const statuses: Array<Brief["status"]> = [
      "new",
      "needs_info",
      "triaged",
      "scoped",
      "quoted",
      "accepted",
      "briefed",
    ];
    for (const status of statuses) {
      expect(resumeHref(brief(status))).toBe("/briefs/b1/scope");
    }
  });
});
