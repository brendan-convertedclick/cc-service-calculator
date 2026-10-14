import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const callEdgeFn = vi.fn();
vi.mock("@/lib/edge", () => ({ callEdgeFn: (...a: unknown[]) => callEdgeFn(...a) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ currentUserId: "me" }) }));
vi.mock("@/hooks/useRetainers", () => ({ useRetainers: () => ({ data: [] }) }));
vi.mock("@/components/approvals/RequestContext", () => ({ RequestContext: () => null }));

const brief = {
  id: "b1",
  status: "pending_approval",
  task_name: "Inbox checks",
  sprint_points: 4,
  is_internal: true,
  created_at: "2026-10-14T08:00:00Z",
  goal: "g",
  success_criteria: "s",
  measurable_outcome: "m",
  clickup_list_name: "Delivery",
  client: { id: "c1", name: "Granite" },
  submitter: { id: "t1", full_name: "Sithembile Tshabalala", email: null },
};
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        order: async () => ({ data: table === "staff_briefs" ? [brief] : [], error: null }),
      }),
    }),
  },
}));

import { ActionRow, Approvals } from "./Approvals";

// A precondition (no retainer picked) blocks Approve and nothing else: refusing
// a brief must never require the precondition to be met first.
describe("ActionRow", () => {
  const noop = () => {};

  it("blocks approve but not reject when a precondition is unmet", () => {
    render(<ActionRow onReject={noop} onApprove={noop} approveDisabled approveLabel="Approve" />);
    expect(screen.getByRole("button", { name: /approve/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /reject/i })).toBeEnabled();
  });

  it("is fully usable once the precondition is met", () => {
    const onApprove = vi.fn();
    render(<ActionRow onReject={noop} onApprove={onApprove} approveLabel="Approve" />);
    const btn = screen.getByRole("button", { name: /approve/i });
    expect(btn).toBeEnabled();
    btn.click();
    expect(onApprove).toHaveBeenCalled();
  });
});

// Approving must not wait on ClickUp: the card leaves at the click, and only a
// failed write brings it back.
describe("Approvals", () => {
  it("takes the card off at the click and puts it back if the write fails", async () => {
    let fail!: (e: Error) => void;
    callEdgeFn.mockImplementation(() => new Promise((_, reject) => (fail = reject)));
    render(<Approvals />);
    (await screen.findByRole("button", { name: /approve/i })).click();
    await waitFor(() => expect(screen.getByText("Briefs · 0")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();

    fail(new Error("ClickUp said no"));
    await waitFor(() => expect(screen.getByText("Briefs · 1")).toBeInTheDocument());
  });
});
