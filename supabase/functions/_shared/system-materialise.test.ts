import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planMaterialisation, renderHowTo, type MaterialiseStep } from "./system-materialise.ts";

const step = (
  id: string,
  ordinal: number,
  title: string,
  materialise_as: MaterialiseStep["materialise_as"],
  parent_id: string | null = null,
  description: string | null = null,
): MaterialiseStep => ({ id, parent_id, ordinal, title, materialise_as, description });

const item = (title: string, description: string | null = null) => ({ title, description });

Deno.test("empty input produces an empty plan", () => {
  assertEquals(planMaterialisation([]), { tasks: [], serviceChecklist: [], skipped: [] });
});

Deno.test("a task with no steps is a task with an empty checklist, not an error", () => {
  const plan = planMaterialisation([step("s1", 1, "Kickoff call", "task")]);
  assertEquals(plan, {
    tasks: [{ stepId: "s1", title: "Kickoff call", description: null, checklist: [] }],
    serviceChecklist: [],
    skipped: [],
  });
});

Deno.test("a task's steps become its checklist, carrying their descriptions", () => {
  const plan = planMaterialisation([
    step("s1", 1, "Draft copy", "task", null, "Tone: plain, short sentences."),
    step("s1a", 1, "Write headline", "task", "s1", "Under 60 characters."),
    step("s1b", 2, "Write body", "checklist_item", "s1"),
  ]);
  assertEquals(plan.tasks, [
    {
      stepId: "s1",
      title: "Draft copy",
      description: "Tone: plain, short sentences.",
      checklist: [item("Write headline", "Under 60 characters."), item("Write body")],
    },
  ]);
});

Deno.test("a step switched off is skipped, not silently pushed anyway", () => {
  const plan = planMaterialisation([
    step("s1", 1, "Draft copy", "task"),
    step("s1a", 1, "Write headline", "checklist_item", "s1"),
    step("s1b", 2, "Internal sanity check", "none", "s1"),
  ]);
  assertEquals(plan.tasks[0].checklist, [item("Write headline")]);
  assertEquals(plan.skipped, ["s1b"]);
});

Deno.test("top-level checklist_item becomes an item on the service checklist", () => {
  const plan = planMaterialisation([step("s1", 1, "Send recap email", "checklist_item")]);
  assertEquals(plan, { tasks: [], serviceChecklist: [item("Send recap email")], skipped: [] });
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
  assertEquals(plan.serviceChecklist, [item("Send recap email"), item("Attach the invoice")]);
});

Deno.test("sub-step under a none parent still rolls up even though the parent vanishes", () => {
  const plan = planMaterialisation([
    step("s1", 1, "Optional step", "none"),
    step("s1a", 1, "But this bit still matters", "checklist_item", "s1"),
  ]);
  assertEquals(plan.serviceChecklist, [item("But this bit still matters")]);
  assertEquals(plan.skipped, ["s1"]);
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
  assertEquals(plan.tasks[0].checklist, [item("First sub-step"), item("Second sub-step")]);
  assertEquals(plan.serviceChecklist, [item("Second step")]);
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
    { stepId: "task-step", title: "Task step", description: null, checklist: [item("Task sub-step")] },
  ]);
  // checklist-sub is switched off, so it no longer rides along.
  assertEquals(plan.serviceChecklist, [item("Checklist step"), item("None sub-step")]);
  assertEquals(plan.skipped, ["checklist-sub", "none-step"]);
});

Deno.test("renderHowTo returns null when there is nothing written anywhere", () => {
  assertEquals(renderHowTo({ title: "T", description: null, checklist: [item("a"), item("b")] }), null);
});

Deno.test("renderHowTo heads each step's instructions with the step's title", () => {
  const md = renderHowTo({
    title: "Draft copy",
    description: "Tone: plain.",
    checklist: [item("Write headline", "Under 60 characters."), item("Write body")],
  });
  assertEquals(md, "Tone: plain.\n\n## Write headline\n\nUnder 60 characters.");
});

Deno.test("renderHowTo appends the link back to Conductor, and is just the link when nothing else", () => {
  const origin = { label: "Procedure in Conductor", url: "https://x/systems/1" };
  assertEquals(
    renderHowTo({ title: "T", description: "Do it.", checklist: [] }, origin),
    "Do it.\n\n---\n\n[Procedure in Conductor](https://x/systems/1)",
  );
  assertEquals(
    renderHowTo({ title: "T", description: null, checklist: [] }, origin),
    "[Procedure in Conductor](https://x/systems/1)",
  );
});
