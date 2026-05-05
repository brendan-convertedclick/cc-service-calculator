// supabase/functions/gmail-relay/index.ts
//
// Request:  POST { thread_id, thread_subject, messages: [...] }
//   Headers: x-relay-user (teammate email), x-relay-signature (hex hmac_sha256(body, secret))
// Response: 200 { brief_id, inserted_message_count }
//   - 401 on HMAC mismatch / unknown user / revoked secret
//   - 400 on malformed body
//
// Idempotent: dedupes by gmail_message_id, upserts brief on gmail_thread_id.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { validateRequestProd } from "../_shared/relay-auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const rawBody = await req.text();
  const supabase = createServiceRoleClient();
  const auth = await validateRequestProd(req, rawBody, supabase);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  // Body parsing + DB writes land in Task 5.
  return json({ ok: true, user: auth.userEmail });
});
