import { describe, expect, it } from "vitest";
import { reviewPathFor } from "./signoffs-stitch";

describe("reviewPathFor", () => {
  it("lands on the review page marked as from Stitch", () => {
    expect(reviewPathFor("abc", null)).toBe("/review/abc?via=stitch");
  });
  it("carries the item, encoded", () => {
    expect(reviewPathFor("abc", "a b")).toBe("/review/abc?via=stitch&item=a%20b");
  });
});
