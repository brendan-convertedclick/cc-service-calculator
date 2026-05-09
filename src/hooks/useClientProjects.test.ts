import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    }),
  },
}));

import { useClientProjects } from "./useClientProjects";
import { supabase } from "@/lib/supabase";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useClientProjects", () => {
  it("returns clients with nested projects", async () => {
    const mockData = [
      {
        id: "client-1",
        name: "ACME",
        primary_domain: "acme.co.za",
        created_at: "2026-01-01T00:00:00Z",
        projects: [
          {
            id: "proj-1",
            name: "Website Rebuild",
            project_code: "ACME-001",
            engagement_type: "fixed",
            scope_status: "on_track",
            client_id: "client-1",
            quote_id: "quote-1",
            started_at: "2026-03-01T00:00:00Z",
            created_at: "2026-03-01T00:00:00Z",
          },
        ],
      },
    ];

    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValueOnce({
            order: vi.fn().mockResolvedValue({ data: mockData, error: null }),
          }),
        }),
      }),
    } as any);

    const { result } = renderHook(() => useClientProjects(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].name).toBe("ACME");
    expect(result.current.data![0].projects).toHaveLength(1);
    expect(result.current.data![0].projects[0].engagement_type).toBe("fixed");
  });

  it("returns empty array when no clients", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValueOnce({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    } as any);

    const { result } = renderHook(() => useClientProjects(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("throws on Supabase error", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValueOnce({
            order: vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } }),
          }),
        }),
      }),
    } as any);

    const { result } = renderHook(() => useClientProjects(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
