import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ClientNavSection } from "./ClientNavSection";

const client = {
  id: "client-1",
  name: "ACME",
  primary_domain: "acme.co.za",
  created_at: "2026-01-01T00:00:00Z",
  projects: [
    {
      id: "proj-1",
      name: "Website Rebuild",
      project_code: "ACME-001",
      engagement_type: "fixed",
      scope_status: "on_track",
      client_id: "client-1",
      quote_id: null,
      started_at: "2026-03-01T00:00:00Z",
      created_at: "2026-03-01T00:00:00Z",
    },
  ],
} as any;

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("ClientNavSection", () => {
  it("renders client name as section header", () => {
    render(<ClientNavSection client={client} />, { wrapper: Wrapper });
    expect(screen.getByText("ACME")).toBeInTheDocument();
  });

  it("renders projects within the section", () => {
    render(<ClientNavSection client={client} />, { wrapper: Wrapper });
    expect(screen.getByText("Website Rebuild")).toBeInTheDocument();
  });

  it("collapses projects on header click", () => {
    render(<ClientNavSection client={client} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText("ACME"));
    // After collapse the project list container should have the hidden class
    const projectsContainer = screen.getByTestId("projects-list");
    expect(projectsContainer).toHaveClass("hidden");
  });
});
