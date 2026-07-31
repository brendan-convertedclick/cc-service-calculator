import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildBriefComment, buildBriefTaskBody, cuFetch, resolveListAlias } from "./clickup.ts";

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

Deno.test("buildBriefTaskBody resolves dropdown options to ids + time estimate, omits status", () => {
  // Dropdown fields carry their option set; the body must send the option id,
  // not the label (ClickUp FIELD_011). Non-dropdown fields stay raw.
  const fields = [
    { id: "f_client", name: "Client Name", type: "drop_down", type_config: { options: [{ id: "o_trel", name: "Trellidor" }] } },
    { id: "f_doe", name: "Date of Engagement", type: "date" },
    { id: "f_et", name: "Engagement Type", type: "drop_down", type_config: { options: [{ id: "o_task", name: "Task" }] } },
    { id: "f_ws", name: "Work Stream", type: "drop_down", type_config: { options: [{ id: "o_dev", name: "Development" }] } },
    { id: "f_pts", name: "Sprint Points", type: "number" },
  ];
  const body = buildBriefTaskBody(fields, {
    name: "Pull discount report", description: "d",
    clientName: "Trellidor", workStream: "Development", engagementType: "Task",
    sprintPoints: 4, dateOfEngagement: "2026-07-08", assigneeClickupId: 99,
    dueDateMs: null,
  });
  assertEquals(body.name, "Pull discount report");
  assertEquals(body.time_estimate, 4 * 15 * 60_000);
  assertEquals((body as { points?: unknown }).points, 4); // native ClickUp sprint points
  assertEquals((body as { status?: unknown }).status, undefined);
  assertEquals((body as { assignees: number[] }).assignees, [99]);
  const cf = body.custom_fields as Array<{ id: string; value: unknown }>;
  assertEquals(cf.find((c) => c.id === "f_client")?.value, "o_trel");
  assertEquals(cf.find((c) => c.id === "f_et")?.value, "o_task");
  assertEquals(cf.find((c) => c.id === "f_ws")?.value, "o_dev");
  assertEquals(cf.find((c) => c.id === "f_pts")?.value, 4);
});

Deno.test("buildBriefTaskBody omits a dropdown with no matching option, keeps text fields raw", () => {
  const fields = [
    // Dropdown whose option set does NOT contain the requested value → omitted.
    { id: "f_ws", name: "Work Stream", type: "drop_down", type_config: { options: [{ id: "o_seo", name: "SEO" }] } },
    // Non-dropdown "Client Name" (text) → raw value passes through.
    { id: "f_client", name: "Client Name", type: "short_text" },
  ];
  const body = buildBriefTaskBody(fields, {
    name: "n", description: "d", clientName: "Acme", workStream: "Development",
    engagementType: "Task", sprintPoints: 1, dateOfEngagement: "2026-07-08",
    assigneeClickupId: null, dueDateMs: null,
  });
  const cf = body.custom_fields as Array<{ id: string; value: unknown }>;
  assertEquals(cf.find((c) => c.id === "f_ws"), undefined); // unresolved dropdown omitted
  assertEquals(cf.find((c) => c.id === "f_client")?.value, "Acme"); // text field raw
});

Deno.test("buildBriefTaskBody omits assignees when none + sets due_date when given", () => {
  const body = buildBriefTaskBody([], {
    name: "n", description: "d", clientName: "C",
    workStream: "W", engagementType: "Task", sprintPoints: 1,
    dateOfEngagement: "2026-07-08", assigneeClickupId: null, dueDateMs: 1780000000000,
  });
  assertEquals((body as { assignees?: unknown }).assignees, undefined);
  assertEquals((body as { due_date?: number }).due_date, 1780000000000);
});

// --- cuFetch -----------------------------------------------------------

function fakeFetch(statuses: number[], calls: string[]) {
  let i = 0;
  return (url: string | URL | Request) => {
    calls.push(String(url));
    const status = statuses[Math.min(i++, statuses.length - 1)];
    return Promise.resolve(
      new Response("{}", { status, headers: { "retry-after": "60" } }),
    );
  };
}

Deno.test("cuFetch retries a 429 and returns the eventual success", async () => {
  const calls: string[] = [];
  const waits: number[] = [];
  const res = await cuFetch("https://api.clickup.com/api/v2/task/abc", undefined, {
    fetchImpl: fakeFetch([429, 200], calls) as unknown as typeof fetch,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  });
  assertEquals(res.status, 200);
  assertEquals(calls.length, 2);
  // Retry-After of 60s must be clamped, not honoured verbatim.
  assertEquals(waits, [3_000]);
});

Deno.test("cuFetch gives up after the attempt cap and returns the 429", async () => {
  const calls: string[] = [];
  const res = await cuFetch("https://api.clickup.com/api/v2/task/abc", undefined, {
    fetchImpl: fakeFetch([429], calls) as unknown as typeof fetch,
    sleep: () => Promise.resolve(),
  });
  assertEquals(res.status, 429);
  assertEquals(calls.length, 3);
});

Deno.test("cuFetch does NOT retry a 5xx — a POST may have already landed", async () => {
  const calls: string[] = [];
  const res = await cuFetch("https://api.clickup.com/api/v2/list/1/task", { method: "POST" }, {
    fetchImpl: fakeFetch([500, 200], calls) as unknown as typeof fetch,
    sleep: () => Promise.resolve(),
  });
  assertEquals(res.status, 500);
  assertEquals(calls.length, 1);
});
