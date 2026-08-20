import { describe, expect, it } from "vitest";
import { applyDraft, groupProcedure, taskBlockedReason, taskHours } from "./procedure-shape";

const task = (id: string, ordinal: number) => ({ id, ordinal });
const step = (id: string, parent_id: string | null, ordinal: number) => ({ id, parent_id, ordinal });

describe("groupProcedure", () => {
  it("numbers steps straight through the procedure, not per task", () => {
    // The 3D Configurator shape: 5 tasks, 6 steps, the SEO task holding two.
    const groups = groupProcedure(
      [task("t1", 1), task("t2", 2), task("t3", 3), task("t4", 4), task("t5", 5)],
      [
        step("s1", "t1", 1),
        step("s2", "t2", 1),
        step("s3", "t3", 1),
        step("s4", "t3", 2),
        step("s5", "t4", 1),
        step("s6", "t5", 1),
      ],
    );
    expect(groups.map((g) => g.steps.map((s) => s.number))).toEqual([[1], [2], [3, 4], [5], [6]]);
    expect(groups.map((g) => g.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it("orders by ordinal, not array position", () => {
    const groups = groupProcedure(
      [task("b", 2), task("a", 1)],
      [step("s2", "a", 2), step("s1", "a", 1)],
    );
    expect(groups.map((g) => g.task.id)).toEqual(["a", "b"]);
    expect(groups[0].steps.map((s) => s.step.id)).toEqual(["s1", "s2"]);
  });

  it("numbers from positions, so a sparse ordinal doesn't leak into the label", () => {
    // Deleting step 2 of 3 leaves ordinals 1 and 5 behind.
    const groups = groupProcedure([task("t1", 1)], [step("a", "t1", 1), step("b", "t1", 5)]);
    expect(groups[0].steps.map((s) => s.number)).toEqual([1, 2]);
  });

  it("keeps a task with no steps — that is a legal task, not an empty one", () => {
    const groups = groupProcedure([task("t1", 1), task("t2", 2)], [step("s1", "t2", 1)]);
    expect(groups[0].steps).toEqual([]);
    // ...and the numbering skips straight past it.
    expect(groups[1].steps[0].number).toBe(1);
  });

  it("drops an orphan rather than filing it under the wrong task", () => {
    const groups = groupProcedure([task("t1", 1)], [step("s1", "t1", 1), step("gone", "deleted", 1)]);
    expect(groups[0].steps).toHaveLength(1);
    expect(groups.flatMap((g) => g.steps).map((s) => s.step.id)).not.toContain("gone");
  });

  it("ignores a top-level row that also appears in the step list", () => {
    const groups = groupProcedure([task("t1", 1)], [step("t1", null, 1)]);
    expect(groups[0].steps).toEqual([]);
  });
});

describe("taskHours", () => {
  it("sums its steps", () => {
    expect(taskHours({ estimated_hours: null }, [{ estimated_hours: 1 }, { estimated_hours: 0.25 }])).toBe(1.25);
  });

  it("reads numeric(6,2) coming back from postgres as a string", () => {
    expect(taskHours({ estimated_hours: null }, [{ estimated_hours: "1.00" }, { estimated_hours: "0.25" }])).toBe(1.25);
  });

  it("falls back to the task's own estimate when it has no steps", () => {
    expect(taskHours({ estimated_hours: 2 }, [])).toBe(2);
  });

  it("stays null when nothing is estimated — not zero", () => {
    expect(taskHours({ estimated_hours: null }, [{ estimated_hours: null }])).toBeNull();
    // Task-level estimate with unestimated steps: the task's figure stands.
    expect(taskHours({ estimated_hours: 1.5 }, [{ estimated_hours: null }, { estimated_hours: null }])).toBe(1.5);
    expect(taskHours({ estimated_hours: null }, [])).toBeNull();
  });

  it("lets a task-level estimate override the sum of its steps", () => {
    expect(taskHours({ estimated_hours: 3 }, [{ estimated_hours: 1 }, { estimated_hours: 0.25 }])).toBe(3);
  });

  it("counts a zero-hour step as estimated", () => {
    expect(taskHours({ estimated_hours: null }, [{ estimated_hours: 0 }, { estimated_hours: 1 }])).toBe(1);
  });
});

describe("taskBlockedReason", () => {
  it("blocks a task with no department", () => {
    expect(taskBlockedReason({ department_id: null })).toMatch(/department/i);
  });

  it("lets an unowned task through — it just lands unassigned", () => {
    expect(taskBlockedReason({ department_id: "dept" })).toBeNull();
  });
});

describe("applyDraft", () => {
  it("lays a staged edit over the saved row", () => {
    const rows = [{ id: "a", title: "Saved" }];
    expect(applyDraft(rows, new Map([["a", { title: "Typed" }]]))).toEqual([{ id: "a", title: "Typed" }]);
  });

  it("leaves rows with nothing staged exactly as they were", () => {
    const rows = [{ id: "a", title: "A" }, { id: "b", title: "B" }];
    const out = applyDraft(rows, new Map([["a", { title: "A2" }]]));
    expect(out[1]).toBe(rows[1]);
  });

  it("returns the same array when nothing is staged, so the list doesn't re-render", () => {
    const rows = [{ id: "a", title: "A" }];
    expect(applyDraft(rows, new Map())).toBe(rows);
  });

  it("keeps a staged edit for a row that is no longer there without inventing it", () => {
    expect(applyDraft([{ id: "a", title: "A" }], new Map([["gone", { title: "X" }]]))).toEqual([
      { id: "a", title: "A" },
    ]);
  });
})
