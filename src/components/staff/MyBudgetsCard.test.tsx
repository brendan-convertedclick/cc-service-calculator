import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RetainerBudget } from "@/lib/retainer-budget";

const s = vi.hoisted(() => ({
  userId: "u1" as string | null,
  budgets: { data: [] as unknown[], isLoading: false, isError: false },
  briefIds: [] as string[],
  provIds: [] as string[],
}));

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ currentUserId: s.userId }) }));
vi.mock("@/hooks/useRetainerBudget", () => ({ useRetainerBudget: () => s.budgets }));
vi.mock("@/components/retainers/RetainerBudgetBar", () => ({
  RetainerBudgetBar: ({ budget }: { budget: RetainerBudget }) => <div data-testid="bar">{budget.projectName}</div>,
}));
vi.mock("@/lib/supabase", () => {
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "or", "gte", "lt", "is", "neq"]) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown) => res({ data: rows, error: null });
    return c;
  };
  return {
    supabase: {
      from: (t: string) =>
        chain(t === "briefs" ? s.briefIds.map((id) => ({ parent_project_id: id })) : s.provIds.map((id) => ({ project_id: id }))),
    },
  };
});

import { MyBudgetsCard } from "./MyBudgetsCard";

const mk = (id: string, free: number): RetainerBudget => ({
  projectId: id, projectName: `R-${id}`, clientId: "c", clientName: "C",
  budget: 10, spent: 0, toDo: 0, free, unspent: free, unestimated: 0, departments: [],
});

const renderCard = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MyBudgetsCard />
    </QueryClientProvider>,
  );

beforeEach(() => {
  s.userId = "u1";
  s.briefIds = [];
  s.provIds = [];
  s.budgets = { data: [mk("a", 5), mk("b", 1), mk("c", 3)], isLoading: false, isError: false };
});

describe("MyBudgetsCard", () => {
  it("shows only my retainers, worst free first", async () => {
    s.briefIds = ["a"];
    s.provIds = ["c"];
    renderCard();
    const bars = await screen.findAllByTestId("bar");
    expect(bars.map((b) => b.textContent)).toEqual(["R-c", "R-a"]);
  });

  it("shared login shows every retainer with the explanation", () => {
    s.userId = null;
    renderCard();
    expect(screen.getAllByTestId("bar")).toHaveLength(3);
    expect(screen.getByText("Signed in with the shared login, so every retainer is shown.")).toBeTruthy();
  });

  it("no open work shows the empty line and Show all reveals everything", async () => {
    renderCard();
    expect(await screen.findByText("You have no open work on a retainer this month.")).toBeTruthy();
    expect(screen.queryAllByTestId("bar")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Show all retainers" }));
    expect(screen.getAllByTestId("bar").map((b) => b.textContent)).toEqual(["R-b", "R-c", "R-a"]);
  });

  it("toggles between mine and all when I have work", async () => {
    s.briefIds = ["a"];
    renderCard();
    expect(await screen.findAllByTestId("bar")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Show all retainers" }));
    expect(screen.getAllByTestId("bar")).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "Show mine" }));
    expect(screen.getAllByTestId("bar")).toHaveLength(1);
  });
});
