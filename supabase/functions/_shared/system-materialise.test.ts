import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planMaterialisation, type MaterialiseStep } from "./system-materialise.ts";

const step = (
  id: string,
  ordinal: number,
  title: string,
  materialise_as: MaterialiseStep["materialise_as"],
  parent_id: string | null = null,
): MaterialiseStep => ({ id, parent_id, ordinal, title, materialise_as });

Deno.test("empty input produces an empty plan", () => {
  assertEquals(planMaterialisation([]), { tasks: [], serviceChecklist: [], skipped: [] });
});

Deno.test("top-level task with no sub-steps becomes a task with an empty checklist", () => {
  const plan = planMaterialisation([step("s1", 1, "Kickoff call", "task")]);
  assertEquals(plan, {
    tasks: [{ stepId: "s1", title: "Kickoff call", checklist: [] }],
    serviceChecklist: [],
    skipped: [],
  });
});

Deno.test("top-level task with sub-steps: sub-steps become that task's checklist", () => {
  const plan = planMaterialisation([
    step("s1", 1, "Draft copy", "task"),
    step("s1a", 1, "Write headline", "task", "s1"), // sub-step's own value is ignored
    step("s1b", 2, "Write body", "none", "s1"),
  ]);
  assertEquals(plan, {
    tasks: [{ stepId: "s1", title: "Draft copy", checklist: ["Write headline", "Write body"] }],
    serviceChecklist: [],
    skipped: [],
  });
});

Deno.test("top-level checklist_item becomes an item on the service checklist", () => {
  const plan = planMaterialisation([step("s1", 1, "Send recap email", "checklist_item")]);
  assertEquals(plan, {
    tasks: [],
    serviceChecklist: ["Send recap email"],
    skipped: [],
  });
});

Deno.test("top-level none produces nothing and is reported as skipped", () => {
  const plan = planMaterialisation([step("s1", 1, "Optional step", "none")]);
  assertEquals(plan, { tasks: [], serviceChecklist: [], skipped: ["s1"] });
});

Deno.test("sub-step under a checklist_item parent rolls up as a sibling item", () => {
  const plan = planMaterialisation([
    step("s1", 1, "Send recap email", "checklist_item"),
    step("s1a", 1, "Attach the invoice", "task", "s1"),
  ]);
  assertEquals(plan, {
    tasks: [],
    serviceChecklist: ["Send recap email", "Attach the invoice"],
    skipped: [],
  });
});

Deno.test("sub-step under a none parent still rolls up even though the parent vanishes", () => {
  const plan = planMaterialisation([
    step("s1", 1, "Optional step", "none"),
    step("s1a", 1, "But this bit still matters", "checklist_item", "s1"),
  ]);
  assertEquals(plan, {
    tasks: [],
    serviceChecklist: ["But this bit still matters"],
    skipped: ["s1"],
  });
});

Deno.test("orphan sub-step (parent not in the input set) is treated as skipped", () => {
  const plan = planMaterialisation([step("orphan", 1, "Nobody's child", "task", "missing-parent")]);
  assertEquals(plan, { tasks: [], serviceChecklist: [], skipped: ["orphan"] });
});

Deno.test("everything is ordered by ordinal, not input order", () => {
  const plan = planMaterialisation([
    step("s2", 2, "Second step", "checklist_item"),
    step("s1", 1, "First step", "task"),
    step("s1b", 2, "Second sub-step", "task", "s1"),
    step("s1a", 1, "First sub-step", "task", "s1"),
  ]);
  assertEquals(plan.tasks, [
    { stepId: "s1", title: "First step", checklist: ["First sub-step", "Second sub-step"] },
  ]);
  assertEquals(plan.serviceChecklist, ["Second step"]);
});

Deno.test("a full mix of every matrix cell in one plan", () => {
  const plan = planMaterialisation([
    step("task-step", 1, "Task step", "task"),
    step("task-sub", 1, "Task sub-step", "checklist_item", "task-step"),
    step("checklist-step", 2, "Checklist step", "checklist_item"),
    step("checklist-sub", 1, "Checklist sub-step", "none", "checklist-step"),
    step("none-step", 3, "None step", "none"),
    step("none-sub", 1, "None sub-step", "task", "none-step"),
  ]);
  assertEquals(plan.tasks, [
    { stepId: "task-step", title: "Task step", checklist: ["Task sub-step"] },
  ]);
  assertEquals(plan.serviceChecklist, ["Checklist step", "Checklist sub-step", "None sub-step"]);
  assertEquals(plan.skipped, ["none-step"]);
});
