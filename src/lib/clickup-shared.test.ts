import { describe, expect, it } from "vitest";
import { resolveListAlias, buildBriefComment } from "./clickup-shared";

const aliases = [
  { work_stream: "Development", aliases: ["Development", "Dev", "Engineering"] },
  { work_stream: "SEO", aliases: ["SEO", "Search"] },
];

describe("resolveListAlias", () => {
  it("returns the canonical work stream for an exact alias", () => {
    expect(resolveListAlias("Dev", aliases, [])).toEqual({
      list_name: "Development",
      source: "default",
    });
  });

  it("is case-insensitive", () => {
    expect(resolveListAlias("seo", aliases, [])).toEqual({
      list_name: "SEO",
      source: "default",
    });
  });

  it("falls back to a client override when present", () => {
    const overrides = [{ client_id: "c1", work_stream: "SEO", list_name: "SEO (Pebble custom)" }];
    const out = resolveListAlias("SEO", aliases, overrides, "c1");
    expect(out).toEqual({ list_name: "SEO (Pebble custom)", source: "override" });
  });

  it("ignores overrides for a different client", () => {
    const overrides = [{ client_id: "c1", work_stream: "SEO", list_name: "SEO (Pebble)" }];
    const out = resolveListAlias("SEO", aliases, overrides, "c2");
    expect(out).toEqual({ list_name: "SEO", source: "default" });
  });

  it("returns null for an unknown stream", () => {
    expect(resolveListAlias("Accounting", aliases, [])).toBeNull();
  });
});

describe("buildBriefComment", () => {
  it("emits a BRIEF:: prefixed JSON payload", () => {
    const c = buildBriefComment({
      client_name: "Pebble",
      engagement_type: "Task",
      work_stream: "Development",
      sprint_points: 3,
      date_of_engagement: "2026-04-22",
      source_quote_id: "q-1",
    });
    expect(c.startsWith("BRIEF:: ")).toBe(true);
    const payload = JSON.parse(c.slice("BRIEF:: ".length));
    expect(payload.sprint_points).toBe(3);
    expect(payload.work_stream).toBe("Development");
    expect(payload.source_quote_id).toBe("q-1");
  });
});
