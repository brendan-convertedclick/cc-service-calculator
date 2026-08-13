import { describe, expect, it } from "vitest";
import { parseStepHours } from "./step-hours";

describe("parseStepHours", () => {
  it("treats blank as clearing the value", () => {
    expect(parseStepHours("")).toEqual({ ok: true, value: null });
    expect(parseStepHours("   ")).toEqual({ ok: true, value: null });
  });

  it("accepts zero — a step can take no measurable time", () => {
    expect(parseStepHours("0")).toEqual({ ok: true, value: 0 });
  });

  it("accepts the values people actually type", () => {
    expect(parseStepHours("0.15")).toEqual({ ok: true, value: 0.15 });
    expect(parseStepHours("0.25")).toEqual({ ok: true, value: 0.25 });
    expect(parseStepHours("3")).toEqual({ ok: true, value: 3 });
  });

  it("rejects negatives rather than letting Postgres 400 it", () => {
    const r = parseStepHours("-1");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toMatch(/negative/);
  });

  it("rejects nonsense", () => {
    const r = parseStepHours("abc");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toMatch(/number/);
  });
});
