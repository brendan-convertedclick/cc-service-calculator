// signoffs-sso: Stitch's "Sign-offs" app signs a client contact in to Conductor.
//
// POST { code, code_verifier, redirect_uri }  (verify_jwt = false: the caller is signed out)
//
// Same OIDC redemption as stitch-sso, with the `signoffs` app key. Instead of an
// auth session it mints a short-lived PERSONAL review token for that contact, so
// the page behaves exactly like the emailed link (signed in as them, decisions
// attributed to them). 12 hours, labelled "Stitch sign-in"; each mint revokes the
// contact's earlier ones. The plaintext token is returned once and never logged.

import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { cors, json } from "../_shared/helpers.ts";
import { newPlaintextToken, sha256Hex } from "../_shared/hmac.ts";
import { signoffsClaimsOf } from "./claims.ts";

const STITCH = Deno.env.get("STITCH_ORIGIN") ?? "https://stitch.net.za";
const LABEL = "Stitch sign-in";
const TTL_MS = 12 * 60 * 60 * 1000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = (await req.json().catch(() => ({}))) as { code?: unknown; code_verifier?: unknown; redirect_uri?: unknown };
  const { code, code_verifier, redirect_uri } = body;
  if (typeof code !== "string" || typeof code_verifier !== "string" || typeof redirect_uri !== "string")
    return json({ error: "invalid_body" }, 400);

  let res: Response;
  let tokens: { id_token?: string; error?: string };
  try {
    res = await fetch(`${STITCH}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${btoa(`signoffs:${Deno.env.get("STITCH_SIGNOFFS_SECRET") ?? ""}`)}`,
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier, redirect_uri }),
    });
    tokens = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  } catch (e) {
    console.error("signoffs-sso token exchange unreachable", e instanceof Error ? e.name : "error");
    return json({ error: "sign_in_failed" }, 500);
  }
  if (!res.ok || !tokens.id_token) {
    console.error("signoffs-sso token exchange failed", res.status, tokens.error);
    return json({ error: "stitch_rejected" }, 401);
  }
  const who = signoffsClaimsOf(tokens.id_token, STITCH);
  if (!who) return json({ error: "not_set_up" }, 403);

  const admin = createServiceRoleClient();
  // By id first; if staff deleted and re-added the contact (the house rule for a
  // wrong address) the id is dead, so fall back to the client's contact by email.
  let { data: contact, error: lookupErr } = await admin
    .from("contacts").select("id, full_name").eq("id", who.contactId).eq("client_id", who.clientId).maybeSingle();
  if (!lookupErr && !contact) {
    ({ data: contact, error: lookupErr } = await admin
      .from("contacts").select("id, full_name").eq("client_id", who.clientId).eq("email", who.email.toLowerCase()).maybeSingle());
  }
  if (lookupErr) {
    console.error("signoffs-sso contact lookup failed", lookupErr.message);
    return json({ error: "sign_in_failed" }, 500);
  }
  // A nameless contact would hit "And you are?" and fail every decision.
  if (!contact?.full_name?.trim()) return json({ error: "not_set_up" }, 403);

  const { error: revokeErr } = await admin
    .from("client_review_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("contact_id", contact.id).eq("label", LABEL).is("revoked_at", null);
  if (revokeErr) {
    console.error("signoffs-sso revoke failed", revokeErr.message);
    return json({ error: "sign_in_failed" }, 500);
  }

  const token = newPlaintextToken();
  const { error: insertErr } = await admin.from("client_review_tokens").insert({
    client_id: who.clientId,
    contact_id: contact.id,
    token_hash: await sha256Hex(token),
    label: LABEL,
    expires_at: new Date(Date.now() + TTL_MS).toISOString(),
  });
  if (insertErr) {
    console.error("signoffs-sso mint failed", insertErr.message);
    return json({ error: "sign_in_failed" }, 500);
  }
  return json({ token });
});
