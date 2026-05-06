// Integration-style tests for gmail-relay. Run against a real Supabase project
// only if SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set; otherwise skip.
//
// For pure logic tests (HMAC validation), we exercise the validateRequest
// helper directly. Full end-to-end is exercised manually (Task 9).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hmacSign } from "./hmac.ts";
import { validateRequest } from "./relay-auth.ts";

Deno.test("validateRequest rejects when x-relay-user header is missing", async () => {
  const req = new Request("https://x/gmail-relay", {
    method: "POST",
    headers: { "x-relay-signature": "abc" },
    body: "{}",
  });
  const result = await validateRequest(req, "{}", async () => "stored-secret");
  assertEquals(result.ok, false);
  assertEquals(result.status, 401);
});

Deno.test("validateRequest rejects when signature does not match", async () => {
  const body = JSON.stringify({ thread_id: "t1" });
  const req = new Request("https://x/gmail-relay", {
    method: "POST",
    headers: {
      "x-relay-user": "alice@example.com",
      "x-relay-signature": "deadbeef".repeat(8),
    },
    body,
  });
  const result = await validateRequest(req, body, async () => "stored-secret");
  assertEquals(result.ok, false);
  assertEquals(result.status, 401);
});

Deno.test("validateRequest accepts when signature matches stored secret", async () => {
  const body = JSON.stringify({ thread_id: "t1" });
  const sig = await hmacSign(body, "stored-secret");
  const req = new Request("https://x/gmail-relay", {
    method: "POST",
    headers: {
      "x-relay-user": "alice@example.com",
      "x-relay-signature": sig,
    },
    body,
  });
  const result = await validateRequest(req, body, async () => "stored-secret");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.userEmail, "alice@example.com");
});

Deno.test("validateRequest rejects when the user has no relay_secrets row", async () => {
  const body = "{}";
  const sig = await hmacSign(body, "any");
  const req = new Request("https://x/gmail-relay", {
    method: "POST",
    headers: {
      "x-relay-user": "ghost@example.com",
      "x-relay-signature": sig,
    },
    body,
  });
  const result = await validateRequest(req, body, async () => null);
  assertEquals(result.ok, false);
  assertEquals(result.status, 401);
});
