import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => {
  return { supabase: { functions: { invoke: invokeMock } } };
});

import { useCreateQuickBriefTask } from "./useCreateQuickBriefTask";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useCreateQuickBriefTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invokes the edge fn with the confirmed values", async () => {
    invokeMock.mockResolvedValue({
      data: { clickup_task_id: "t1", clickup_task_url: "u" },
      error: null,
    });
    const { result } = renderHook(() => useCreateQuickBriefTask(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        brief_id: "b1",
        task_name: "Do it",
        assignee_member_id: null,
        sprint_points: 2,
        work_stream: "Reporting",
        due_date: null,
      });
    });

    expect(invokeMock).toHaveBeenCalledWith("create-quick-brief-task", {
      body: {
        brief_id: "b1",
        task_name: "Do it",
        assignee_member_id: null,
        sprint_points: 2,
        work_stream: "Reporting",
        due_date: null,
      },
    });
  });

  it("returns the clickup task result on success", async () => {
    invokeMock.mockResolvedValue({
      data: { clickup_task_id: "t1", clickup_task_url: "u" },
      error: null,
    });
    const { result } = renderHook(() => useCreateQuickBriefTask(), { wrapper });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync({
        brief_id: "b1",
        task_name: "Do it",
        assignee_member_id: null,
        sprint_points: 2,
        work_stream: "Reporting",
        due_date: null,
      });
    });

    expect(returned).toEqual({ clickup_task_id: "t1", clickup_task_url: "u" });
  });

  it("rejects when the edge fn returns a transport error", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { message: "network blew up" },
    });
    const { result } = renderHook(() => useCreateQuickBriefTask(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          brief_id: "b1",
          task_name: "Do it",
          assignee_member_id: null,
          sprint_points: 2,
          work_stream: "Reporting",
          due_date: null,
        });
      })
    ).rejects.toThrow("network blew up");
  });

  it("rejects when the edge fn returns a data.error field", async () => {
    invokeMock.mockResolvedValue({
      data: { error: "sprint points must be positive" },
      error: null,
    });
    const { result } = renderHook(() => useCreateQuickBriefTask(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          brief_id: "b1",
          task_name: "Do it",
          assignee_member_id: null,
          sprint_points: 2,
          work_stream: "Reporting",
          due_date: null,
        });
      })
    ).rejects.toThrow("sprint points must be positive");
  });
});
