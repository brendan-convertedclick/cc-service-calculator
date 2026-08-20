import { describe, expect, it } from "vitest";
import { interpolate, unresolvedPlaceholders } from "./outbound-emails";

describe("interpolate", () => {
  it("substitutes known placeholders", () => {
    expect(interpolate("Hi {name}!", { name: "Alex" })).toBe("Hi Alex!");
  });
  it("substitutes multiple placeholders", () => {
    expect(interpolate("{a} vs {b}", { a: "X", b: "Y" })).toBe("X vs Y");
  });
  it("leaves unknown placeholders untouched", () => {
    expect(interpolate("Hi {name}, project {project}", { name: "Alex" }))
      .toBe("Hi Alex, project {project}");
  });
});

describe("unresolvedPlaceholders", () => {
  it("finds what interpolate left behind", () => {
    const subject = interpolate("Approval needed — {project_name}", {});
    expect(unresolvedPlaceholders(subject)).toEqual(["project_name"]);
  });
  it("is empty once everything resolved", () => {
    expect(unresolvedPlaceholders(interpolate("Hi {name}", { name: "Alex" }), "no braces here")).toEqual([]);
  });
  it("dedupes across subject and body", () => {
    expect(unresolvedPlaceholders("{a} and {b}", "{a} again")).toEqual(["a", "b"]);
  });
  it("ignores braces that aren't placeholders", () => {
    expect(unresolvedPlaceholders('{"json": 1} and { spaced }')).toEqual([]);
  });
});
