import { describe, expect, it } from "vitest";
import { checklistFromSteps } from "./WorkflowSelect";

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
