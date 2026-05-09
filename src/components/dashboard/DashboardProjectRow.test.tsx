import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { DashboardProjectRow } from "./DashboardProjectRow";

const baseProps = {
  id: "proj-1",
  name: "Google Ads Q2",
  engagementType: "retainer",
  scopeStatus: "on_track",
  isSelected: false,
  onSelect: vi.fn(),
  onHide: vi.fn(),
};

describe("DashboardProjectRow", () => {
  it("renders the project name", () => {
    render(<DashboardProjectRow {...baseProps} />);
    expect(screen.getByText("Google Ads Q2")).toBeInTheDocument();
  });

  it("renders the engagement type badge", () => {
    render(<DashboardProjectRow {...baseProps} />);
    expect(screen.getByText("retainer")).toBeInTheDocument();
  });

  it("calls onSelect when clicked", () => {
    const onSelect = vi.fn();
    render(<DashboardProjectRow {...baseProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Google Ads Q2/i }));
    expect(onSelect).toHaveBeenCalledWith("proj-1");
  });

  it("shows green dot for on_track", () => {
    render(<DashboardProjectRow {...baseProps} scopeStatus="on_track" />);
    expect(screen.getByTestId("status-dot")).toHaveClass("bg-green-500");
  });

  it("shows amber dot for needs_attention", () => {
    render(<DashboardProjectRow {...baseProps} scopeStatus="needs_attention" />);
    expect(screen.getByTestId("status-dot")).toHaveClass("bg-amber-400");
  });

  it("shows red dot for overdue", () => {
    render(<DashboardProjectRow {...baseProps} scopeStatus="overdue" />);
    expect(screen.getByTestId("status-dot")).toHaveClass("bg-red-500");
  });

  it("applies selected styles when isSelected=true", () => {
    render(<DashboardProjectRow {...baseProps} isSelected />);
    expect(screen.getByRole("button", { name: /Google Ads Q2/i })).toHaveClass("bg-m-primary-container");
  });

  it("calls onHide when dismiss button is clicked", () => {
    const onHide = vi.fn();
    render(<DashboardProjectRow {...baseProps} onHide={onHide} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onHide).toHaveBeenCalledWith("proj-1");
  });
});
