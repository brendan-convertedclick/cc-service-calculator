import { describe, expect, it } from "vitest";
import { sizeOf, terminalAnchors } from "./useAutoLayout";

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

describe("sizeOf", () => {
  it("grows a task block by its steps — a fixed height overlaps them on Tidy up", () => {
    const empty = sizeOf({ id: "a", position: { x: 0, y: 0 }, data: { subSteps: [] } } as never);
    const six = sizeOf({
      id: "b",
      position: { x: 0, y: 0 },
      data: { subSteps: [1, 2, 3, 4, 5, 6] },
    } as never);
    expect(six.height).toBeGreaterThan(empty.height);
    expect(six.width).toBe(empty.width);
  });

  it("still sizes a node whose data has no steps at all", () => {
    expect(sizeOf({ id: "c", position: { x: 0, y: 0 }, data: {} } as never).height).toBeGreaterThan(0);
  });

  it("hands back a fresh object each call — dagre writes onto what it is given", () => {
    const a = sizeOf({ id: "a", position: { x: 0, y: 0 }, data: { subSteps: [] } } as never);
    const b = sizeOf({ id: "b", position: { x: 0, y: 0 }, data: { subSteps: [] } } as never);
    expect(a).not.toBe(b);
  });
});
