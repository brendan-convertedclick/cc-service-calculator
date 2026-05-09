import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { vi } from "vitest";

vi.mock("@/hooks/useClientProjects", () => ({
  useClientProjects: () => ({
    data: [
      {
        id: "client-1",
        name: "ACME",
        projects: [
          {
            id: "proj-1",
            name: "Website Rebuild",
            engagement_type: "fixed",
            scope_status: "on_track",
            client_id: "client-1",
            quote_id: "quote-1",
          },
        ],
      },
    ],
  }),
}));

vi.mock("@/hooks/useProjects", () => ({
  useProject: () => ({
    data: {
      project: {
        id: "proj-1",
        name: "Website Rebuild",
        quote_id: "quote-1",
        client_id: "client-1",
        scope_status: "on_track",
        engagement_type: "fixed",
      },
      actuals: [],
    },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useProjectActivity", () => ({
  useProjectActivity: () => ({
    data: [],
    isLoading: false,
    isSuccess: true,
  }),
}));

vi.mock("@/components/scope/ActivityFeed", () => ({
  ActivityFeed: () => <div data-testid="activity-feed-mock" />,
}));

vi.mock("@/components/scope/StatusStrip", () => ({
  StatusStrip: () => <div data-testid="status-strip-mock" />,
}));

import { ProjectScopeView } from "./ProjectScopeView";

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/clients/client-1/projects/proj-1"]}>
        <Routes>
          <Route path="/clients/:clientId/projects/:projectId" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ProjectScopeView", () => {
  it("renders the project name in the header", () => {
    render(<ProjectScopeView />, { wrapper: Wrapper });
    expect(screen.getByText("Website Rebuild")).toBeInTheDocument();
  });

  it("renders the client name as a breadcrumb link", () => {
    render(<ProjectScopeView />, { wrapper: Wrapper });
    expect(screen.getByRole("link", { name: "ACME" })).toBeInTheDocument();
  });

  it("renders Inbox tab selected by default", () => {
    render(<ProjectScopeView />, { wrapper: Wrapper });
    expect(screen.getByRole("tab", { name: /Inbox/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("shows engagement type chip", () => {
    render(<ProjectScopeView />, { wrapper: Wrapper });
    expect(screen.getByText("fixed")).toBeInTheDocument();
  });

  it("shows scope status chip", () => {
    render(<ProjectScopeView />, { wrapper: Wrapper });
    expect(screen.getByText("on track")).toBeInTheDocument();
  });
});
