import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockInvoke = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: mockInvoke } },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import { useCreateRetainer, type CreateRetainerInput } from "./useCreateRetainer";

const input: CreateRetainerInput = {
  client_id: "client-1",
  clickup_list_id: "list-1",
  name: "Acme retainer",
  retainer_hours_target: 40,
  retainer_monthly_fee_cents: 5000000,
  recurrence_start: "2026-06-01",
  services: [
    {
      service_id: "svc-1",
      cadence: "weekly",
      occurrences_per_month: 4,
      points_per_occurrence: 2,
      default_assignees: ["tm-1"],
      is_live_eligible: true,
    },
  ],
};

let invalidateSpy: ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidateSpy = vi.fn();
  qc.invalidateQueries = invalidateSpy;
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useCreateRetainer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invokes create-retainer with the exact body shape", async () => {
    mockInvoke.mockResolvedValue({ data: { project_id: "proj-1" }, error: null });
    const { result } = renderHook(() => useCreateRetainer(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    expect(mockInvoke).toHaveBeenCalledWith("create-retainer", { body: input });
  });

  it("returns the created project_id and provision_warning", async () => {
    mockInvoke.mockResolvedValue({
      data: { project_id: "proj-1", provision_warning: "retry needed" },
      error: null,
    });
    const { result } = renderHook(() => useCreateRetainer(), { wrapper });
    let returned: { project_id: string; provision_warning?: string } | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync(input);
    });
    expect(returned).toEqual({ project_id: "proj-1", provision_warning: "retry needed" });
  });

  it("invalidates projects, retainers and pulseRetainerBurn on success", async () => {
    mockInvoke.mockResolvedValue({ data: { project_id: "proj-1" }, error: null });
    const { result } = renderHook(() => useCreateRetainer(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["projects"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["retainers"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["pulseRetainerBurn"] });
  });

  it("navigates to the new project on success", async () => {
    mockInvoke.mockResolvedValue({ data: { project_id: "proj-1" }, error: null });
    const { result } = renderHook(() => useCreateRetainer(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    expect(mockNavigate).toHaveBeenCalledWith("/projects/proj-1");
  });

  it("throws when the invoke returns a transport error", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error("network down") });
    const { result } = renderHook(() => useCreateRetainer(), { wrapper });
    await expect(
      act(async () => {
        await result.current.mutateAsync(input);
      }),
    ).rejects.toThrow("network down");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("throws when the response body carries an error", async () => {
    mockInvoke.mockResolvedValue({ data: { error: "client not found" }, error: null });
    const { result } = renderHook(() => useCreateRetainer(), { wrapper });
    await expect(
      act(async () => {
        await result.current.mutateAsync(input);
      }),
    ).rejects.toThrow("client not found");
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
