import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => {
  return { supabase: { functions: { invoke: mockInvoke } } };
});

import { useAssignBriefToProject } from "./useAssignBriefToProject";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useAssignBriefToProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue({ data: { ok: true, moved: true, seeded: true }, error: null });
  });

  it("invokes set-brief-project with brief_id + project_id on link", async () => {
    const { result } = renderHook(() => useAssignBriefToProject(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ briefId: "brief-1", projectId: "proj-1" });
    });
    expect(mockInvoke).toHaveBeenCalledWith("set-brief-project", {
      body: { brief_id: "brief-1", project_id: "proj-1" },
    });
  });

  it("sends null project_id to unlink", async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, moved: false, seeded: false }, error: null });
    const { result } = renderHook(() => useAssignBriefToProject(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ briefId: "brief-1", projectId: null, previousProjectId: "old-proj-1" });
    });
    expect(mockInvoke).toHaveBeenCalledWith("set-brief-project", {
      body: { brief_id: "brief-1", project_id: null },
    });
  });

  it("throws on transport error", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error("boom") });
    const { result } = renderHook(() => useAssignBriefToProject(), { wrapper });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ briefId: "brief-1", projectId: "proj-1" });
      }),
    ).rejects.toThrow("boom");
  });

  it("throws on data.error", async () => {
    mockInvoke.mockResolvedValue({ data: { error: "Project not found" }, error: null });
    const { result } = renderHook(() => useAssignBriefToProject(), { wrapper });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ briefId: "brief-1", projectId: "proj-1" });
      }),
    ).rejects.toThrow("Project not found");
  });
});
