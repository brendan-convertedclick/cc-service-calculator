import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mocks = vi.hoisted(() => {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const pendingDeleteEmailEq = vi.fn().mockResolvedValue({ error: null });
  const pendingDeleteClientEq = vi.fn().mockReturnValue({ eq: pendingDeleteEmailEq });
  const pendingDelete = vi.fn().mockReturnValue({ eq: pendingDeleteClientEq });
  const briefUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const briefUpdate = vi.fn().mockReturnValue({ eq: briefUpdateEq });
  return { upsert, pendingDelete, pendingDeleteClientEq, pendingDeleteEmailEq, briefUpdate, briefUpdateEq };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "client_sender_rules") return { upsert: mocks.upsert };
      if (table === "pending_senders") return { delete: mocks.pendingDelete };
      if (table === "briefs") return { update: mocks.briefUpdate };
      throw new Error(`unexpected table ${table}`);
    }),
  },
}));

import { useBlacklistSender } from "./useSenderRules";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useBlacklistSender", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upserts a block rule, clears pending sender, and archives the brief", async () => {
    const { result } = renderHook(() => useBlacklistSender(), { wrapper });

    result.current.mutate({
      briefId: "brief-1",
      clientId: "client-1",
      senderEmail: "GregH@TheKingsCollege.co.za",
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.upsert).toHaveBeenCalledWith(
      { client_id: "client-1", pattern: "gregh@thekingscollege.co.za", mode: "block" },
      { onConflict: "client_id,pattern" },
    );
    expect(mocks.pendingDeleteClientEq).toHaveBeenCalledWith("client_id", "client-1");
    expect(mocks.pendingDeleteEmailEq).toHaveBeenCalledWith("email", "gregh@thekingscollege.co.za");
    expect(mocks.briefUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "archived" }),
    );
    expect(mocks.briefUpdateEq).toHaveBeenCalledWith("id", "brief-1");
  });

  it("surfaces the error and does not archive when the rule upsert fails", async () => {
    mocks.upsert.mockResolvedValueOnce({ error: new Error("nope") });
    const { result } = renderHook(() => useBlacklistSender(), { wrapper });

    result.current.mutate({
      briefId: "brief-1",
      clientId: "client-1",
      senderEmail: "gregh@thekingscollege.co.za",
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mocks.briefUpdate).not.toHaveBeenCalled();
  });
});
