import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import React from "react";

vi.mock("@/hooks/useInboxBriefs", () => ({
  useInboxBriefs: () => ({
    data: [
      { id: "b1", raw_subject: "New request from ACME", sender_email: "a@acme.co.za", created_at: "2026-05-09T10:00:00Z" },
      { id: "b2", raw_subject: "Question about pricing", sender_email: "b@pebble.io", created_at: "2026-05-08T10:00:00Z" },
    ],
    isLoading: false,
  }),
}));

import { InboxNavSection } from "./InboxNavSection";

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("InboxNavSection", () => {
  it("shows count badge with number of inbox briefs", () => {
    render(<InboxNavSection onSelectBrief={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders inbox brief subjects", () => {
    render(<InboxNavSection onSelectBrief={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText("New request from ACME")).toBeInTheDocument();
  });

  it("calls onSelectBrief with the clicked brief", () => {
    const onSelect = vi.fn();
    render(<InboxNavSection onSelectBrief={onSelect} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText("New request from ACME"));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "b1", raw_subject: "New request from ACME" })
    );
  });
});
