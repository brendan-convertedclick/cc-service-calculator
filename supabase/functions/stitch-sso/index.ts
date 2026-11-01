// stitch-sso — "Sign in with Stitch" (OpenID Connect, Stitch docs/INTEGRATION.md §1).
//
// POST { code, code_verifier, redirect_uri }  (verify_jwt = false: the caller is signed out)
//
// The browser did the PKCE half (src/pages/StitchSignIn.tsx) and came back from
// Stitch with a code. Here it is swapped at Stitch's token endpoint with
// Conductor's app key (so only this function can redeem it) and the verifier (so
// only that browser can). The person is found by `external_id`, the auth user id
// Stitch's provisioning recorded, never by the email claim, and a magic-link
// token_hash for that existing auth user is returned for the browser to
// verifyOtp. Nobody new is created here. Conductor is internal, so the
// @convertedclick.co.za rule AuthContext applies is applied here too.

import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { cors, json } from "../_shared/helpers.ts";
import { externalIdOf, nameOf } from "./claims.ts";

const STITCH = Deno.env.get("STITCH_ORIGIN") ?? "https://stitch.net.za";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = (await req.json().catch(() => ({}))) as { code?: unknown; code_verifier?: unknown; redirect_uri?: unknown };
  const { code, code_verifier, redirect_uri } = body;
  if (typeof code !== "string" || typeof code_verifier !== "string" || typeof redirect_uri !== "string")
    return json({ error: "invalid_body" }, 400);

  // Stitch checks the redirect_uri is registered and the one the code was issued for.
  const res = await fetch(`${STITCH}/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${btoa(`conductor:${Deno.env.get("STITCH_CLIENT_SECRET") ?? ""}`)}`,
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier, redirect_uri }),
  });
  const tokens = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !tokens.id_token) {
    console.error("stitch-sso token exchange failed", res.status, tokens.error);
    return json({ error: "stitch_rejected" }, 401);
  }
  // No external_id: Stitch has a grant but hasn't set this person up in Conductor yet.
  const authId = externalIdOf(tokens.id_token, STITCH);
  if (!authId) return json({ error: "not_set_up" }, 403);

  const admin = createServiceRoleClient();
  const { data: authUser } = await admin.auth.admin.getUserById(authId);
  const email = authUser?.user?.email?.toLowerCase();
  if (!email?.endsWith("@convertedclick.co.za")) return json({ error: "not_set_up" }, 403);

  // Stitch owns the name: keep team_members in step on every Stitch sign-in. Best effort, never blocks.
  const name = nameOf(tokens.id_token);
  if (name) {
    const { error } = await admin.from("team_members").update({ full_name: name }).eq("email", email).neq("full_name", name);
    if (error) console.error("stitch-sso name sync failed", error.message);
  }

  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties?.hashed_token) {
    console.error("stitch-sso generateLink failed", error?.message);
    return json({ error: "sign_in_failed" }, 500);
  }
  return json({ token_hash: link.properties.hashed_token });
});
