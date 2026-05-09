import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockUpdate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => {
  const single = vi.fn().mockResolvedValue({ data: { id: "brief-1", parent_project_id: "proj-1" }, error: null });
  const select = vi.fn().mockReturnValue({ single });
  const eq = vi.fn().mockReturnValue({ select });
  mockUpdate.mockReturnValue({ eq });
  return { supabase: { from: vi.fn().mockReturnValue({ update: mockUpdate }) } };
});

import { useAssignBriefToProject } from "./useAssignBriefToProject";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useAssignBriefToProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: "brief-1", parent_project_id: "proj-1" }, error: null }),
        }),
      }),
    });
  });

  it("calls update with parent_project_id", async () => {
    const { result } = renderHook(() => useAssignBriefToProject(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ briefId: "brief-1", projectId: "proj-1" });
    });
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({ parent_project_id: "proj-1" });
  });

  it("accepts null projectId to unlink", async () => {
    const { result } = renderHook(() => useAssignBriefToProject(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ briefId: "brief-1", projectId: null });
    });
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({ parent_project_id: null });
  });

  it("accepts previousProjectId for unlink invalidation", async () => {
    const { result } = renderHook(() => useAssignBriefToProject(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        briefId: "brief-1",
        projectId: null,
        previousProjectId: "old-proj-1",
      });
    });
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({ parent_project_id: null });
  });
});
