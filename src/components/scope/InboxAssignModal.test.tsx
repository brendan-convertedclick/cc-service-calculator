import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { vi } from "vitest";

const mockMutateAsync = vi.fn().mockResolvedValue({});

vi.mock("sonner");

vi.mock("@/hooks/useAssignBriefToProject", () => ({
  useAssignBriefToProject: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

vi.mock("@/hooks/useClientProjects", () => ({
  useClientProjects: () => ({
    data: [
      {
        id: "client-1",
        name: "ACME",
        projects: [
          { id: "proj-1", name: "Website Rebuild", engagement_type: "fixed", scope_status: "on_track", client_id: "client-1" },
        ],
      },
    ],
  }),
}));

import { InboxAssignModal } from "./InboxAssignModal";
import { toast } from "sonner";

const mockToastSuccess = toast.success as any;

const brief = {
  id: "brief-1",
  raw_subject: "Can we add a blog?",
  sender_email: "sarah@acme.co.za",
  intent_type: "project_thread",
  created_at: "2026-05-09T10:00:00Z",
} as any;

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("InboxAssignModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders brief subject in the header", () => {
    render(<InboxAssignModal brief={brief} open onClose={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText("Can we add a blog?")).toBeInTheDocument();
  });

  it("renders intent type badge", () => {
    render(<InboxAssignModal brief={brief} open onClose={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText("Project thread")).toBeInTheDocument();
  });

  it("lists available projects", () => {
    render(<InboxAssignModal brief={brief} open onClose={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText(/ACME — Website Rebuild/)).toBeInTheDocument();
  });

  it("calls mutateAsync with selected project on assign", async () => {
    const onClose = vi.fn();
    render(<InboxAssignModal brief={brief} open onClose={onClose} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText(/ACME — Website Rebuild/));
    fireEvent.click(screen.getByRole("button", { name: /Assign to project/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        briefId: "brief-1",
        projectId: "proj-1",
      })
    );
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("Assign button is disabled until a project is selected", () => {
    render(<InboxAssignModal brief={brief} open onClose={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByRole("button", { name: /Assign to project/i })).toBeDisabled();
  });
});
