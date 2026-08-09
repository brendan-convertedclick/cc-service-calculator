import { supabase } from "@/lib/supabase";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Calls a Supabase Edge Function.
 *
 * Replaces the ritual that was hand-rolled in 18 files: a private
 * `FUNCTIONS_BASE` const, `getSession()`, a bearer header, `JSON.stringify`,
 * then `res.json()` and a bespoke `body.error` check.
 *
 * Semantics deliberately match that hand-rolled version rather than
 * `supabase.functions.invoke`, so migrating a call site cannot change
 * behaviour: the function's own `{ error }` payload is what surfaces, not an
 * opaque `FunctionsHttpError`.
 *
 * Throws on a non-2xx response, using the function's `error` field when it
 * provides one.
 */
export async function callEdgeFn<T = unknown>(
  name: string,
  body?: unknown,
  opts: { method?: "GET" | "POST"; signal?: AbortSignal } = {},
): Promise<T> {
  const { method = body === undefined ? "GET" : "POST", signal } = opts;
  const token = (await supabase.auth.getSession()).data.session?.access_token ?? "";

  const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  // A function can fail before it produces JSON (gateway 401/504), so a parse
  // failure must not mask the status code.
  const payload = (await res.json().catch(() => null)) as (T & { error?: string }) | null;

  if (!res.ok) {
    throw new Error(payload?.error ?? `${name} failed (${res.status})`);
  }
  return payload as T;
}
