import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

vi.mock("@/hooks/useBriefMessages", () => ({
  useBriefMessages: () => ({
    data: [
      {
        id: "msg-1",
        brief_id: "brief-1",
        gmail_message_id: "gm-1",
        direction: "inbound",
        from_email: "client@example.com",
        from_name: "Alice",
        to_emails: [],
        cc_emails: [],
        subject: "Hello",
        body_text: "Message body",
        body_html: null,
        attachments: [],
        sent_at: "2026-05-01T10:00:00Z",
        relayed_by: null,
        created_at: "2026-05-01T10:00:00Z",
      },
    ],
    isLoading: false,
  }),
}));

const mockMutateAsync = vi.fn().mockResolvedValue(undefined);

vi.mock("@/hooks/useBriefActions", () => ({
  useAddInternalNote: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
  useBriefDownstream: () => ({ data: { kind: "none" } }),
  useUpdateBriefAssignee: () => ({ mutateAsync: vi.fn() }),
  useRollbackBriefStage: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useTeam", () => ({
  useTeam: () => ({ data: [] }),
}));

vi.mock("@/hooks/useAssignBriefToProject", () => ({
  useAssignBriefToProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/components/scope/InboxAssignModal", () => ({
  InboxAssignModal: () => null,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { email: "brendan@convertedclick.co.za" } }),
  useCurrentUserId: () => "user-1",
}));

import { BriefConversation } from "./BriefConversation";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

const brief: Brief = {
  id: "brief-1",
  raw_subject: "Test brief",
  client_id: null,
  assignee_id: null,
  status: "new",
  sender_email: "client@example.com",
  raw_body: "",
  raw_attachments: null,
  received_at: "2026-05-01T10:00:00Z",
  gmail_thread_id: null,
  gmail_thread_id_unique: null,
  last_message_at: null,
  message_count: 0,
  source: "gmail_relay",
  triaged_by: null,
  triaged_at: null,
  rejection_reason: null,
  draft_reply: null,
  intent_type: null,
  parent_project_id: null,
  quick_task_suggestion: null,
  clickup_task_id: null,
  clickup_task_url: null,
  updated_at: "2026-05-01T10:00:00Z",
  created_at: "2026-05-01T10:00:00Z",
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("BriefConversation", () => {
  it("renders the brief subject in the header", () => {
    render(<BriefConversation brief={brief} open onClose={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText("Test brief")).toBeInTheDocument();
  });

  it("renders a message from the timeline", () => {
    render(<BriefConversation brief={brief} open onClose={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText("Message body")).toBeInTheDocument();
  });

  it("submits an internal note", async () => {
    render(<BriefConversation brief={brief} open onClose={() => {}} />, { wrapper: Wrapper });

    fireEvent.change(screen.getByPlaceholderText(/add an internal note/i), {
      target: { value: "My note" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ body: "My note" }),
      ),
    );
  });
});
