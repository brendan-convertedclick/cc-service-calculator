import { supabase } from "@/lib/supabase";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/** Fire the notifier for whoever now owes a decision. Best-effort, never awaited. */
export function notifyExtension(id: string): void {
  void (async () => {
    const session = (await supabase.auth.getSession()).data.session;
    fetch(`${FUNCTIONS_BASE}/notify-extension-request`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ extension_request_id: id }),
    }).catch(() => {});
  })();
}

/**
 * Reject a request, with the decision attributed. Used from both the admin
 * queue and the owner escalation queue — a reject is terminal on either leg,
 * and either way the requester needs to know who said no, not just why.
 *
 * Returns an error message, or null on success.
 */
export async function rejectRequest(
  id: string,
  reason: string,
  rejectedBy: string | null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("extension_requests")
    .update({
      status: "rejected",
      rejected_reason: reason.trim(),
      rejected_by: rejectedBy,
      rejected_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id");
  if (error) return error.message;
  // supabase-js reports a no-op success when RLS filters every row out.
  if (!data || data.length === 0) return "Not permitted to update this request";
  return null;
}

/**
 * Bounce a request back to its requester with a question. Used from both the
 * admin queue and the owner escalation queue — the answer returns to whichever
 * leg still owes a decision (see respond-to-info-request).
 *
 * Returns an error message, or null on success.
 */
export async function askForInfo(
  id: string,
  question: string,
  askedBy: string | null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("extension_requests")
    .update({
      status: "needs_info",
      info_request: question.trim(),
      info_requested_by: askedBy,
      info_requested_at: new Date().toISOString(),
      info_response: null,
      info_responded_at: null,
    })
    .eq("id", id)
    .select("id");
  if (error) return error.message;
  // supabase-js reports a no-op success when RLS filters every row out.
  if (!data || data.length === 0) return "Not permitted to update this request";
  notifyExtension(id);
  return null;
}
