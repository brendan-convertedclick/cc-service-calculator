import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildBriefComment, resolveListAlias } from "./clickup.ts";

const aliases = [
  { work_stream: "Development", aliases: ["Development", "Dev", "Engineering"] },
  { work_stream: "SEO", aliases: ["SEO", "Search"] },
];

Deno.test("resolveListAlias returns the canonical work stream for an exact alias", () => {
  assertEquals(resolveListAlias("Dev", aliases, []), {
    list_name: "Development",
    source: "default",
  });
});

Deno.test("resolveListAlias is case-insensitive", () => {
  assertEquals(resolveListAlias("seo", aliases, []), {
    list_name: "SEO",
    source: "default",
  });
});

Deno.test("resolveListAlias falls back to a client override when present", () => {
  const overrides = [{ client_id: "c1", work_stream: "SEO", list_name: "SEO (Pebble custom)" }];
  const out = resolveListAlias("SEO", aliases, overrides, "c1");
  assertEquals(out, { list_name: "SEO (Pebble custom)", source: "override" });
});

Deno.test("resolveListAlias ignores overrides for a different client", () => {
  const overrides = [{ client_id: "c1", work_stream: "SEO", list_name: "SEO (Pebble)" }];
  const out = resolveListAlias("SEO", aliases, overrides, "c2");
  assertEquals(out, { list_name: "SEO", source: "default" });
});

Deno.test("resolveListAlias returns null for an unknown stream", () => {
  assertEquals(resolveListAlias("Accounting", aliases, []), null);
});

Deno.test("buildBriefComment emits a BRIEF:: prefixed JSON payload", () => {
  const c = buildBriefComment({
    client_name: "Pebble",
    engagement_type: "Task",
    work_stream: "Development",
    sprint_points: 3,
    date_of_engagement: "2026-04-22",
    source_quote_id: "q-1",
  });
  assertEquals(c.startsWith("BRIEF:: "), true);
  const payload = JSON.parse(c.slice("BRIEF:: ".length));
  assertEquals(payload.sprint_points, 3);
  assertEquals(payload.work_stream, "Development");
  assertEquals(payload.source_quote_id, "q-1");
});
