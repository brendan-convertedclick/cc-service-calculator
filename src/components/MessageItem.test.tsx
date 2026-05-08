import { render, screen } from "@testing-library/react";
import { MessageItem } from "./MessageItem";
import type { BriefMessage } from "@/hooks/useBriefMessages";

vi.mock("dompurify", () => ({
  default: {
    sanitize: (html: string) => html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ""),
  },
}));

const base: BriefMessage = {
  id: "msg-1",
  brief_id: "brief-1",
  gmail_message_id: "gm-1",
  direction: "inbound",
  from_email: "client@example.com",
  from_name: "Alice",
  to_emails: ["me@convertedclick.co.za"],
  cc_emails: [],
  subject: "Hello",
  body_text: "Plain body",
  body_html: null,
  attachments: [],
  sent_at: "2026-05-01T10:00:00Z",
  relayed_by: null,
  created_at: "2026-05-01T10:00:00Z",
};

describe("MessageItem", () => {
  it("renders inbound sender and text body", () => {
    render(<MessageItem message={base} />);
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText("Plain body")).toBeInTheDocument();
  });

  it("renders outbound aligned right", () => {
    render(<MessageItem message={{ ...base, direction: "outbound", relayed_by: "brendan@convertedclick.co.za" }} />);
    expect(screen.getByText(/brendan@convertedclick\.co\.za/)).toBeInTheDocument();
  });

  it("renders note variant with full-width style", () => {
    render(
      <MessageItem
        message={{
          ...base,
          direction: "note",
          gmail_message_id: "note-abc",
          body_text: "Internal note content",
          relayed_by: "brendan@convertedclick.co.za",
        }}
      />,
    );
    expect(screen.getByText("Internal note content")).toBeInTheDocument();
    expect(screen.getByText(/Internal note/)).toBeInTheDocument();
  });

  it("strips XSS from HTML body", () => {
    render(
      <MessageItem
        message={{ ...base, body_html: '<p>Safe</p><script>alert("xss")</script>', body_text: null }}
      />,
    );
    expect(screen.queryByText(/alert/)).not.toBeInTheDocument();
    expect(screen.getByText("Safe")).toBeInTheDocument();
  });
});
