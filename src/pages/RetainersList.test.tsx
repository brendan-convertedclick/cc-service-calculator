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
// Partial mock: the hooks are stubbed, but isInternalRetainer is the real pure
// function — it is the rule deciding which tab a row lands on, so a stub would
// mean these tests assert on tabs the page does not actually build.
vi.mock("@/hooks/useRetainers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useRetainers")>()),
  useRetainers: () => ({ data: retainers.rows }),
  useDeleteRetainer: () => ({ mutate: mockDeleteMutate, isPending: false }),
  useSetRetainerInternal: () => ({ mutate: vi.fn(), isPending: false }),
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
// Extra allocation rows one test adds on top of the default. Reset before
// every test (below) so the numbers the other tests assert on never move.
const extraAlloc = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/hooks/useRetainerAllocation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useRetainerAllocation")>()),
  useRetainerAllocation: () => ({
    data: [
      {
        month: "2026-08",
        rows: [
          ...extraAlloc.rows,
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
            measuredHours: 0,
            deliveredItems: 3,
            measuredItems: 0,
            recurringHours: 2,
            deliveredPoints: 24,
            briefCount: 3,
            openPoints: 0,
            scheduledOpenHours: 0,
          },
        ],
      },
    ],
  }),
}));
// Real helpers, stubbed data: billingKey and impliedRateCents decide what the
// Invoiced cell says, so stubbing them would test a page this one does not build.
vi.mock("@/hooks/useAdhocInvoices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useAdhocInvoices")>()),
  useAdhocInvoices: () => ({ data: new Map() }),
}));
vi.mock("@/hooks/useRetainerTemplates", () => ({
  useSaveRetainerTemplate: () => ({ mutate: vi.fn(), isPending: false }),
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
  extraAlloc.rows = [];
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

  // Lisa, 2026-09-08: "under Internal — lets remove the column for monthly fee
  // as that doesn't apply here. Planned is also not applicable." Both are facts
  // about an invoice, and there is no invoice on our own work.
  it("drops the two invoice columns on Internal and shows Briefed instead", async () => {
    retainers.rows = [CLIENT_RETAINER, GRANITE];
    render(<RetainersList />);
    expect(screen.getByRole("columnheader", { name: "Monthly fee" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Planned" })).toBeInTheDocument();
    // Briefed is on the client tab too — it is what tells a retainer with no
    // delivery apart from one nobody even asked for work against.
    expect(screen.getByRole("columnheader", { name: "Briefed" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /internal/i }));
    expect(screen.queryByRole("columnheader", { name: "Monthly fee" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Planned" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Briefed" })).toBeInTheDocument();
    // Scheduled and Completed are on both — Lisa kept Scheduled explicitly.
    expect(screen.getByRole("columnheader", { name: "Scheduled" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Completed" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Still due" })).toBeInTheDocument();

    // The key follows the columns. Explaining a column that is not on screen is
    // how a key stops being trusted.
    const terms = [...document.querySelectorAll("details dt")].map((d) => d.textContent);
    expect(terms).not.toContain("Monthly fee");
    expect(terms).not.toContain("Planned");
    expect(terms).toContain("Briefed");
  });

  // 0162. The case the client-level flag could never express: a paying client
  // with one line nobody charges for. The client has to stay on both tabs —
  // its invoice on one, our cost on the other — or flagging the freebie would
  // take the whole account off the client book.
  it("moves a single flagged retainer to Internal and leaves the client's invoiced one behind", async () => {
    retainers.rows = [
      CLIENT_RETAINER,
      {
        ...CLIENT_RETAINER,
        id: "p3",
        name: "Test Conductor standing meeting",
        retainer_monthly_fee_cents: 0,
        is_internal: true,
      },
    ];
    render(<RetainersList />);

    let table = within(screen.getByRole("table"));
    expect(table.getByText("Test Conductor")).toBeInTheDocument();
    expect(table.queryByText(/standing meeting/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /internal/i }));
    await userEvent.click(screen.getByRole("button", { name: /show retainers for test conductor/i }));
    table = within(screen.getByRole("table"));
    expect(table.getByText(/standing meeting/i)).toBeInTheDocument();
  });

  // Lisa, 2026-09-08: "Why are there missing internal retainers — ie. Conductor,
  // Quartz, Flint, Granite". Because the page built its client list from
  // retainer records, and we do not invoice ourselves, so most of our brands
  // have none. Five of them were missing from the tab that exists to show them.
  it("lists one of our brands on Internal even with no retainer of its own", async () => {
    retainers.rows = [CLIENT_RETAINER];
    extraAlloc.rows = [
      {
        key: "internal:granite",
        kind: "internal",
        clientName: "Granite",
        name: "Internal work",
        projectId: null,
        feeCents: 0,
        soldHours: 0,
        committedHours: 0,
        deliveredHours: 12,
        deliveredPoints: 48,
        briefCount: 11,
        isInternal: true,
        openPoints: 0,
        scheduledOpenHours: 0,
      },
      // A paying client with ad hoc work and no retainer stays off the page —
      // that rule is unchanged, and this row is here to prove the fix above
      // did not quietly relax it.
      {
        key: "adhoc:als",
        kind: "adhoc",
        clientName: "A Love Supreme",
        name: "Ad hoc — invoiced separately",
        projectId: null,
        feeCents: 0,
        soldHours: 0,
        committedHours: 0,
        deliveredHours: 2.3,
        deliveredPoints: 9,
        briefCount: 4,
        isInternal: false,
        openPoints: 0,
        scheduledOpenHours: 0,
      },
    ];
    render(<RetainersList />);

    await userEvent.click(screen.getByRole("tab", { name: /internal/i }));
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Granite")).toBeInTheDocument();
    expect(table.queryByText("A Love Supreme")).not.toBeInTheDocument();
  });
});
