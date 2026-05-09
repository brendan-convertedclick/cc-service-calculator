import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Mocked at module level — overridden per-test via vi.mocked()
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { useInboxFilterTree } from "./useInboxFilterTree";
import { supabase } from "@/lib/supabase";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

const BRIEFS = [
  { client_id: "c1", sender_email: "alice@acme.co.za" },
  { client_id: "c1", sender_email: "alice@acme.co.za" },
  { client_id: "c1", sender_email: "bob@acme.co.za" },
  { client_id: null,  sender_email: "unknown@example.com" },
  { client_id: null,  sender_email: null },
];
const CLIENTS = [{ id: "c1", name: "ACME Corp" }];

beforeEach(() => {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "briefs") {
      return {
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({ data: BRIEFS, error: null }),
        }),
      } as any;
    }
    if (table === "clients") {
      return {
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: CLIENTS, error: null }),
          }),
        }),
      } as any;
    }
    return {} as any;
  });
});

describe("useInboxFilterTree", () => {
  it("groups briefs into clients with contact lists", async () => {
    const { result } = renderHook(() => useInboxFilterTree(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const tree = result.current.data!;
    expect(tree.clients).toHaveLength(1);
    expect(tree.clients[0].id).toBe("c1");
    expect(tree.clients[0].name).toBe("ACME Corp");
    expect(tree.clients[0].count).toBe(3);
    expect(tree.clients[0].contacts).toHaveLength(2);

    const alice = tree.clients[0].contacts.find((c) => c.email === "alice@acme.co.za");
    expect(alice?.count).toBe(2);
    const bob = tree.clients[0].contacts.find((c) => c.email === "bob@acme.co.za");
    expect(bob?.count).toBe(1);
  });

  it("counts unassigned briefs (null client_id)", async () => {
    const { result } = renderHook(() => useInboxFilterTree(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.unassigned.count).toBe(2);
  });

  it("excludes null sender_email from contact rows but still counts in client total", async () => {
    const { result } = renderHook(() => useInboxFilterTree(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const acme = result.current.data!.clients[0];
    const nullContact = acme.contacts.find((c) => c.email === null);
    expect(nullContact).toBeUndefined();
  });
});
