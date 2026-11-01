import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RetainerBudgetBar } from "./RetainerBudgetBar";
import type { RetainerBudget } from "@/lib/retainer-budget";

const mk = (o: Partial<RetainerBudget>): RetainerBudget => ({
  projectId: "p", projectName: "Retainer", clientId: "c", clientName: "Client",
  budget: 10, spent: 0, toDo: 0, free: 10, unspent: 10, unestimated: 0, departments: [], ...o,
});

const dovetail = mk({
  clientName: "Dovetail", budget: 19.5, spent: 9.6, toDo: 18.5, free: -8.6, unspent: 9.9,
  departments: [{ group: "seo", alloc: 5.1, spent: 9.6, toDo: 18.5 }],
});
const trellidor = mk({
  clientName: "Trellidor", budget: 52.5, spent: 29.7, toDo: 7.3, free: 15.5, unspent: 22.8,
  departments: [{ group: "dev", alloc: 40, spent: 29.7, toDo: 7.3 }],
});

describe("RetainerBudgetBar", () => {
  it("shows short and unspent when booked past the budget", () => {
    render(<RetainerBudgetBar budget={dovetail} />);
    expect(screen.getByText("8.6h short")).toBeInTheDocument();
    expect(screen.getByText("9.9h unspent")).toBeInTheDocument();
  });

  it("clamps free at 0 in the verdict when the ask does not fit", () => {
    render(<RetainerBudgetBar budget={dovetail} askHours={3} />);
    expect(screen.getByText(/Only 0\.0h is free/)).toBeInTheDocument();
  });

  it("says an ask fits in Free", () => {
    render(<RetainerBudgetBar budget={trellidor} askHours={2} />);
    expect(screen.getByText("15.5h free")).toBeInTheDocument();
    expect(screen.getByText(/Fits in Free/)).toBeInTheDocument();
  });

  it("says who has to pay when the ask is past the budget", () => {
    render(<RetainerBudgetBar budget={trellidor} askHours={30} />);
    expect(screen.getByText(/7\.2h past the budget/)).toBeInTheDocument();
  });

  it("warns about open tasks with no estimate", () => {
    render(<RetainerBudgetBar budget={mk({ unestimated: 2 })} />);
    expect(screen.getByText(/2 open tasks have no estimate/)).toBeInTheDocument();
  });

  it("warns when the department split adds up to more than the budget", () => {
    const b = mk({
      budget: 3.2, free: 3.2, unspent: 3.2,
      departments: [
        { group: "dev", alloc: 3, spent: 0, toDo: 0 },
        { group: "seo", alloc: 2.1, spent: 0, toDo: 0 },
      ],
    });
    const { container } = render(<RetainerBudgetBar budget={b} showDepartments />);
    expect(screen.getByText(/adds up to 5\.1h/)).toBeInTheDocument();
    expect(container.textContent).toContain("Not split 0.0h");
  });

  it("labels the bar for assistive tech", () => {
    render(<RetainerBudgetBar budget={trellidor} />);
    expect(
      screen.getByRole("img", { name: "29.7h spent, 7.3h to do, of 52.5h budget" }),
    ).toBeInTheDocument();
  });

  it("counts only the ask past the budget when already over", () => {
    const b = mk({ budget: 19.5, spent: 25, toDo: 0, free: -5.5, unspent: -5.5 });
    render(<RetainerBudgetBar budget={b} askHours={3} />);
    expect(screen.getByText(/^3\.0h past the budget/)).toBeInTheDocument();
    expect(screen.getByText("already 5.5h over")).toBeInTheDocument();
  });

  it("shows Fully booked when free is about zero", () => {
    render(<RetainerBudgetBar budget={mk({ free: 0.02, unspent: 4 })} />);
    expect(screen.getByText("Fully booked")).toBeInTheDocument();
  });
});
