import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { pickPrimary } from "./BriefHandlingButtons";
import { QuickBriefSheet } from "./QuickBriefSheet";

describe("pickPrimary", () => {
  it("quick_task → brief_as_is", () => expect(pickPrimary("quick_task")).toBe("brief_as_is"));
  it("quick_response → draft_reply", () => expect(pickPrimary("quick_response")).toBe("draft_reply"));
  it("general_query → draft_reply", () => expect(pickPrimary("general_query")).toBe("draft_reply"));
  it("new_brief → scope_it", () => expect(pickPrimary("new_brief")).toBe("scope_it"));
  it("null → scope_it", () => expect(pickPrimary(null)).toBe("scope_it"));
});

function withClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe("QuickBriefSheet guard", () => {
  it("disables Create and shows the assign-client message when the brief has no client_id", () => {
    render(
      withClient(
        <QuickBriefSheet
          open
          onOpenChange={() => {}}
          brief={{
            id: "b1",
            client_id: null,
            intent_type: "quick_task",
            raw_subject: "Fix the footer link",
            quick_task_suggestion: null,
          }}
        />,
      ),
    );
    expect(screen.getByText("Assign a client first.")).toBeInTheDocument();
    const create = screen.getByRole("button", { name: /create task/i });
    expect(create).toBeDisabled();
  });
});
