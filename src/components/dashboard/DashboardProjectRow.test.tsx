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

  it("shows tertiary icon for on_track", () => {
    render(<DashboardProjectRow {...baseProps} scopeStatus="on_track" />);
    expect(screen.getByTestId("status-dot")).toHaveClass("text-m-tertiary");
  });

  it("shows amber icon for needs_attention", () => {
    render(<DashboardProjectRow {...baseProps} scopeStatus="needs_attention" />);
    expect(screen.getByTestId("status-dot")).toHaveClass("text-amber-500");
  });

  it("shows error icon for overdue", () => {
    render(<DashboardProjectRow {...baseProps} scopeStatus="overdue" />);
    expect(screen.getByTestId("status-dot")).toHaveClass("text-m-error");
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

  it("applies opacity and no hover when isCompleted=true", () => {
    render(<DashboardProjectRow {...baseProps} isCompleted />);
    const wrapper = screen.getByRole("button", { name: /Google Ads Q2/i }).closest("div");
    expect(wrapper).toHaveClass("opacity-60");
  });
});
