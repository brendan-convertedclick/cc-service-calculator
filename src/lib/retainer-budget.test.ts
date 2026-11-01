import { describe, expect, it } from "vitest";
import {
  budgetVerdict,
  currentBudgetMonth,
  DEPT_GROUP,
  summariseBudget,
  type BudgetRow,
} from "./retainer-budget";

const row = (o: Partial<BudgetRow>): BudgetRow => ({
  project_id: "p1",
  project_name: "Retainer",
  client_id: "c1",
  client_name: "Client",
  department_id: "d1",
  department_name: "Development",
  budget_hours: 14.4,
  alloc_hours: 0,
  spent_hours: 0,
  todo_hours: 0,
  unestimated_count: 0,
  ...o,
});

const one = (budget: number, spent: number, toDo: number) =>
  summariseBudget([row({ budget_hours: budget, spent_hours: spent, todo_hours: toDo })])[0];

describe("summariseBudget", () => {
  it("takes budget once and derives free and unspent", () => {
    const [b] = summariseBudget([
      row({ spent_hours: 3 }),
      row({ department_name: "Creative Production", todo_hours: 2 }),
    ]);
    expect(b.budget).toBe(14.4);
    expect(b.free).toBeCloseTo(9.4);
    expect(b.unspent).toBeCloseTo(11.4);
    expect(b.departments.map((d) => d.group).sort()).toEqual(["creative", "dev"]);
  });

  it("takes unestimated once per retainer, not per department row", () => {
    const [b] = summariseBudget([
      row({ unestimated_count: 2 }),
      row({ department_name: "SEO", unestimated_count: 2 }),
    ]);
    expect(b.unestimated).toBe(2);
  });

  it("coerces numeric strings", () => {
    const [b] = summariseBudget([
      row({ spent_hours: "4.50" as unknown as number, budget_hours: "14.40" as unknown as number }),
      row({ department_name: "SEO", spent_hours: "1.50" as unknown as number }),
    ]);
    expect(b.spent).toBe(6);
    expect(b.budget).toBe(14.4);
  });

  it("merges departments of one group and maps null to none", () => {
    const [b] = summariseBudget([
      row({ department_name: "Admin", spent_hours: 1 }),
      row({ department_name: "Client Meeting", spent_hours: 2 }),
      row({ department_name: null, spent_hours: 0.5 }),
    ]);
    expect(b.departments.find((d) => d.group === "admin")?.spent).toBe(3);
    expect(b.departments.find((d) => d.group === "none")?.spent).toBe(0.5);
  });

  it("sorts retainers by budget descending", () => {
    const out = summariseBudget([
      row({ project_id: "a", budget_hours: 3 }),
      row({ project_id: "b", budget_hours: 20 }),
    ]);
    expect(out.map((b) => b.projectId)).toEqual(["b", "a"]);
  });
});

describe("budgetVerdict", () => {
  it("Dovetail shape uses to-do room", () => {
    const b = one(14.4, 4.5, 18.5);
    expect(b.free).toBeCloseTo(-8.6);
    expect(budgetVerdict(b, 3)).toBe("uses_todo");
    expect(budgetVerdict(b, 10)).toBe("over_budget");
  });
  it("Pimms shape is spent out", () => {
    const b = one(3.2, 3.2, 0);
    expect(budgetVerdict(b, 1)).toBe("over_budget");
    expect(budgetVerdict(b, 0)).toBe("fits");
  });
});

describe("currentBudgetMonth", () => {
  it("uses SAST, not UTC", () => {
    expect(currentBudgetMonth(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
    expect(currentBudgetMonth(new Date("2026-10-31T21:59:00Z"))).toBe("2026-10");
  });
});

describe("DEPT_GROUP", () => {
  it("maps every live department", () => {
    const live = [
      "Strategy", "Project Management", "Development", "SEO", "Paid Media",
      "Creative Production", "Video / 3D / Motion Production", "Content & Copywriting",
      "Social Media", "Software / Spend / Pass-Through / Non-Delivery", "Client Meeting",
      "Internal Meeting", "Admin", "New Business", "Finance", "Human Resources",
      "Marketing", "Sales", "Account Owner",
    ];
    for (const n of live) expect(DEPT_GROUP[n], n).toBeDefined();
  });
});
