import { render, screen } from "@testing-library/react";
import { StatusStrip } from "./StatusStrip";
import { textAcross } from "@/test/text";
import type { Database } from "@/types/db";

type ActualRow = Database["public"]["Views"]["project_actuals_current"]["Row"];
type Quote = Database["public"]["Tables"]["quotes"]["Row"];

// Local factories with sensible defaults so new columns on these Row types
// don't have to be back-filled into every fixture literal in this file.
function actualRow(over: Partial<ActualRow> & { id: string }): ActualRow {
  return {
    project_id: null,
    dept_id: null,
    actual_hours: null,
    planned_hours: null,
    recorded_at: null,
    clickup_task_id: null,
    status_at_sync: null,
    synced_at: null,
    time_entries: null,
    cost_cents: null,
    task_name: null,
    ...over,
  };
}

function quoteRow(over: Partial<Quote> & { id: string; scope_id: string }): Quote {
  return {
    status: "draft",
    total_cents: 0,
    subtotal_cents: 0,
    version: 1,
    discount_room_pct: 0,
    margin_pct: 0,
    is_recurring: false,
    recurrence_mode: "none",
    recurrence_interval: null,
    recurrence_start: null,
    recurrence_end: null,
    sent_at: null,
    accepted_at: null,
    accepted_by: null,
    rejection_reason: null,
    sow_html: null,
    sow_pdf_url: null,
    cost_estimate_pdf_url: null,
    xero_quote_id: null,
    xero_quote_number: null,
    xero_quote_status: null,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-07T00:00:00Z",
    ...over,
  };
}

const actuals: ActualRow[] = [
  actualRow({
    id: "a1",
    project_id: "proj-1",
    dept_id: "dept-dev",
    actual_hours: 22,
    planned_hours: 60,
    recorded_at: "2026-05-06T10:00:00Z",
  }),
  actualRow({
    id: "a2",
    project_id: "proj-1",
    dept_id: "dept-design",
    actual_hours: 18,
    planned_hours: 40,
    recorded_at: "2026-05-06T10:00:00Z",
  }),
];

const quote: Quote = quoteRow({
  id: "q1",
  status: "sent",
  total_cents: 4850000,
  subtotal_cents: 4850000,
  scope_id: "scope-1",
  sent_at: "2026-05-07T10:00:00Z",
});

describe("StatusStrip", () => {
  it("renders total hours used and planned", () => {
    render(<StatusStrip actuals={actuals} briefCount={3} />);
    expect(screen.getByText(textAcross(/40h used \/ 100h planned/))).toBeInTheDocument();
  });

  it("renders brief count", () => {
    render(<StatusStrip actuals={actuals} briefCount={3} />);
    expect(screen.getByTestId("brief-count")).toHaveTextContent("3");
  });

  it("renders quote total and status when quote is provided", () => {
    render(<StatusStrip actuals={actuals} quote={quote} briefCount={3} />);
    // ZAR formatting varies by locale — check for the numeric portion
    expect(screen.getByText(/48.500|48,500|48 500/)).toBeInTheDocument();
    expect(screen.getByText("sent")).toBeInTheDocument();
  });

  it("hides quote section when no quote provided", () => {
    render(<StatusStrip actuals={actuals} briefCount={3} />);
    expect(screen.queryByText("Quote")).not.toBeInTheDocument();
  });

  it("shows green burn bar when under 70% used", () => {
    render(<StatusStrip actuals={actuals} briefCount={3} />);
    // 40h used / 100h planned = 40% — should be green
    expect(screen.getByTestId("burn-bar")).toHaveClass("bg-green-500");
  });
});
