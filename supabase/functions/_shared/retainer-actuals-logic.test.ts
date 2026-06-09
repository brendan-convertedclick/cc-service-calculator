import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { collectProvisionedActuals } from "./retainer-actuals-logic.ts";

const today = "2000-01-15";

Deno.test("includes current-period task not already tracked, derives planned_hours", () => {
  const out = collectProvisionedActuals(
    new Set<string>(),
    [{ clickup_task_ids: ["t1"], period_start: "2000-01-01", period_end: "2000-01-31", points_per_occurrence: 2 }],
    today,
  );
  assertEquals(out, [{ clickup_task_id: "t1", dept_id: null, planned_hours: 0.5 }]);
});

Deno.test("excludes tasks already in project_actuals_current", () => {
  const out = collectProvisionedActuals(
    new Set<string>(["t1"]),
    [{ clickup_task_ids: ["t1", "t2"], period_start: "2000-01-01", period_end: "2000-01-31", points_per_occurrence: 4 }],
    today,
  );
  assertEquals(out.map((a) => a.clickup_task_id), ["t2"]);
});

Deno.test("dedupes a task id repeated across rows", () => {
  const out = collectProvisionedActuals(
    new Set<string>(),
    [
      { clickup_task_ids: ["t1"], period_start: "2000-01-01", period_end: "2000-01-31", points_per_occurrence: 1 },
      { clickup_task_ids: ["t1"], period_start: "2000-01-01", period_end: "2000-01-31", points_per_occurrence: 1 },
    ],
    today,
  );
  assertEquals(out.length, 1);
  assertEquals(out[0].clickup_task_id, "t1");
});

Deno.test("excludes rows whose period does not cover today", () => {
  const out = collectProvisionedActuals(
    new Set<string>(),
    [{ clickup_task_ids: ["t1"], period_start: "2000-02-01", period_end: "2000-02-28", points_per_occurrence: 2 }],
    today,
  );
  assertEquals(out, []);
});

Deno.test("planned_hours is 0 when points are null", () => {
  const out = collectProvisionedActuals(
    new Set<string>(),
    [{ clickup_task_ids: ["t1"], period_start: "2000-01-01", period_end: "2000-01-31", points_per_occurrence: null }],
    today,
  );
  assertEquals(out[0].planned_hours, 0);
});
