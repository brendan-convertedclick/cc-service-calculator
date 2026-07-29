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
