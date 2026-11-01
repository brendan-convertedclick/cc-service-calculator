import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { RetainerBudget } from "@/lib/retainer-budget";

const budget: RetainerBudget = {
  projectId: "p", projectName: "Web retainer", clientId: "c", clientName: "Trellidor",
  budget: 10, spent: 2, toDo: 1, free: 7, unspent: 8, unestimated: 0, departments: [],
};

vi.mock("@/hooks/useRetainerBudget", () => ({
  useRetainerBudget: () => ({ data: [budget], isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useRequestLinkage", () => ({
  useRequestLinkage: () => ({ data: undefined }),
  aggregateBurn: () => null,
}));
vi.mock("@/lib/edge", () => ({
  callEdgeFn: async () => ({
    context: {
      id: "t", name: "Task", url: "u", description: null, status: null, list_name: null,
      assignees: [], due_date: null, date_created: null, original_points: 8,
      time_estimate_ms: null, time_spent_ms: 0, points_consumed: 1,
    },
  }),
}));
vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.in = async () => ({ data: [], error: null });
  chain.limit = () => chain;
  chain.maybeSingle = async () => ({ data: null, error: null });
  return { supabase: { from: () => chain } };
});

import { RequestContext } from "./RequestContext";

const wrap = (ui: React.ReactElement) =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );

describe("RequestContext budget bar", () => {
  it("draws a 12 point request as a 3.0h ask", async () => {
    wrap(<RequestContext taskId="t" requestedPoints={12} clientId="c" />);
    expect(await screen.findByText("As it stands today")).toBeInTheDocument();
    expect(await screen.findByTitle("This request: 3.0h")).toBeInTheDocument();
  });

  it("shows no bar without a client", async () => {
    wrap(<RequestContext taskId="t" requestedPoints={12} />);
    await screen.findByText("Original task");
    expect(screen.queryByText("As it stands today")).toBeNull();
  });
});
