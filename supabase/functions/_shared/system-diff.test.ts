import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { diffSteps, type DiffStep } from "./system-diff.ts";

const step = (overrides: Partial<DiffStep> & { id: string }): DiffStep => ({
  title: "Step",
  estimated_hours: 4,
  department_id: "dept-1",
  owner_id: "owner-1",
  materialise_as: "task",
  ...overrides,
});

Deno.test("no changes produces an empty summary", () => {
  const s = step({ id: "s1" });
  assertEquals(diffSteps([s], [s]), { added: [], removed: [], changed: [] });
});

Deno.test("pure add: a step present only in after", () => {
  const before: DiffStep[] = [];
  const after = [step({ id: "s1" })];
  assertEquals(diffSteps(before, after), { added: after, removed: [], changed: [] });
});

Deno.test("pure remove: a step present only in before", () => {
  const before = [step({ id: "s1" })];
  const after: DiffStep[] = [];
  assertEquals(diffSteps(before, after), { added: [], removed: before, changed: [] });
});

Deno.test("empty before (first revision): everything in after is added", () => {
  const after = [step({ id: "s1" }), step({ id: "s2", title: "Second" })];
  const summary = diffSteps([], after);
  assertEquals(summary.added, after);
  assertEquals(summary.removed, []);
  assertEquals(summary.changed, []);
});

Deno.test("empty after: everything in before is removed", () => {
  const before = [step({ id: "s1" }), step({ id: "s2", title: "Second" })];
  const summary = diffSteps(before, []);
  assertEquals(summary.added, []);
  assertEquals(summary.removed, before);
  assertEquals(summary.changed, []);
});

Deno.test("changed field: title", () => {
  const before = [step({ id: "s1", title: "Old title" })];
  const after = [step({ id: "s1", title: "New title" })];
  assertEquals(diffSteps(before, after).changed, [
    { id: "s1", title: "New title", fields: [{ field: "title", from: "Old title", to: "New title" }] },
  ]);
});

Deno.test("changed field: estimated_hours", () => {
  const before = [step({ id: "s1", estimated_hours: 2 })];
  const after = [step({ id: "s1", estimated_hours: 6 })];
  assertEquals(diffSteps(before, after).changed, [
    { id: "s1", title: "Step", fields: [{ field: "estimated_hours", from: 2, to: 6 }] },
  ]);
});

Deno.test("changed field: department_id", () => {
  const before = [step({ id: "s1", department_id: "dept-1" })];
  const after = [step({ id: "s1", department_id: "dept-2" })];
  assertEquals(diffSteps(before, after).changed, [
    { id: "s1", title: "Step", fields: [{ field: "department_id", from: "dept-1", to: "dept-2" }] },
  ]);
});

Deno.test("changed field: owner_id", () => {
  const before = [step({ id: "s1", owner_id: "owner-1" })];
  const after = [step({ id: "s1", owner_id: "owner-2" })];
  assertEquals(diffSteps(before, after).changed, [
    { id: "s1", title: "Step", fields: [{ field: "owner_id", from: "owner-1", to: "owner-2" }] },
  ]);
});

Deno.test("changed field: materialise_as", () => {
  const before = [step({ id: "s1", materialise_as: "task" })];
  const after = [step({ id: "s1", materialise_as: "checklist_item" })];
  assertEquals(diffSteps(before, after).changed, [
    { id: "s1", title: "Step", fields: [{ field: "materialise_as", from: "task", to: "checklist_item" }] },
  ]);
});

Deno.test("several changes on one step are all reported together", () => {
  const before = [step({ id: "s1", title: "Old", estimated_hours: 2, department_id: "dept-1" })];
  const after = [step({ id: "s1", title: "New", estimated_hours: 5, department_id: "dept-2" })];
  assertEquals(diffSteps(before, after).changed, [
    {
      id: "s1",
      title: "New",
      fields: [
        { field: "title", from: "Old", to: "New" },
        { field: "estimated_hours", from: 2, to: 5 },
        { field: "department_id", from: "dept-1", to: "dept-2" },
      ],
    },
  ]);
});

Deno.test("numeric-string equality: '4.00' vs 4 is not a change", () => {
  const before = [step({ id: "s1", estimated_hours: "4.00" as unknown as number })];
  const after = [step({ id: "s1", estimated_hours: 4 })];
  assertEquals(diffSteps(before, after).changed, []);
});

Deno.test("numeric-string genuine change: '4.00' vs 5 is a change", () => {
  const before = [step({ id: "s1", estimated_hours: "4.00" as unknown as number })];
  const after = [step({ id: "s1", estimated_hours: 5 })];
  assertEquals(diffSteps(before, after).changed, [
    { id: "s1", title: "Step", fields: [{ field: "estimated_hours", from: 4, to: 5 }] },
  ]);
});

Deno.test("null to value transition on estimated_hours is a change", () => {
  const before = [step({ id: "s1", estimated_hours: null })];
  const after = [step({ id: "s1", estimated_hours: 4 })];
  assertEquals(diffSteps(before, after).changed, [
    { id: "s1", title: "Step", fields: [{ field: "estimated_hours", from: null, to: 4 }] },
  ]);
});

Deno.test("null to zero is still a change (0 is a real value, not absence)", () => {
  const before = [step({ id: "s1", estimated_hours: null })];
  const after = [step({ id: "s1", estimated_hours: 0 })];
  assertEquals(diffSteps(before, after).changed, [
    { id: "s1", title: "Step", fields: [{ field: "estimated_hours", from: null, to: 0 }] },
  ]);
});

Deno.test("value to null transition on department_id is a change", () => {
  const before = [step({ id: "s1", department_id: "dept-1" })];
  const after = [step({ id: "s1", department_id: null })];
  assertEquals(diffSteps(before, after).changed, [
    { id: "s1", title: "Step", fields: [{ field: "department_id", from: "dept-1", to: null }] },
  ]);
});

Deno.test("undefined normalises the same as null (no false change)", () => {
  const before = [step({ id: "s1", owner_id: undefined as unknown as null })];
  const after = [step({ id: "s1", owner_id: null })];
  assertEquals(diffSteps(before, after).changed, []);
});

Deno.test("added, removed and changed can all appear in one diff", () => {
  const before = [
    step({ id: "s1", title: "Stays" }),
    step({ id: "s2", title: "Goes away" }),
    step({ id: "s3", estimated_hours: 2 }),
  ];
  const after = [
    step({ id: "s1", title: "Stays" }),
    step({ id: "s3", estimated_hours: 3 }),
    step({ id: "s4", title: "Brand new" }),
  ];
  const summary = diffSteps(before, after);
  assertEquals(summary.added, [step({ id: "s4", title: "Brand new" })]);
  assertEquals(summary.removed, [step({ id: "s2", title: "Goes away" })]);
  assertEquals(summary.changed, [
    { id: "s3", title: "Step", fields: [{ field: "estimated_hours", from: 2, to: 3 }] },
  ]);
});
