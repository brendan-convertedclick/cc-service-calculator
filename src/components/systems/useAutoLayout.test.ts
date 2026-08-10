import { describe, expect, it } from "vitest";
import { terminalAnchors } from "./useAutoLayout";

const node = (id: string, x: number, y: number) => ({ id, position: { x, y } });

describe("terminalAnchors", () => {
  it("wires Start to unreached blocks and dead ends to Goal", () => {
    const nodes = [node("a", 0, 0), node("b", 300, 0), node("c", 300, 200)];
    // a → b, a → c: one root, two leaves.
    const { roots, leaves } = terminalAnchors(nodes, [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
    ]);
    expect(roots.map((n) => n.id)).toEqual(["a"]);
    expect(leaves.map((n) => n.id)).toEqual(["b", "c"]);
  });

  it("puts Start left of the roots and Goal right of the leaves", () => {
    const nodes = [node("a", 0, 0), node("b", 300, 0)];
    const { start, goal } = terminalAnchors(nodes, [{ source: "a", target: "b" }]);
    expect(start.x).toBeLessThan(0);
    expect(goal.x).toBeGreaterThan(300);
  });

  it("still places both pills when the graph is a pure cycle", () => {
    // Loops are allowed, and a cycle has no root and no leaf — the pills must
    // fall back to the whole graph rather than blow up on Math.min of [].
    const nodes = [node("a", 0, 0), node("b", 300, 0)];
    const { roots, leaves, start, goal } = terminalAnchors(nodes, [
      { source: "a", target: "b" },
      { source: "b", target: "a" },
    ]);
    expect(roots).toEqual([]);
    expect(leaves).toEqual([]);
    expect(Number.isFinite(start.x)).toBe(true);
    expect(Number.isFinite(goal.x)).toBe(true);
  });
});
