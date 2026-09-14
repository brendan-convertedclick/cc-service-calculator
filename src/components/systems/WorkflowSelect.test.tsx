import { describe, expect, it } from "vitest";
import { checklistFromSteps, pointsFromSteps } from "./WorkflowSelect";

describe("checklistFromSteps", () => {
  it("keeps step titles in the order given, one per line", () => {
    expect(
      checklistFromSteps([
        { title: "Implement the change", materialise_as: "task" },
        { title: "Clear the cache", materialise_as: "checklist_item" },
      ]),
    ).toBe("Implement the change\nClear the cache");
  });

  it("drops steps that never materialise", () => {
    expect(
      checklistFromSteps([
        { title: "Decision?", materialise_as: "none" },
        { title: "Check Incognito", materialise_as: "task" },
      ]),
    ).toBe("Check Incognito");
  });

  it("is empty for a workflow with no materialising steps", () => {
    expect(checklistFromSteps([{ title: "Decision?", materialise_as: "none" }])).toBe("");
  });
});

describe("pointsFromSteps", () => {
  const step = (estimated_hours: number | null, materialise_as = "task") => ({
    materialise_as,
    estimated_hours,
  });

  it("converts the procedure's estimated hours to sprint points", () => {
    // 1 point = 15 minutes, the same conversion the retainers use.
    expect(pointsFromSteps([step(1), step(0.5)])).toBe(6);
    expect(pointsFromSteps([step(6)])).toBe(24);
  });

  it("ignores decision nodes and notes, exactly as the checklist does", () => {
    expect(pointsFromSteps([step(2), step(10, "none")])).toBe(8);
  });

  it("returns null when nothing on the procedure is estimated", () => {
    // 15 of 167 procedures carry no hours. Null means "leave what the operator
    // has" — a confident 0, or a silent 1, is worse than not answering.
    expect(pointsFromSteps([step(null), step(0)])).toBeNull();
    expect(pointsFromSteps([])).toBeNull();
  });

  it("never rounds a real estimate down to nothing", () => {
    expect(pointsFromSteps([step(0.05)])).toBe(1);
  });
});
