import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectNavRow } from "./ProjectNavRow";

const proj = {
  id: "proj-1",
  name: "Website Rebuild",
  project_code: "ACME-001",
  engagement_type: "fixed",
  scope_status: "on_track",
  client_id: "client-1",
  quote_id: "quote-1",
  started_at: "2026-03-01T00:00:00Z",
  created_at: "2026-03-01T00:00:00Z",
} as any;

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("ProjectNavRow", () => {
  it("renders project name", () => {
    render(<ProjectNavRow project={proj} clientId="client-1" />, { wrapper: Wrapper });
    expect(screen.getByText("Website Rebuild")).toBeInTheDocument();
  });

  it("renders engagement type chip", () => {
    render(<ProjectNavRow project={proj} clientId="client-1" />, { wrapper: Wrapper });
    expect(screen.getByText("fixed")).toBeInTheDocument();
  });

  it("links to the project scope view", () => {
    render(<ProjectNavRow project={proj} clientId="client-1" />, { wrapper: Wrapper });
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/clients/client-1/projects/proj-1");
  });

  it("shows amber dot for needs_attention status", () => {
    render(
      <ProjectNavRow project={{ ...proj, scope_status: "needs_attention" }} clientId="client-1" />,
      { wrapper: Wrapper }
    );
    expect(screen.getByTestId("status-dot")).toHaveClass("bg-amber-400");
  });

  it("applies active styles when URL matches the project path", () => {
    render(
      <MemoryRouter initialEntries={["/clients/client-1/projects/proj-1"]}>
        <ProjectNavRow project={proj} clientId="client-1" />
      </MemoryRouter>
    );
    const link = screen.getByRole("link");
    expect(link).toHaveClass("bg-m-primary-container");
  });
});
