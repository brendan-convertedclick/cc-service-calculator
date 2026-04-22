import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cors, json } from "./helpers.ts";

Deno.test("cors() returns the canonical three headers", () => {
  const c = cors();
  assertEquals(c["access-control-allow-origin"], "*");
  assertEquals(c["access-control-allow-methods"], "POST, OPTIONS");
  assertEquals(
    c["access-control-allow-headers"],
    "authorization, content-type, x-client-info, apikey",
  );
});

Deno.test("json() defaults to 200 and JSON content type, includes CORS", async () => {
  const r = json({ hello: "world" });
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("content-type"), "application/json");
  assertEquals(r.headers.get("access-control-allow-origin"), "*");
  assertEquals(await r.json(), { hello: "world" });
});

Deno.test("json() respects explicit status", () => {
  const r = json({ error: "oops" }, 500);
  assertEquals(r.status, 500);
});
