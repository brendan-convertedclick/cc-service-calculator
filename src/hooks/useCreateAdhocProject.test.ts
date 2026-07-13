import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => {
  return { supabase: { functions: { invoke: invokeMock } } };
});

import { useCreateAdhocProject } from "./useCreateAdhocProject";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

const okResult = {
  project_id: "p1",
  clickup_list_id: "l1",
  clickup_parent_task_id: "pt1",
  created_task_ids: ["t1", "t2"],
};

describe("useCreateAdhocProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the args verbatim to the edge function", async () => {
    invokeMock.mockResolvedValue({ data: okResult, error: null });
    const { result } = renderHook(() => useCreateAdhocProject(), { wrapper });

    const args = {
      client_id: "c1",
      project_name: "Website refresh",
      tasks: [
        {
          task_name: "Hero banner",
          assignee_member_id: "m1",
          sprint_points: 3,
          work_stream: "Creative",
          status: "in progress",
          due_date: "2026-08-01",
        },
        {
          task_name: "Copy pass",
          assignee_member_id: null,
          sprint_points: 1,
          work_stream: "Content",
          due_date: null,
        },
      ],
    };

    await act(async () => {
      await result.current.mutateAsync(args);
    });

    expect(invokeMock).toHaveBeenCalledWith("create-adhoc-project", { body: args });
  });

  it("returns the created project result on success", async () => {
    invokeMock.mockResolvedValue({ data: okResult, error: null });
    const { result } = renderHook(() => useCreateAdhocProject(), { wrapper });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync({
        client_id: "c1",
        project_name: "P",
        tasks: [
          { task_name: "A", assignee_member_id: null, sprint_points: 1, work_stream: "Creative", due_date: null },
        ],
      });
    });

    expect(returned).toEqual(okResult);
  });

  it("rejects when the edge fn returns a transport error", async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: "network blew up" } });
    const { result } = renderHook(() => useCreateAdhocProject(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          client_id: "c1",
          project_name: "P",
          tasks: [
            { task_name: "A", assignee_member_id: null, sprint_points: 1, work_stream: "Creative", due_date: null },
          ],
        });
      })
    ).rejects.toThrow("network blew up");
  });

  it("rejects when the edge fn returns a data.error field", async () => {
    invokeMock.mockResolvedValue({ data: { error: "client has no folder" }, error: null });
    const { result } = renderHook(() => useCreateAdhocProject(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          client_id: "c1",
          project_name: "P",
          tasks: [
            { task_name: "A", assignee_member_id: null, sprint_points: 1, work_stream: "Creative", due_date: null },
          ],
        });
      })
    ).rejects.toThrow("client has no folder");
  });
});
