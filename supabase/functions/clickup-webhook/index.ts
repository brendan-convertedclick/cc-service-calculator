// supabase/functions/clickup-webhook/index.ts
//
// Receives POST events from ClickUp webhooks.
//
// Handles:
//   - taskStatusUpdated to "send to client": hands the task to
//     handover-signoffs, which drafts the client sign-off (0204).
//
// It used to also mark a project completed when ANY one of its tasks closed.
// That never ran (the webhook was first registered 2026-11-28) and was wrong:
// sync-clickup-actuals completes a project only when every child task is done,
// and QuoteSend sets first_delivery_at.
//
// Deploy with verify_jwt=false — ClickUp cannot supply a Supabase JWT.
// The ClickUp webhook secret should be validated via X-Signature header
// if you add HMAC validation in a future phase.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const eventName = body["event"] as string | undefined;

  // Only handle task status updates
  if (eventName !== "taskStatusUpdated") {
    return json({ ok: true, skipped: true });
  }

  const historyItems = (body["history_items"] as Array<Record<string, unknown>>) ?? [];

  // A doer's hand-over (0204): moved to "send to client". handover-signoffs
  // gates it and drafts the sign-off; its 10-minute cron is the backstop if
  // this call is lost, so it is awaited only to run, never to fail the hook.
  const handedOver = historyItems.some((item) => {
    const after = item["after"] as unknown;
    const status = typeof after === "string" ? after : (after as { status?: string } | null)?.status;
    return typeof status === "string" && status.toLowerCase() === "send to client";
  });
  if (handedOver && typeof body["task_id"] === "string") {
    try {
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/handover-signoffs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: body["task_id"] }),
      });
      // The cron retries a lost hand-over, but say why this one did not land.
      const tally = await res.json().catch(() => null) as { drafted?: number; bounced?: number } | null;
      if (!res.ok || !(tally?.drafted || tally?.bounced)) {
        console.error(`clickup-webhook: handover for ${body["task_id"]} did not land: ${res.status} ${JSON.stringify(tally)}`);
      }
    } catch (e) {
      console.error("clickup-webhook: handover call failed:", e);
    }
    return json({ ok: true, handover: true });
  }

  return json({ ok: true, skipped: true });
});
