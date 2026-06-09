import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RetainerBurnRow } from "@/types/pulse";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockSyncMutate = vi.hoisted(() => vi.fn());
const mockDeleteMutate = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("@/hooks/useRetainers", () => ({
  useRetainers: () => ({
    data: [
      {
        id: "p1",
        name: "Test Conductor retainer",
        status: "in_progress",
        retainer_hours_target: 10,
        retainer_monthly_fee_cents: 1000000,
        started_at: null,
        client_name: "Test Conductor",
      },
    ],
  }),
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
}));
vi.mock("@/hooks/useSyncActuals", () => ({
  useSyncActuals: () => ({ mutate: mockSyncMutate, isPending: false, variables: undefined }),
}));

import { RetainersList } from "./RetainersList";

describe("RetainersList sync controls", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows hours consumed for the retainer", () => {
    render(<RetainersList />);
    expect(screen.getByText("2 / 10h")).toBeInTheDocument();
  });

  it("per-row sync invokes with the project id and does not navigate", async () => {
    render(<RetainersList />);
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
