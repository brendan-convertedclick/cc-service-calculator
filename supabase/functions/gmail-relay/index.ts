// supabase/functions/gmail-relay/index.ts
//
// Request:  POST { thread_id, thread_subject, messages: [...] }
//   Headers: x-relay-user (teammate email), x-relay-signature (hex hmac_sha256(body, secret))
// Response: 200 { brief_id, inserted_message_count }
//   - 401 on HMAC mismatch / unknown user / revoked secret
//   - 400 on malformed body
//   - 500 on unexpected error
//   - 503 on relay_secrets DB lookup failure
//
// Idempotent: dedupes by gmail_message_id, upserts brief on gmail_thread_id.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { validateRequestProd } from "../_shared/relay-auth.ts";

type RelayMessage = {
  message_id: string;
  direction: "inbound" | "outbound";
  from: { email: string; name?: string };
  to: string[];
  cc: string[];
  subject: string;
  sent_at: string; // ISO 8601
  body_text: string;
  body_html: string;
  attachments: Array<{ name: string; mime: string; size: number; base64: string }>;
};

type RelayBody = {
  thread_id: string;
  thread_subject: string;
  messages: RelayMessage[];
};

function parseBody(raw: string): RelayBody | null {
  try {
    const obj = JSON.parse(raw);
    if (typeof obj?.thread_id !== "string" || typeof obj?.thread_subject !== "string") return null;
    if (!Array.isArray(obj.messages) || obj.messages.length === 0) return null;
    for (const m of obj.messages) {
      if (
        typeof m?.message_id !== "string" ||
        (m.direction !== "inbound" && m.direction !== "outbound") ||
        typeof m?.from?.email !== "string" ||
        !Array.isArray(m.to) ||
        !Array.isArray(m.cc) ||
        typeof m?.sent_at !== "string" ||
        !Array.isArray(m.attachments)
      ) {
        return null;
      }
    }
    return obj as RelayBody;
  } catch {
    return null;
  }
}

function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 200);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req: Request, ctx) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const rawBody = await req.text();
    const supabase = createServiceRoleClient();

    const auth = await validateRequestProd(req, rawBody, supabase);
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const body = parseBody(rawBody);
    if (!body) return json({ error: "Malformed body" }, 400);

    // 1. Resolve client by sender domain of the first message.
    const firstFrom = body.messages[0].from.email;
    const domain = firstFrom.includes("@") ? firstFrom.split("@")[1].toLowerCase() : null;
    let clientId: string | null = null;
    if (domain) {
      const { data: client } = await supabase
        .from("clients")
        .select("id")
        .ilike("primary_domain", domain)
        .maybeSingle();
      clientId = client?.id ?? null;
    }

    // 2. Upsert briefs row keyed on gmail_thread_id.
    const { data: existing } = await supabase
      .from("briefs")
      .select("id")
      .eq("gmail_thread_id", body.thread_id)
      .maybeSingle();

    let briefId: string;
    if (existing) {
      briefId = existing.id;
    } else {
      const first = body.messages[0];
      const { data: created, error: insertErr } = await supabase
        .from("briefs")
        .insert({
          client_id: clientId,
          source: "gmail_relay",
          status: "new",
          raw_subject: body.thread_subject,
          raw_body: first.body_text,
          sender_email: first.from.email,
          gmail_thread_id: body.thread_id,
        })
        .select("id")
        .single();
      if (insertErr || !created) return json({ error: insertErr?.message ?? "Insert failed" }, 500);
      briefId = created.id;

      // Fire-and-forget: auto-scope runs in background, relay returns immediately.
      const autoScopeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/auto-scope`;
      ctx.waitUntil(
        fetch(autoScopeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ brief_id: briefId }),
        }).catch((e) => console.error("[gmail-relay] auto-scope fire failed", e)),
      );
    }

    // 3. For each message: skip if gmail_message_id already exists; else upload
    //    attachments + insert brief_messages row.
    let inserted = 0;
    for (const m of body.messages) {
      const { data: dup } = await supabase
        .from("brief_messages")
        .select("id")
        .eq("gmail_message_id", m.message_id)
        .maybeSingle();
      if (dup) continue;

      // Upload each attachment (skip the message on upload failure — leaves
      // label so Apps Script retries next run).
      const attachmentsMeta: Array<{ name: string; storage_path: string; mime: string; size: number }> = [];
      let uploadFailed = false;
      for (const a of m.attachments) {
        const safe = safeFileName(a.name);
        const objectPath = `${briefId}/${crypto.randomUUID()}-${safe}`;
        const { error: upErr } = await supabase.storage
          .from("brief-attachments")
          .upload(objectPath, base64ToBytes(a.base64), { contentType: a.mime, upsert: false });
        if (upErr) {
          console.error("gmail-relay attachment upload failed", {
            message_id: m.message_id,
            attachment_name: a.name,
            error: upErr.message,
          });
          uploadFailed = true;
          break;
        }
        attachmentsMeta.push({ name: a.name, storage_path: objectPath, mime: a.mime, size: a.size });
      }
      if (uploadFailed) continue;

      const { error: msgErr } = await supabase.from("brief_messages").insert({
        brief_id: briefId,
        gmail_message_id: m.message_id,
        direction: m.direction,
        from_email: m.from.email,
        from_name: m.from.name ?? null,
        to_emails: m.to,
        cc_emails: m.cc,
        subject: m.subject,
        body_text: m.body_text,
        body_html: m.body_html,
        attachments: attachmentsMeta,
        sent_at: m.sent_at,
        relayed_by: auth.userEmail,
      });
      if (msgErr) {
        console.error("gmail-relay brief_messages insert failed", {
          message_id: m.message_id,
          brief_id: briefId,
          error: msgErr.message,
        });
        continue;
      }
      inserted++;
    }

    // 4. Refresh aggregates on briefs.
    const { count } = await supabase
      .from("brief_messages")
      .select("id", { count: "exact", head: true })
      .eq("brief_id", briefId);
    const { data: latest } = await supabase
      .from("brief_messages")
      .select("sent_at")
      .eq("brief_id", briefId)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    await supabase
      .from("briefs")
      .update({
        message_count: count ?? 0,
        last_message_at: latest?.sent_at ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", briefId);

    return json({ brief_id: briefId, inserted_message_count: inserted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
