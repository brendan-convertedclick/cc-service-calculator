import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { currentBudgetMonth, type RetainerBudget } from "@/lib/retainer-budget";

const state = vi.hoisted(() => ({ s: { data: [] as unknown[], isLoading: false, isError: false } }));
vi.mock("@/hooks/useRetainerBudget", () => ({ useRetainerBudget: () => state.s }));

import { RetainerBudgetBoard } from "./RetainerBudgetBoard";

const mk = (name: string, free: number): RetainerBudget => ({
  projectId: name, projectName: name, clientId: "c", clientName: "Client",
  budget: 40, spent: 20, toDo: 20 - free, free, unspent: 0, unestimated: 0, departments: [],
});
const set = (data: RetainerBudget[]) => { state.s = { data, isLoading: false, isError: false }; };

describe("RetainerBudgetBoard", () => {
  beforeEach(() => set([]));

  it("sums short and free, lists the short one first", () => {
    set([mk("Roomy", 15.5), mk("Tight", -8.6)]);
    render(<RetainerBudgetBoard month="2026-10" />);
    expect(screen.getByText("1 retainer short by 8.6h. 1 with 15.5h free.")).toBeTruthy();
    const names = screen.getAllByText(/^(Roomy|Tight)$/).map((e) => e.textContent);
    expect(names).toEqual(["Tight", "Roomy"]);
  });

  it("pluralises and drops the free sentence", () => {
    set([mk("A", -1), mk("B", -2.5)]);
    render(<RetainerBudgetBoard month="2026-10" />);
    expect(screen.getByText("2 retainers short by 3.5h.")).toBeTruthy();
  });

  it("drops the short sentence and treats ~0 as neither", () => {
    set([mk("A", 4), mk("B", 0.02)]);
    render(<RetainerBudgetBoard month="2026-10" />);
    expect(screen.getByText("1 with 4.0h free.")).toBeTruthy();
  });

  it("says which month Spent is for when it is not the current one", () => {
    set([mk("A", 4)]);
    const { unmount } = render(<RetainerBudgetBoard month="2026-10" />);
    expect(screen.getByText("Spent is for October 2026. To do and Free are as of today.")).toBeTruthy();
    unmount();
    render(<RetainerBudgetBoard month={currentBudgetMonth()} />);
    expect(screen.queryByText(/Spent is for/)).toBeNull();
  });

  it("shows loading and error without throwing", () => {
    state.s = { data: [], isLoading: true, isError: false };
    const { unmount } = render(<RetainerBudgetBoard month="2026-10" />);
    expect(screen.getByText("Loading budgets…")).toBeTruthy();
    unmount();
    state.s = { data: [], isLoading: false, isError: true };
    render(<RetainerBudgetBoard month="2026-10" />);
    expect(screen.getByText("Couldn't load budgets.")).toBeTruthy();
  });
});
