import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const inserted = vi.hoisted(() => [] as Record<string, unknown>[]);
const edgeRows = vi.hoisted(() => ({ value: [] as Record<string, unknown>[] }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(table: string) {
      if (table === "system_edges") {
        return {
          select: () => ({ or: async () => ({ data: edgeRows.value, error: null }) }),
          insert: async (row: Record<string, unknown>) => {
            inserted.push(row);
            return { error: null };
          },
        };
      }
      return { delete: () => ({ eq: async () => ({ error: null }) }) };
    },
  },
}));

import { useDeleteStep } from "./useProcessSteps";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

const edge = (over: Record<string, unknown>) => ({
  id: "e",
  system_id: "sys",
  label: null,
  source_handle: null,
  ...over,
});

async function remove(id: string) {
  const { result } = renderHook(() => useDeleteStep(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ id });
  });
}

describe("useDeleteStep", () => {
  beforeEach(() => {
    inserted.length = 0;
    edgeRows.value = [];
  });

  it("joins the tasks either side of the one it deletes", async () => {
    edgeRows.value = [
      edge({ id: "e1", source_step_id: "a", target_step_id: "b" }),
      edge({ id: "e2", source_step_id: "b", target_step_id: "c" }),
    ];
    await remove("b");
    expect(inserted).toEqual([
      { system_id: "sys", source_step_id: "a", target_step_id: "c" },
    ]);
  });

  it("leaves the ends of a run alone", async () => {
    edgeRows.value = [edge({ id: "e1", source_step_id: "a", target_step_id: "b" })];
    await remove("b");
    expect(inserted).toEqual([]);
  });

  it("does not bridge a decision's branches", async () => {
    edgeRows.value = [
      edge({ id: "e1", source_step_id: "a", target_step_id: "b" }),
      edge({ id: "e2", source_step_id: "b", target_step_id: "c", source_handle: "yes" }),
      edge({ id: "e3", source_step_id: "b", target_step_id: "d", source_handle: "no" }),
    ];
    await remove("b");
    expect(inserted).toEqual([]);
  });

  it("never bridges a run back onto itself", async () => {
    edgeRows.value = [
      edge({ id: "e1", source_step_id: "a", target_step_id: "b" }),
      edge({ id: "e2", source_step_id: "b", target_step_id: "a" }),
    ];
    await remove("b");
    expect(inserted).toEqual([]);
  });
});
