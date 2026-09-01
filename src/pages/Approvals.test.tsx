import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActionRow } from "./Approvals";

// The bug this guards: `busy` used to mean two things at once — a request is in
// flight, and Approve is not available yet. Passing "no retainer picked" through
// it left the card reading "Approving…" forever with Reject disabled too, so a
// brief could be neither approved nor refused. It looked like a frozen page.
describe("ActionRow", () => {
  const noop = () => {};

  it("blocks approve but not reject when a precondition is unmet", () => {
    render(
      <ActionRow onReject={noop} onApprove={noop} busy={false} approveDisabled approveLabel="Approve" />,
    );
    expect(screen.getByRole("button", { name: /approve/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /reject/i })).toBeEnabled();
  });

  it("does not claim to be approving when it is merely unavailable", () => {
    render(
      <ActionRow onReject={noop} onApprove={noop} busy={false} approveDisabled approveLabel="Approve" />,
    );
    expect(screen.queryByText("Approving…")).not.toBeInTheDocument();
  });

  it("says Approving… and blocks reject only while genuinely in flight", () => {
    render(<ActionRow onReject={noop} onApprove={noop} busy approveLabel="Approve" />);
    expect(screen.getByText("Approving…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject/i })).toBeDisabled();
  });

  it("is fully usable once the precondition is met", async () => {
    const onApprove = vi.fn();
    render(<ActionRow onReject={noop} onApprove={onApprove} busy={false} approveLabel="Approve" />);
    const btn = screen.getByRole("button", { name: /approve/i });
    expect(btn).toBeEnabled();
    btn.click();
    expect(onApprove).toHaveBeenCalled();
  });
});
