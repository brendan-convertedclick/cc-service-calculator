import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RetainerBurnRow } from "@/types/pulse";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockSyncMutate = vi.hoisted(() => vi.fn());
const mockDeleteMutate = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});
const CLIENT_RETAINER = {
  id: "p1",
  name: "Test Conductor retainer",
  status: "in_progress",
  retainer_hours_target: 10,
  retainer_monthly_fee_cents: 1000000,
  started_at: null,
  client_name: "Test Conductor",
  client_is_internal: false,
};
// Mutable so one test can add an internal client without moving the numbers
// every other test asserts on.
const retainers = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/hooks/useRetainers", () => ({
  useRetainers: () => ({ data: retainers.rows }),
  useDeleteRetainer: () => ({ mutate: mockDeleteMutate, isPending: false }),
}));
const burnRow: RetainerBurnRow = {
  projectId: "p1", clientName: "Test Conductor", feePerMonthCents: 1000000,
  hoursTarget: 10, hoursUsed: 2, burnPct: 20, daysLeftInMonth: 21,
  effectiveHourlyRateCents: 100000, projectedHours: 6,
  isOverrunRisk: false, isUnderutilised: false, rag: "green", needsSetup: false,
};
vi.mock("@/hooks/usePulseRetainerBurn", () => ({
  usePulseRetainerBurn: () => [burnRow],
  currentMonthKey: () => "2026-08",
}));
vi.mock("@/hooks/useRetainerAllocation", () => ({
  useRetainerAllocation: () => ({
    data: [
      {
        month: "2026-08",
        rows: [
          {
            key: "p1",
            kind: "retainer",
            clientName: "Test Conductor",
            name: "Test Conductor retainer",
            projectId: "p1",
            feeCents: 1000000,
            soldHours: 10,
            committedHours: 8,
            deliveredHours: 6,
            deliveredPoints: 24,
            briefCount: 3,
            openPoints: 0,
          },
        ],
      },
    ],
  }),
}));
vi.mock("@/hooks/useSyncActuals", () => ({
  useSyncActuals: () => ({ mutate: mockSyncMutate, isPending: false, variables: undefined }),
}));
vi.mock("@/hooks/useRetainerSubItems", () => ({
  useRetainerSubItems: () => ({
    data: [
      {
        taskId: "t1",
        serviceName: "Local SEO Pack",
        assigneeName: "Brendan",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        estimatedHours: 0.25,
        usedHours: 2,
        status: "closed",
        isDone: true,
      },
    ],
    isLoading: false,
  }),
}));

import { RetainersList } from "./RetainersList";

beforeEach(() => {
  retainers.rows = [CLIENT_RETAINER];
});

describe("RetainersList sync controls", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rolls a client up to planned, scheduled and completed before any drilldown", () => {
    render(<RetainersList />);
    // The rollup is the default view: the client's numbers are on its own row
    // and its retainers are not on screen at all.
    const row = screen.getByLabelText("Show retainers for Test Conductor").textContent!;
    expect(row).toContain("10h");
    expect(row).toContain("8h");
    expect(row).toContain("6h");
    expect(screen.queryByLabelText("Sync Test Conductor retainer")).not.toBeInTheDocument();
  });

  it("drills from the client rollup down to its retainers", async () => {
    render(<RetainersList />);
    await userEvent.click(screen.getByLabelText("Show retainers for Test Conductor"));
    expect(screen.getByLabelText("Sync Test Conductor retainer")).toBeInTheDocument();
  });

  it("per-row sync invokes with the project id and does not navigate", async () => {
    render(<RetainersList />);
    await userEvent.click(screen.getByLabelText("Show retainers for Test Conductor"));
    await userEvent.click(screen.getByLabelText("Sync Test Conductor retainer"));
    expect(mockSyncMutate).toHaveBeenCalled();
    expect(mockSyncMutate.mock.calls[0][0]).toBe("p1");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("header Sync all invokes with no project id", async () => {
    render(<RetainersList />);
    await userEvent.click(screen.getByRole("button", { name: /sync all/i }));
    expect(mockSyncMutate).toHaveBeenCalled();
    expect(mockSyncMutate.mock.calls[0][0]).toBeUndefined();
  });
});

describe("RetainersList sub-items", () => {
  beforeEach(() => vi.clearAllMocks());

  it("expands a retainer's sub-tasks via the chevron without navigating", async () => {
    render(<RetainersList />);
    expect(screen.queryByText("Local SEO Pack")).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Show retainers for Test Conductor"));
    await userEvent.click(
      screen.getByLabelText("Show tasks for Test Conductor retainer"),
    );
    expect(screen.getByText("Local SEO Pack")).toBeInTheDocument();
    expect(screen.getByText("0.25h")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("collapses sub-tasks on a second click", async () => {
    render(<RetainersList />);
    await userEvent.click(screen.getByLabelText("Show retainers for Test Conductor"));
    await userEvent.click(
      screen.getByLabelText("Show tasks for Test Conductor retainer"),
    );
    await userEvent.click(
      screen.getByLabelText("Hide tasks for Test Conductor retainer"),
    );
    expect(screen.queryByText("Local SEO Pack")).not.toBeInTheDocument();
  });
});

describe("RetainersList client vs internal", () => {
  beforeEach(() => vi.clearAllMocks());

  const GRANITE = {
    ...CLIENT_RETAINER,
    id: "p2",
    name: "Granite retainer",
    client_name: "Granite",
    client_is_internal: true,
    retainer_monthly_fee_cents: 250000,
  };

  it("opens on client work, with our own brands not on the page", () => {
    retainers.rows = [CLIENT_RETAINER, GRANITE];
    render(<RetainersList />);
    // Scoped to the table: the filter rail lists every client name too.
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Test Conductor")).toBeInTheDocument();
    expect(table.queryByText("Granite")).not.toBeInTheDocument();
  });

  it("switches to our own brands, and shows them no monthly fee", async () => {
    retainers.rows = [CLIENT_RETAINER, GRANITE];
    render(<RetainersList />);
    // formatZar uses non-breaking spaces as the thousands separator.
    const clientTotals = screen.getByRole("row", { name: /client retainers/i });
    expect(clientTotals.textContent!.replace(/\s/g, " ")).toContain("R 10 000");

    await userEvent.click(screen.getByRole("tab", { name: /internal/i }));
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Granite")).toBeInTheDocument();
    expect(table.queryByText("Test Conductor")).not.toBeInTheDocument();
    // The notional fee is kept in the data and deliberately not printed: it is
    // not revenue, and a money column invites the two books being added up.
    const internalTotals = screen.getByRole("row", { name: /internal/i });
    expect(internalTotals.textContent).not.toContain("2 500");
  });
});
