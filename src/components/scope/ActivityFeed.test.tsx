import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityFeed } from "./ActivityFeed";
import type { ActivityEvent } from "@/hooks/useProjectActivity";

const events: ActivityEvent[] = [
  {
    type: "brief",
    timestamp: "2026-05-09T10:00:00Z",
    id: "b1",
    brief: {
      id: "b1",
      raw_subject: "Can we add a blog?",
      intent_type: "project_thread",
      sender_email: "sarah@acme.co.za",
      status: "open",
      created_at: "2026-05-09T10:00:00Z",
    } as any,
  },
  {
    type: "quote",
    timestamp: "2026-05-07T10:00:00Z",
    id: "q1",
    quote: {
      id: "q1",
      status: "sent",
      total_cents: 4850000,
      sent_at: "2026-05-07T10:00:00Z",
    } as any,
  },
  {
    type: "actuals_update",
    timestamp: "2026-05-06T10:00:00Z",
    id: "act-1",
    departmentName: "Development",
    totalHours: 12,
  },
];

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("ActivityFeed", () => {
  it("renders all events", () => {
    render(<ActivityFeed events={events} isLoading={false} />, { wrapper: Wrapper });
    expect(screen.getByText("Can we add a blog?")).toBeInTheDocument();
    expect(screen.getByText(/48.500|48,500|48 500/)).toBeInTheDocument();
    expect(screen.getByText(/Development/)).toBeInTheDocument();
  });

  it("renders intent badge for brief events", () => {
    render(<ActivityFeed events={events} isLoading={false} />, { wrapper: Wrapper });
    expect(screen.getByText("Project thread")).toBeInTheDocument();
  });

  it("shows loading skeleton when isLoading", () => {
    render(<ActivityFeed events={[]} isLoading={true} />, { wrapper: Wrapper });
    expect(screen.getByTestId("activity-loading")).toBeInTheDocument();
  });

  it("shows empty state when no events and not loading", () => {
    render(<ActivityFeed events={[]} isLoading={false} />, { wrapper: Wrapper });
    expect(screen.getByText(/No activity yet/)).toBeInTheDocument();
  });

  it("renders Add brief button when onAddBrief is provided", () => {
    render(
      <ActivityFeed events={events} isLoading={false} onAddBrief={() => {}} />,
      { wrapper: Wrapper }
    );
    expect(screen.getByText(/\+ Add brief to project/)).toBeInTheDocument();
  });
});
