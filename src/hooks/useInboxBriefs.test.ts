import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [{ id: "b1", raw_subject: "Inbox item", parent_project_id: null, created_at: "2026-05-09T10:00:00Z" }],
            error: null,
          }),
        }),
      }),
    }),
  },
}));

import { useInboxBriefs } from "./useInboxBriefs";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useInboxBriefs", () => {
  it("returns briefs where parent_project_id is null", async () => {
    const { result } = renderHook(() => useInboxBriefs(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].id).toBe("b1");
  });
});
