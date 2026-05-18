import { describe, expect, it } from "vitest";
import { interpolate } from "./outbound-emails";

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
