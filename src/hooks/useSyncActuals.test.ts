import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: mockInvoke } },
}));

import { useSyncActuals } from "./useSyncActuals";

let invalidateSpy: ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidateSpy = vi.fn();
  qc.invalidateQueries = invalidateSpy;
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useSyncActuals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invokes with a project_id when given one", async () => {
    mockInvoke.mockResolvedValue({ data: { inserted: 1 }, error: null });
    const { result } = renderHook(() => useSyncActuals(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("proj-1");
    });
    expect(mockInvoke).toHaveBeenCalledWith("sync-clickup-actuals", { body: { project_id: "proj-1" } });
  });

  it("invokes with an empty body when no id is given (sync all)", async () => {
    mockInvoke.mockResolvedValue({ data: { inserted: 3 }, error: null });
    const { result } = renderHook(() => useSyncActuals(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(undefined);
    });
    expect(mockInvoke).toHaveBeenCalledWith("sync-clickup-actuals", { body: {} });
  });

  it("invalidates retainers and pulseRetainerBurn on success", async () => {
    mockInvoke.mockResolvedValue({ data: { inserted: 1 }, error: null });
    const { result } = renderHook(() => useSyncActuals(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("proj-1");
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["retainers"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["pulseRetainerBurn"] });
  });

  it("throws on transport error", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error("network down") });
    const { result } = renderHook(() => useSyncActuals(), { wrapper });
    await expect(
      act(async () => {
        await result.current.mutateAsync("proj-1");
      }),
    ).rejects.toThrow("network down");
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("throws when the response body carries an error", async () => {
    mockInvoke.mockResolvedValue({ data: { error: "clickup disabled" }, error: null });
    const { result } = renderHook(() => useSyncActuals(), { wrapper });
    await expect(
      act(async () => {
        await result.current.mutateAsync("proj-1");
      }),
    ).rejects.toThrow("clickup disabled");
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
