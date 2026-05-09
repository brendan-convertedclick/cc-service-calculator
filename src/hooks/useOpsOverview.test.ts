import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOpsOverview } from "./useOpsOverview";
import type { ClientWithProjects } from "./useClientProjects";

const makeProject = (overrides: Partial<{
  id: string; name: string; status: string;
  scope_status: string; engagement_type: string;
  started_at: string; client_id: string;
}>) => ({
  id: "proj-1",
  name: "Test Project",
  status: "in_progress",
  scope_status: "on_track",
  engagement_type: "fixed",
  started_at: "2026-04-01T00:00:00Z",
  client_id: "client-1",
  project_code: "T-001",
  quote_id: null,
  created_at: "2026-04-01T00:00:00Z",
  ...overrides,
} as any);

const makeClient = (projects: ReturnType<typeof makeProject>[]): ClientWithProjects => ({
  id: "client-1",
  name: "ACME",
  primary_domain: "acme.co.za",
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  projects,
} as any);

describe("useOpsOverview", () => {
  it("returns zero counts for empty data", () => {
    const { result } = renderHook(() => useOpsOverview([]));
    expect(result.current.onTrackCount).toBe(0);
    expect(result.current.needsAttentionCount).toBe(0);
    expect(result.current.overdueCount).toBe(0);
    expect(result.current.totalActiveProjects).toBe(0);
    expect(result.current.totalActiveClients).toBe(0);
  });

  it("counts on_track projects", () => {
    const data = [makeClient([makeProject({ scope_status: "on_track" })])];
    const { result } = renderHook(() => useOpsOverview(data));
    expect(result.current.onTrackCount).toBe(1);
  });

  it("counts needs_attention projects", () => {
    const data = [makeClient([makeProject({ scope_status: "needs_attention" })])];
    const { result } = renderHook(() => useOpsOverview(data));
    expect(result.current.needsAttentionCount).toBe(1);
  });

  it("counts overdue projects", () => {
    const data = [makeClient([makeProject({ scope_status: "overdue" })])];
    const { result } = renderHook(() => useOpsOverview(data));
    expect(result.current.overdueCount).toBe(1);
  });

  it("excludes completed projects from counts", () => {
    const data = [makeClient([makeProject({ status: "completed" })])];
    const { result } = renderHook(() => useOpsOverview(data));
    expect(result.current.totalActiveProjects).toBe(0);
  });

  it("puts overdue projects before needs_attention in attentionProjects", () => {
    const data = [makeClient([
      makeProject({ id: "p1", scope_status: "needs_attention" }),
      makeProject({ id: "p2", scope_status: "overdue" }),
    ])];
    const { result } = renderHook(() => useOpsOverview(data));
    expect(result.current.attentionProjects[0].id).toBe("p2");
  });

  it("includes clientName in each OpsProject", () => {
    const data = [makeClient([makeProject({})])];
    const { result } = renderHook(() => useOpsOverview(data));
    expect(result.current.recentProjects[0].clientName).toBe("ACME");
  });

  it("counts active clients correctly", () => {
    const data = [
      makeClient([makeProject({ id: "p1", client_id: "client-1" })]),
      { ...makeClient([]), id: "client-2", name: "Empty Client", projects: [] } as any,
    ];
    const { result } = renderHook(() => useOpsOverview(data));
    expect(result.current.totalActiveClients).toBe(1);
  });
});
