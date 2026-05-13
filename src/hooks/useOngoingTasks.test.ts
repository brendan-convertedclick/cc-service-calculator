import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        is: vi.fn(() => ({
          order: vi.fn(() =>
            Promise.resolve({
              data: [
                {
                  id: "c1",
                  label_key: "standup",
                  label: "Standup",
                  display_order: 10,
                  archived_at: null,
                },
              ],
              error: null,
            }),
          ),
        })),
      })),
    })),
  },
}));

import { useTimeCategories } from "./useOngoingTasks";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useTimeCategories", () => {
  it("returns active categories in display order", async () => {
    const { result } = renderHook(() => useTimeCategories(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.[0]?.label).toBe("Standup");
  });
});
