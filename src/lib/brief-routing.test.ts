import { describe, expect, it } from "vitest";
import { resumeHref, type Brief } from "./brief-routing";

const brief = (status: Brief["status"]): Brief =>
  ({ id: "b1", status }) as Brief;

describe("resumeHref", () => {
  it("routes triaged briefs to the scope page", () => {
    expect(resumeHref(brief("triaged"))).toBe("/briefs/b1/scope");
  });

  it("routes scoped briefs to the scope map (sow-check), not the builder", () => {
    expect(resumeHref(brief("scoped"))).toBe("/briefs/b1/sow-check");
  });

  it("routes quoted and accepted briefs to the builder", () => {
    expect(resumeHref(brief("quoted"))).toBe("/briefs/b1/builder");
    expect(resumeHref(brief("accepted"))).toBe("/briefs/b1/builder");
  });

  it("falls back to the scope page for other statuses", () => {
    expect(resumeHref(brief("new"))).toBe("/briefs/b1/scope");
    expect(resumeHref(brief("needs_info"))).toBe("/briefs/b1/scope");
  });
});
