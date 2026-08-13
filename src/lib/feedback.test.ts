import { describe, expect, it } from "vitest";
import { MAX_BYTES, screenshotPath, validateScreenshots } from "@/lib/feedback";

function file(name: string, type: string, size: number): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

describe("validateScreenshots", () => {
  it("accepts up to three images", () => {
    expect(validateScreenshots([file("a.png", "image/png", 1000)])).toBeNull();
  });

  it("rejects a fourth", () => {
    const files = ["a", "b", "c", "d"].map((n) => file(`${n}.png`, "image/png", 10));
    expect(validateScreenshots(files)).toMatch(/up to 3/);
  });

  it("rejects a non-image and an oversized image", () => {
    expect(validateScreenshots([file("notes.pdf", "application/pdf", 10)])).toMatch(/PNG/);
    expect(validateScreenshots([file("big.png", "image/png", MAX_BYTES + 1)])).toMatch(/5 MB/);
  });
});

describe("screenshotPath", () => {
  it("puts the file in the uploader's folder and sanitises the name", () => {
    const path = screenshotPath("user-1", "my shot (2).png");
    expect(path.startsWith("user-1/")).toBe(true);
    expect(path.endsWith("my_shot__2_.png")).toBe(true);
  });
});
