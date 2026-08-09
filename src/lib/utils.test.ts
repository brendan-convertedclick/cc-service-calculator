import { describe, it, expect } from "vitest";
import { toggleInSet, formatZar, errorMessage } from "./utils";

describe("toggleInSet", () => {
  it("adds a missing value and removes a present one", () => {
    const empty = new Set<string>();
    const withA = toggleInSet(empty, "a");
    expect([...withA]).toEqual(["a"]);
    expect([...toggleInSet(withA, "a")]).toEqual([]);
  });

  it("does not mutate the input set", () => {
    const original = new Set(["a"]);
    toggleInSet(original, "b");
    expect([...original]).toEqual(["a"]);
  });

  it("leaves other members untouched", () => {
    expect([...toggleInSet(new Set(["a", "b"]), "b")]).toEqual(["a"]);
  });
});

describe("formatZar", () => {
  it("treats its argument as integer cents", () => {
    // Money is stored as int cents; formatCurrency() in lib/format.ts takes
    // rands instead, so this unit boundary matters.
    // 123400 cents = R1 234. The formatter renders 0 decimal places, so a
    // value with cents would round — use a round one to pin the /100 boundary.
    expect(formatZar(123400)).toMatch(/1.?234/);
    expect(formatZar(99)).toMatch(/1/); // R0.99 rounds to R1
    expect(formatZar(0)).toMatch(/0/);
  });
});

describe("errorMessage", () => {
  it("reads Error.message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("reads a Supabase PostgrestError, which is a plain object", () => {
    // This is the case the 105 inline `e instanceof Error ? …` ternaries got
    // wrong: they fall through to a generic fallback and hide the real cause.
    expect(errorMessage({ message: "duplicate key", code: "23505" })).toBe("duplicate key");
  });
});
