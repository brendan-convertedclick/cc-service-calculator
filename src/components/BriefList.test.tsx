import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockBlacklist = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockBriefs = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("sonner");

vi.mock("@/hooks/useBriefs", () => ({
  useBriefs: () => ({ data: mockBriefs.current, isLoading: false }),
  useUpdateBrief: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));

vi.mock("@/hooks/useClientProjects", () => ({
  useClientProjects: () => ({ data: [] }),
}));

vi.mock("@/hooks/useSenderRules", () => ({
  useBlacklistSender: () => ({ mutateAsync: mockBlacklist, isPending: false }),
}));

import { BriefList } from "./BriefList";

const baseBrief = {
  id: "brief-1",
  raw_subject: "Past paper for Maths",
  sender_email: "gregh@thekingscollege.co.za",
  client_id: "client-1",
  parent_project_id: null,
  status: "new",
  intent_type: "general_query",
  message_count: 1,
  last_message_at: "2026-06-09T10:00:00Z",
};

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function openCogMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Brief actions" }));
}

describe("BriefList blacklist action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBriefs.current = [baseBrief];
  });

  it("blacklists the sender from the cog menu", async () => {
    render(<BriefList scope="new" />, { wrapper: Wrapper });
    openCogMenu();
    fireEvent.click(screen.getByText("Blacklist sender"));
    await waitFor(() =>
      expect(mockBlacklist).toHaveBeenCalledWith({
        briefId: "brief-1",
        clientId: "client-1",
        senderEmail: "gregh@thekingscollege.co.za",
      }),
    );
  });

  it("hides the blacklist action when the brief has no client", () => {
    mockBriefs.current = [{ ...baseBrief, client_id: null }];
    render(<BriefList scope="new" />, { wrapper: Wrapper });
    openCogMenu();
    expect(screen.queryByText("Blacklist sender")).not.toBeInTheDocument();
  });

  it("hides the blacklist action when the brief has no sender email", () => {
    mockBriefs.current = [{ ...baseBrief, sender_email: null }];
    render(<BriefList scope="new" />, { wrapper: Wrapper });
    openCogMenu();
    expect(screen.queryByText("Blacklist sender")).not.toBeInTheDocument();
  });
});
