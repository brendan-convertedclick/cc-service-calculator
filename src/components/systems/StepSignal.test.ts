import { describe, expect, it } from "vitest";
import { verdict } from "./StepSignal";

type Answers = Parameters<typeof verdict>[0];

function step(patch: Partial<Answers> = {}): Answers {
  return {
    verb: null,
    keep_decision: "auto",
    signal_q1: null,
    signal_q2: null,
    signal_q3: null,
    signal_q4: null,
    signal_q5: null,
    ...patch,
  };
}

describe("verdict", () => {
  it("is pending until something is answered", () => {
    expect(verdict(step()).computed).toBe("pending");
  });

  it("keeps on a single yes, without the rest answered", () => {
    expect(verdict(step({ signal_q2: true })).computed).toBe("keep");
  });

  it("only cuts once every decisive question is an explicit no", () => {
    expect(verdict(step({ signal_q1: false, signal_q2: false })).computed).toBe("review");
    expect(
      verdict(step({ signal_q1: false, signal_q2: false, signal_q5: false })).computed
    ).toBe("cut");
  });

  it("counts q3 only for check verbs — and drops it when the verb moves away", () => {
    const answers = { verb: "Verify", signal_q1: false, signal_q2: false, signal_q3: true, signal_q5: false };
    expect(verdict(step(answers)).computed).toBe("keep");
    // Same answers, non-check verb: q3 is no longer decisive, so the three
    // explicit noes stand on their own.
    expect(verdict(step({ ...answers, verb: "Send" })).computed).toBe("cut");
  });

  it("lets a human override the computed verdict", () => {
    const s = step({ signal_q1: true, keep_decision: "cut" });
    expect(verdict(s).computed).toBe("keep");
    expect(verdict(s).effective).toBe("cut");
  });

  it("ignores q4 — it warns, it never decides", () => {
    expect(verdict(step({ signal_q4: true })).computed).toBe("pending");
  });
});
