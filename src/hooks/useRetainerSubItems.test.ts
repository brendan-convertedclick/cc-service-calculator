import { describe, it, expect } from "vitest";
import {
  combineSubItems,
  type ProvisionedTaskRow,
  type SubItemActualRow,
} from "./useRetainerSubItems";

const provRow = (over: Partial<ProvisionedTaskRow> = {}): ProvisionedTaskRow => ({
  clickup_task_ids: ["t1"],
  period_start: "2026-06-01",
  period_end: "2026-06-30",
  retainer_recurring_services: {
    points_per_occurrence: 1,
    services: { name: "Local SEO Pack" },
  },
  team_members: { full_name: "Brendan" },
  ...over,
});

const actualRow = (over: Partial<SubItemActualRow> = {}): SubItemActualRow => ({
  clickup_task_id: "t1",
  planned_hours: 0.25,
  actual_hours: 2,
  status_at_sync: "closed",
  ...over,
});

describe("combineSubItems", () => {
  it("joins a provisioned task with its synced actuals", () => {
    const items = combineSubItems([provRow()], [actualRow()]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      taskId: "t1",
      serviceName: "Local SEO Pack",
      assigneeName: "Brendan",
      estimatedHours: 0.25,
      usedHours: 2,
      status: "closed",
      isDone: true,
    });
  });

  it("marks never-synced tasks with null usedHours and points-derived estimate", () => {
    const items = combineSubItems([provRow()], []);
    expect(items[0].usedHours).toBeNull();
    expect(items[0].status).toBeNull();
    expect(items[0].isDone).toBe(false);
    // 1 point × 15 min = 0.25h fallback
    expect(items[0].estimatedHours).toBe(0.25);
  });

  it("treats open ClickUp statuses as not done", () => {
    const items = combineSubItems(
      [provRow()],
      [actualRow({ status_at_sync: "in progress", actual_hours: 1 })],
    );
    expect(items[0].isDone).toBe(false);
    expect(items[0].status).toBe("in progress");
  });

  it("expands multiple task ids in one provisioned row and dedupes across rows", () => {
    const items = combineSubItems(
      [
        provRow({ clickup_task_ids: ["t1", "t2"] }),
        provRow({ clickup_task_ids: ["t2", "t3"] }),
      ],
      [],
    );
    expect(items.map((i) => i.taskId)).toEqual(["t1", "t2", "t3"]);
  });

  it("defaults usedHours to 0 when the actuals row has null hours", () => {
    const items = combineSubItems(
      [provRow()],
      [actualRow({ actual_hours: null })],
    );
    expect(items[0].usedHours).toBe(0);
  });

  it("falls back to a generic service name and null estimate without joins", () => {
    const items = combineSubItems(
      [provRow({ retainer_recurring_services: null, team_members: null })],
      [],
    );
    expect(items[0].serviceName).toBe("Recurring service");
    expect(items[0].assigneeName).toBeNull();
    expect(items[0].estimatedHours).toBeNull();
  });
});
