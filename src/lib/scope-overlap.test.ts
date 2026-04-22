import { describe, expect, it } from "vitest";
import { jaccard, isMostlyAi } from "./scope-overlap";

describe("jaccard", () => {
  it("returns 1 for identical strings", () => {
    expect(jaccard("hello world", "hello world")).toBe(1);
  });
  it("returns 0 for disjoint strings", () => {
    expect(jaccard("foo bar", "baz qux")).toBe(0);
  });
  it("handles partial overlap", () => {
    const j = jaccard("one two three", "two three four");
    // intersection {two, three} = 2; union {one, two, three, four} = 4
    expect(j).toBeCloseTo(0.5, 5);
  });
  it("is case-insensitive and ignores punctuation", () => {
    expect(jaccard("Hello, world!", "hello world")).toBe(1);
  });
});

describe("isMostlyAi", () => {
  it("is true when overlap >= 0.85", () => {
    const ai = "the client wants a new website with seo and a blog section and contact form";
    const edited = "the client wants a new website with seo and a blog section and contact page";
    // one-word swap across 13 unique tokens: intersection=12, union=14, j≈0.857
    expect(isMostlyAi(edited, ai)).toBe(true);
  });
  it("is false when overlap < 0.85", () => {
    expect(isMostlyAi("completely different copy here", "the client wants a new website")).toBe(false);
  });
});
