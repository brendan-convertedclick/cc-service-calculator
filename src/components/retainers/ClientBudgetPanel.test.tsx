import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RetainerBudget } from "@/lib/retainer-budget";

const budgets = vi.hoisted(() => ({ state: { data: [] as unknown[], isLoading: false, isError: false } }));
const lookup = vi.hoisted(() => ({ projectId: null as string | null, error: false }));

vi.mock("@/hooks/useRetainerBudget", () => ({ useRetainerBudget: () => budgets.state }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          not: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () =>
                  lookup.error
                    ? { data: null, error: { message: "boom" } }
                    : { data: lookup.projectId ? { parent_project_id: lookup.projectId } : null, error: null },
              }),
            }),
          }),
        }),
      }),
    }),
  },
}));

import { ClientBudgetPanel } from "./ClientBudgetPanel";

const mk = (o: Partial<RetainerBudget>): RetainerBudget => ({
  projectId: "p", projectName: "Retainer", clientId: "c", clientName: "Trellidor",
  budget: 10, spent: 0, toDo: 0, free: 10, unspent: 10, unestimated: 0, departments: [], ...o,
});

const renderPanel = (props: Partial<Parameters<typeof ClientBudgetPanel>[0]> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ClientBudgetPanel clientId="c" askHours={0} {...props} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  budgets.state = { data: [mk({ projectId: "a", projectName: "Web retainer" }), mk({ projectId: "b", projectName: "SEO retainer" })], isLoading: false, isError: false };
  lookup.projectId = null;
  lookup.error = false;
});

describe("ClientBudgetPanel", () => {
  it("shows only the retainer the task books to", async () => {
    lookup.projectId = "b";
    renderPanel({ clickupTaskId: "t1" });
    expect(await screen.findByText("SEO retainer")).toBeInTheDocument();
    expect(screen.queryByText("Web retainer")).not.toBeInTheDocument();
    expect(screen.queryByText(/isn't linked/)).not.toBeInTheDocument();
  });

  it("shows every retainer and says so when the task cannot be placed", async () => {
    renderPanel({ clickupTaskId: "t1" });
    expect(await screen.findByText(/This task isn't linked to a retainer, so all of Trellidor's retainers are shown\./)).toBeInTheDocument();
    expect(screen.getByText("Web retainer")).toBeInTheDocument();
    expect(screen.getByText("SEO retainer")).toBeInTheDocument();
  });

  it("falls back to all retainers when the lookup errors", async () => {
    lookup.error = true;
    renderPanel({ clickupTaskId: "t1" });
    expect(await screen.findByText(/isn't linked/)).toBeInTheDocument();
  });

  it("says the work is billed separately when there is no budget", () => {
    budgets.state = { data: [], isLoading: false, isError: false };
    renderPanel({ clientName: "Acme" });
    expect(screen.getByText("Acme has no retainer budget. This work is billed separately.")).toBeInTheDocument();
  });

  it("renders nothing while loading and a muted line on error", () => {
    budgets.state = { data: [], isLoading: true, isError: false };
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
    budgets.state = { data: [], isLoading: false, isError: true };
    renderPanel();
    expect(screen.getByText("Couldn't load the retainer budget.")).toBeInTheDocument();
  });
});
