// stitch-waiting: what Stitch shows a client about their Conductor sign-offs.
//
// POST { client_id }  Authorization: Bearer <STITCH_WAITING_SECRET>
//   → 200 WaitingResult | 401 | 400 | 500
//
// Called by Stitch's `signoffs` adapter, server to server (verify_jwt = false:
// the caller holds a shared secret, not a Supabase session). The rows come from
// the review page's own list loader, so the filters that keep parked rows,
// internal notes and staff-only columns away from a client apply unchanged;
// waitingFrom then keeps twelve named fields per row and drops the rest.
// An unset secret answers 401 to everyone, never open.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { sha256Hex, timingSafeEqualHex } from "../_shared/hmac.ts";
import { loadReviewList } from "../_shared/review-list.ts";
import { sastDate, waitingFrom } from "./waiting.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const secret = Deno.env.get("STITCH_WAITING_SECRET");
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  // Hash both sides first so the compare is constant-time whatever the lengths.
  if (!secret || !given || !timingSafeEqualHex(await sha256Hex(given), await sha256Hex(secret))) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = (await req.json().catch(() => ({}))) as { client_id?: unknown };
  // A malformed uuid would reach Postgres as a cast error and come back a 500.
  if (typeof body.client_id !== "string" || !UUID.test(body.client_id)) {
    return json({ error: "client_id required" }, 400);
  }

  try {
    const list = await loadReviewList(createServiceRoleClient(), body.client_id, null);
    if (!list.ok) return json({ error: list.error }, list.status);
    const now = Date.now();
    return json(waitingFrom(list.payload, sastDate(now), now));
  } catch (e) {
    console.error("[stitch-waiting] unexpected error:", e instanceof Error ? e.message : e);
    return json({ error: "Something went wrong on our side" }, 500);
  }
});
