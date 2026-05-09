import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { RecommendedBanner } from "./RecommendedBanner";

const baseProject = {
  id: "proj-1",
  scope_status: "on_track",
  quote_id: "quote-1",
} as any;

const baseActuals = [
  { actual_hours: 20, planned_hours: 100, dept_id: "d1", id: "a1" } as any,
];

const baseEvents: any[] = [];

function wrap(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("RecommendedBanner", () => {
  it("renders nothing when no conditions are met", () => {
    const { container } = wrap(
      <RecommendedBanner
        project={baseProject}
        actuals={baseActuals}
        events={baseEvents}
        onDismiss={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows budget warning when burn >= 80%", () => {
    const actuals = [{ actual_hours: 85, planned_hours: 100, dept_id: "d1", id: "a1" } as any];
    wrap(<RecommendedBanner project={baseProject} actuals={actuals} events={baseEvents} onDismiss={vi.fn()} />);
    expect(screen.getByText(/Budget at 85%/)).toBeInTheDocument();
  });

  it("shows no-quote warning when quote_id is null", () => {
    wrap(
      <RecommendedBanner
        project={{ ...baseProject, quote_id: null }}
        actuals={baseActuals}
        events={baseEvents}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText(/No quote linked/)).toBeInTheDocument();
  });

  it("shows overdue warning when scope_status is overdue", () => {
    wrap(
      <RecommendedBanner
        project={{ ...baseProject, scope_status: "overdue" }}
        actuals={baseActuals}
        events={baseEvents}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText(/Project is overdue/)).toBeInTheDocument();
  });

  it("shows quote-not-accepted when latest quote event is sent", () => {
    const events = [{ type: "quote", id: "q1", timestamp: "2026-05-01", quote: { id: "q1", status: "sent", total_cents: 5000 } }] as any;
    wrap(<RecommendedBanner project={baseProject} actuals={baseActuals} events={events} onDismiss={vi.fn()} />);
    expect(screen.getByText(/Quote not yet accepted/)).toBeInTheDocument();
  });

  it("calls onDismiss when × button is clicked", () => {
    const onDismiss = vi.fn();
    const actuals = [{ actual_hours: 85, planned_hours: 100, dept_id: "d1", id: "a1" } as any];
    wrap(<RecommendedBanner project={baseProject} actuals={actuals} events={baseEvents} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
