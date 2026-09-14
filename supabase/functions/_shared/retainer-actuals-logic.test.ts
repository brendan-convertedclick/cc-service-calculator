import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { collectProvisionedActuals, monthsBefore } from "./retainer-actuals-logic.ts";

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

Deno.test("excludes a period that has not started yet", () => {
  const out = collectProvisionedActuals(
    new Set<string>(),
    [{ clickup_task_ids: ["t1"], period_start: "2000-02-01", period_end: "2000-02-28", points_per_occurrence: 2 }],
    today,
  );
  assertEquals(out, []);
});

// Seeding is the only door in: a task the sync missed during its own month
// used to be unreachable forever, which is how 60 of August 2026's 133
// provisioned tasks ended up invisible and their month read as an em dash.
Deno.test("still picks up a task from a month already gone", () => {
  const out = collectProvisionedActuals(
    new Set<string>(),
    [{ clickup_task_ids: ["t1"], period_start: "1999-11-01", period_end: "1999-11-30", points_per_occurrence: 2 }],
    today,
  );
  assertEquals(out, [{ clickup_task_id: "t1", dept_id: null, planned_hours: 0.5 }]);
});

// The bound exists because catch-up costs two ClickUp calls per task in a
// sequential loop; without it one tick could try to chase years of backlog.
Deno.test("stops looking once a period is older than the lookback", () => {
  const rows = [
    { clickup_task_ids: ["old"], period_start: "1999-01-01", period_end: "1999-01-31", points_per_occurrence: 2 },
  ];
  assertEquals(collectProvisionedActuals(new Set<string>(), rows, today), []);
  // ...but it is a bound, not a rule about the past: widen it and the same row
  // is eligible again.
  assertEquals(collectProvisionedActuals(new Set<string>(), rows, today, 24).length, 1);
});

Deno.test("monthsBefore crosses a year boundary", () => {
  assertEquals(monthsBefore("2000-01-15", 6), "1999-07-15");
  assertEquals(monthsBefore("2000-01-15", 1), "1999-12-15");
});

Deno.test("planned_hours is 0 when points are null", () => {
  const out = collectProvisionedActuals(
    new Set<string>(),
    [{ clickup_task_ids: ["t1"], period_start: "2000-01-01", period_end: "2000-01-31", points_per_occurrence: null }],
    today,
  );
  assertEquals(out[0].planned_hours, 0);
});
