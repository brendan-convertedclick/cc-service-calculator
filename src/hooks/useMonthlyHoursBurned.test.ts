import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  },
}));

import { useMonthlyHoursBurned } from "./useMonthlyHoursBurned";
import { supabase } from "@/lib/supabase";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useMonthlyHoursBurned", () => {
  it("returns null when no actuals", async () => {
    const { result } = renderHook(() => useMonthlyHoursBurned(), { wrapper });
    // Initially null (not yet loaded)
    await waitFor(() => expect(result.current).toBe(0));
  });

  it("sums actual_hours across actuals", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        gte: vi.fn().mockResolvedValue({
          data: [
            { actual_hours: 10.5, recorded_at: "2026-05-02T00:00:00Z" },
            { actual_hours: 8.0, recorded_at: "2026-05-03T00:00:00Z" },
            { actual_hours: 3.5, recorded_at: "2026-05-04T00:00:00Z" },
          ],
          error: null,
        }),
      }),
    } as any);

    const { result } = renderHook(() => useMonthlyHoursBurned(), { wrapper });
    await waitFor(() => expect(result.current).toBe(22));
  });

  it("rounds to 1 decimal place", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        gte: vi.fn().mockResolvedValue({
          data: [
            { actual_hours: 10.333, recorded_at: "2026-05-02T00:00:00Z" },
          ],
          error: null,
        }),
      }),
    } as any);

    const { result } = renderHook(() => useMonthlyHoursBurned(), { wrapper });
    await waitFor(() => expect(result.current).toBe(10.3));
  });
});
