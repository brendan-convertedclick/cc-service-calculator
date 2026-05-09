import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  },
}));

import { useLastBriefActivity } from "./useLastBriefActivity";
import { supabase } from "@/lib/supabase";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useLastBriefActivity", () => {
  it("returns empty map when no briefs", async () => {
    const { result } = renderHook(() => useLastBriefActivity(), { wrapper });
    await waitFor(() => expect(result.current.size).toBe(0));
  });

  it("maps project id to most recent brief timestamp", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        not: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              { parent_project_id: "p1", created_at: "2026-05-01T00:00:00Z" },
              { parent_project_id: "p1", created_at: "2026-04-01T00:00:00Z" },
              { parent_project_id: "p2", created_at: "2026-04-15T00:00:00Z" },
            ],
            error: null,
          }),
        }),
      }),
    } as any);

    const { result } = renderHook(() => useLastBriefActivity(), { wrapper });
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get("p1")).toBe("2026-05-01T00:00:00Z");
    expect(result.current.get("p2")).toBe("2026-04-15T00:00:00Z");
  });
});
