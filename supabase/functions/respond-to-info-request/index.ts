// supabase/functions/respond-to-info-request/index.ts
//
// Request:  POST { extension_request_id: string, response: string }
// Response: 200 { status: 'pending_admin' | 'pending_owner' }
//
// The requester answers an approver's question and the request re-enters the
// queue. Service-role write on purpose: RLS can gate *which* row a staffer
// touches but not *which columns*, so a staff-side UPDATE could set
// admin_approved_at + status='pending_owner' in one statement and skip the
// admin leg entirely. Routing the answer through here keeps "always through
// the admin first" enforceable — the return status is derived server-side.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient, createUserClient } from "../_shared/supabase-client.ts";
import { statusAfterInfoResponse } from "../_shared/extension-logic.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { extension_request_id, response } = (await req.json()) as {
      extension_request_id?: string;
      response?: string;
    };
    if (!extension_request_id) return json({ error: "extension_request_id required" }, 400);
    if (!response?.trim()) return json({ error: "response required" }, 400);

    const supabase = createUserClient(req);
    const callerEmail = (await supabase.auth.getUser()).data.user?.email ?? "";
    if (!callerEmail) return json({ error: "Not authenticated" }, 401);

    const { data: callerRaw } = await supabase
      .from("team_members")
      .select("id")
      .eq("email", callerEmail)
      .maybeSingle();
    const callerId = (callerRaw as { id: string } | null)?.id;
    if (!callerId) return json({ error: "No team_members row for caller" }, 403);

    const sb = createServiceRoleClient();
    const { data: rowRaw, error: rowErr } = await sb
      .from("extension_requests")
      .select("id, requester_id, status, admin_approved_at")
      .eq("id", extension_request_id)
      .single();
    if (rowErr || !rowRaw) return json({ error: rowErr?.message ?? "Not found" }, 404);
    const row = rowRaw as unknown as {
      requester_id: string;
      status: string;
      admin_approved_at: string | null;
    };

    if (row.requester_id !== callerId) return json({ error: "Not your request" }, 403);
    if (row.status !== "needs_info") {
      return json({ error: `Request is not awaiting information (status=${row.status})` }, 400);
    }

    const nextStatus = statusAfterInfoResponse(row);
    const { error: updateErr } = await sb
      .from("extension_requests")
      .update({
        status: nextStatus,
        info_response: response.trim(),
        info_responded_at: new Date().toISOString(),
      })
      .eq("id", extension_request_id);
    if (updateErr) return json({ error: updateErr.message }, 500);

    return json({ status: nextStatus });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
