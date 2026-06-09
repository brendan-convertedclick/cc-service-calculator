// supabase/functions/change-estimate-webhook/index.ts
//
// Inbound from the external approval program. Verifies HMAC signature using
// CE_WEBHOOK_SECRET, then updates a change_estimate row's status and fires
// post-approval side effects (event-log entry; ClickUp side-effects landed
// here as a TODO follow-up since they need the line-item executor).
//
// Headers:
//   x-ce-signature: hex hmac_sha256(body, CE_WEBHOOK_SECRET)
//
// Payload:
//   {
//     external_approval_id: string,
//     change_estimate_id: string,
//     decision: "approved" | "rejected",
//     approver_email?: string,
//     note?: string
//   }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

type Payload = {
  external_approval_id: string;
  change_estimate_id: string;
  decision: "approved" | "rejected";
  approver_email?: string;
  note?: string;
};

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const secret = Deno.env.get("CE_WEBHOOK_SECRET");
  if (!secret) return json({ error: "CE_WEBHOOK_SECRET not set" }, 500);

  const raw = await req.text();
  const sig = req.headers.get("x-ce-signature");
  if (!sig) return json({ error: "Missing signature" }, 401);
  const expected = await hmacSha256Hex(secret, raw);
  if (sig !== expected) return json({ error: "Bad signature" }, 401);

  let payload: Payload;
  try {
    payload = JSON.parse(raw) as Payload;
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }
  if (!payload.change_estimate_id || !payload.decision) {
    return json({ error: "change_estimate_id + decision required" }, 400);
  }

  const sb = createServiceRoleClient();

  const update: Record<string, unknown> = {
    external_approval_id: payload.external_approval_id,
    approver_email: payload.approver_email ?? null,
    approval_note: payload.note ?? null,
  };
  if (payload.decision === "approved") {
    update.status = "approved";
    update.approved_at = new Date().toISOString();
  } else {
    update.status = "rejected";
    update.rejected_at = new Date().toISOString();
    update.rejected_reason = payload.note ?? "Rejected via approval program";
  }

  const { data: existing } = await sb
    .from("change_estimates")
    .select("project_id, status")
    .eq("id", payload.change_estimate_id)
    .single();
  if (!existing) return json({ error: "CE not found" }, 404);
  // project_id is nullable since migration 0061 (intake CEs have no project).
  const ce = existing as { project_id: string | null; status: string };
  if (ce.status === "approved" && payload.decision === "approved") {
    return json({ already_approved: true });
  }

  const { error: upErr } = await sb
    .from("change_estimates")
    .update(update)
    .eq("id", payload.change_estimate_id);
  if (upErr) return json({ error: upErr.message }, 500);

  // Phase 5 event-log entry — project_events.project_id is NOT NULL, so skip
  // for null-project intake CEs.
  if (ce.project_id) {
    const { error: evErr } = await sb.from("project_events").insert({
      project_id: ce.project_id,
      event_type: payload.decision === "approved" ? "ce_approved" : "ce_rejected",
      payload: {
        change_estimate_id: payload.change_estimate_id,
        approver_email: payload.approver_email,
        note: payload.note,
      },
      occurred_at: new Date().toISOString(),
    });
    if (evErr) {
      console.error("[change-estimate-webhook] project_events insert failed:", evErr.message);
    }
  }

  return json({ ok: true });
});
