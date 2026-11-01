/**
 * Budget / Spent / To do / Free for a retainer, summarised from the rows of the
 * `retainer_budget` SQL function (one row per retainer x department).
 */

export interface BudgetRow {
  project_id: string;
  project_name: string;
  client_id: string;
  client_name: string;
  department_id: string | null;
  department_name: string | null;
  budget_hours: number | string;
  alloc_hours: number | string;
  spent_hours: number | string;
  todo_hours: number | string;
  unestimated_count: number | string;
}

export type DeptGroup =
  | "dev" | "creative" | "seo" | "paid" | "social" | "strategy" | "admin" | "none";

// Keyed by department name. Anything non-delivery folds into admin.
export const DEPT_GROUP: Record<string, DeptGroup> = {
  Development: "dev",
  "Creative Production": "creative",
  "Video / 3D / Motion Production": "creative",
  "Content & Copywriting": "creative",
  SEO: "seo",
  "Paid Media": "paid",
  "Social Media": "social",
  Strategy: "strategy",
  "Project Management": "admin",
  "Client Meeting": "admin",
  "Internal Meeting": "admin",
  Admin: "admin",
  "Account Owner": "admin",
  "Software / Spend / Pass-Through / Non-Delivery": "admin",
  "New Business": "admin",
  Finance: "admin",
  "Human Resources": "admin",
  Marketing: "admin",
  Sales: "admin",
};

export const DEPT_GROUP_LABEL: Record<DeptGroup, string> = {
  dev: "Development",
  creative: "Creative",
  seo: "SEO",
  paid: "Paid media",
  social: "Social",
  strategy: "Strategy",
  admin: "Admin & meetings",
  none: "Not assigned",
};

export interface RetainerBudget {
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  budget: number;
  spent: number;
  toDo: number;
  free: number;
  unspent: number;
  unestimated: number;
  departments: Array<{ group: DeptGroup; alloc: number; spent: number; toDo: number }>;
}

export function summariseBudget(rows: BudgetRow[]): RetainerBudget[] {
  const out = new Map<string, RetainerBudget>();
  for (const r of rows) {
    let b = out.get(r.project_id);
    if (!b) {
      // budget and unestimated repeat on every department row: take them once.
      b = {
        projectId: r.project_id,
        projectName: r.project_name,
        clientId: r.client_id,
        clientName: r.client_name,
        budget: Number(r.budget_hours),
        spent: 0,
        toDo: 0,
        free: 0,
        unspent: 0,
        unestimated: Number(r.unestimated_count),
        departments: [],
      };
      out.set(r.project_id, b);
    }
    const group = (r.department_name && DEPT_GROUP[r.department_name]) || "none";
    let d = b.departments.find((x) => x.group === group);
    if (!d) b.departments.push((d = { group, alloc: 0, spent: 0, toDo: 0 }));
    d.alloc += Number(r.alloc_hours);
    d.spent += Number(r.spent_hours);
    d.toDo += Number(r.todo_hours);
    b.spent += Number(r.spent_hours);
    b.toDo += Number(r.todo_hours);
  }
  for (const b of out.values()) {
    b.free = b.budget - b.spent - b.toDo;
    b.unspent = b.budget - b.spent;
  }
  return [...out.values()].sort((a, c) => c.budget - a.budget);
}

export type BudgetVerdict = "fits" | "uses_todo" | "over_budget";

/** fits: inside Free. uses_todo: only fits by eating booked work. over_budget: past what is left. */
export function budgetVerdict(b: RetainerBudget, askHours: number): BudgetVerdict {
  if (askHours <= b.free) return "fits";
  if (askHours <= b.unspent) return "uses_todo";
  return "over_budget";
}

/** SAST "YYYY-MM". Shifted by hand: the runtime's own zone (or UTC) is wrong for 2h a day. */
export function currentBudgetMonth(now: Date = new Date()): string {
  return new Date(now.getTime() + 2 * 3600_000).toISOString().slice(0, 7);
}
