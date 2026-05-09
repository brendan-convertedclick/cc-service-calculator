import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockBrief = {
  id: "brief-1",
  raw_subject: "Website scope",
  intent_type: "new_brief",
  sender_email: "client@acme.co.za",
  created_at: "2026-05-01T10:00:00Z",
  parent_project_id: "proj-1",
  status: "open",
};

const mockActual = {
  id: "actual-1",
  project_id: "proj-1",
  dept_id: "dept-1",
  actual_hours: 10,
  planned_hours: 20,
  recorded_at: "2026-05-06T10:00:00Z",
  clickup_task_id: null,
  status_at_sync: null,
  synced_at: null,
  time_entries: null,
};

const mockQuote = {
  id: "quote-1",
  status: "sent",
  total_cents: 4850000,
  sent_at: "2026-05-07T10:00:00Z",
  scope_id: "scope-1",
};

vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

import { useProjectActivity } from "./useProjectActivity";
import { supabase } from "@/lib/supabase";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

function mockFrom(table: string) {
  const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
  if (table === "briefs") chain.eq = vi.fn().mockResolvedValue({ data: [mockBrief], error: null });
  if (table === "project_actuals_current") chain.eq = vi.fn().mockResolvedValue({ data: [mockActual], error: null });
  if (table === "quotes") chain.eq = vi.fn().mockResolvedValue({ data: [mockQuote], error: null });
  return chain;
}

describe("useProjectActivity", () => {
  it("returns merged sorted activity events for a project", async () => {
    vi.mocked(supabase.from).mockImplementation((t: string) => mockFrom(t) as any);

    const { result } = renderHook(() => useProjectActivity("proj-1", "quote-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const events = result.current.data!;
    expect(events.length).toBeGreaterThanOrEqual(3);
    // Events sorted newest first
    const timestamps = events.map((e) => e.timestamp);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b.localeCompare(a)));
  });

  it("returns empty array when projectId is undefined", async () => {
    const { result } = renderHook(() => useProjectActivity(undefined, undefined), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
