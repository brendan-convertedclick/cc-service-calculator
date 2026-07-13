// supabase/functions/clickup-oauth/index.ts
//
// Handles the per-user ClickUp OAuth2 flow (Phase 1 of #5).
// Unlike xero-oauth (org-level, one token in settings), ClickUp is per-user:
// each token is stored against the connecting team member in clickup_user_tokens.
//
// ?action=start   — requires the caller's user JWT (Authorization: Bearer <jwt>
//                   OR ?jwt=<token> for the <a href>/window.location case).
//                   Resolves the caller's team_members row, builds a signed
//                   `state` = base64url(`{member_id}.{hmac(member_id)}`), and
//                   302-redirects to the ClickUp authorize URL.
// callback         — detected by ?code=&state=. Verifies the state HMAC → member
//                   id, exchanges the code for an access_token, fetches the
//                   authorized ClickUp user, upserts clickup_user_tokens (service
//                   role), and redirects to ${SITE_URL}/settings?clickup=connected.
// ?action=status  — caller JWT → { connected, clickup_username } for that member.
//                   Never returns the access_token.
// ?action=disconnect — caller JWT → deletes the member's row → { ok: true }.
//
// Required secrets: CLICKUP_OAUTH_CLIENT_ID, CLICKUP_OAUTH_CLIENT_SECRET,
//                   CLICKUP_OAUTH_STATE_SECRET
// Optional secret:  SITE_URL
// Built-in env:     SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

const CLICKUP_AUTH_URL = "https://app.clickup.com/api";
const CLICKUP_TOKEN_URL = "https://api.clickup.com/api/v2/oauth/token";
const CLICKUP_USER_URL = "https://api.clickup.com/api/v2/user";

function redirect(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: url, ...cors() },
  });
}

function htmlError(msg: string): Response {
  return new Response(`<html><body><p>Error: ${msg}</p></body></html>`, {
    status: 400,
    headers: { "content-type": "text/html", ...cors() },
  });
}

// ── signed state helpers (HMAC-SHA256 via Web Crypto) ──────────────────────
function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function signState(memberId: string, secret: string): Promise<string> {
  const mac = await hmacHex(memberId, secret);
  return b64urlEncode(new TextEncoder().encode(`${memberId}.${mac}`));
}

async function verifyState(
  state: string,
  secret: string,
): Promise<string | null> {
  try {
    const decoded = atob(state.replace(/-/g, "+").replace(/_/g, "/"));
    const dot = decoded.lastIndexOf(".");
    if (dot < 0) return null;
    const memberId = decoded.slice(0, dot);
    const mac = decoded.slice(dot + 1);
    const expected = await hmacHex(memberId, secret);
    // constant-time-ish compare
    if (mac.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0 ? memberId : null;
  } catch {
    return null;
  }
}

// Resolve the caller's team_members id from a user JWT (header or ?jwt param).
async function resolveCallerMemberId(
  req: Request,
  url: URL,
): Promise<{ memberId: string } | { error: string }> {
  const jwtParam = url.searchParams.get("jwt");
  const authHeader = jwtParam
    ? `Bearer ${jwtParam}`
    : (req.headers.get("Authorization") ?? "");
  if (!authHeader) return { error: "Missing caller session (no JWT)." };

  const userClient: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user?.email) {
    return { error: "Could not resolve the signed-in user." };
  }

  // Service-role lookup of the member by email (team_members RLS may hide rows).
  const svc = createServiceRoleClient();
  const { data: member, error: memberErr } = await svc
    .from("team_members")
    .select("id")
    .eq("email", userData.user.email)
    .maybeSingle();

  if (memberErr) return { error: memberErr.message };
  if (!member) {
    return { error: `No team_members row for ${userData.user.email}.` };
  }
  return { memberId: (member as { id: string }).id };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const clientId = Deno.env.get("CLICKUP_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("CLICKUP_OAUTH_CLIENT_SECRET");
  const stateSecret = Deno.env.get("CLICKUP_OAUTH_STATE_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const siteUrl = Deno.env.get("SITE_URL") ?? "http://localhost:5391";
  const redirectUri = `${supabaseUrl}/functions/v1/clickup-oauth`;

  // ── callback (ClickUp redirects here with ?code=&state=) ───────────────────
  if (code && state) {
    if (!clientId || !clientSecret) {
      return htmlError("ClickUp credentials not configured.");
    }
    if (!stateSecret) return htmlError("CLICKUP_OAUTH_STATE_SECRET not configured.");

    const memberId = await verifyState(state, stateSecret);
    if (!memberId) return htmlError("Invalid or tampered OAuth state.");

    // Exchange code for an access token. ClickUp accepts the params either as
    // query string or form body; we send them as query params (most reliable
    // for the v2 oauth/token endpoint).
    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    });
    const tokenRes = await fetch(`${CLICKUP_TOKEN_URL}?${tokenParams.toString()}`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    if (!tokenRes.ok) {
      return htmlError(`Token exchange failed: ${await tokenRes.text()}`);
    }
    const tokenBody = await tokenRes.json() as { access_token?: string };
    const accessToken = tokenBody.access_token;
    if (!accessToken) return htmlError("ClickUp did not return an access token.");

    // Identify the authorized ClickUp user (raw token, no "Bearer" — ClickUp
    // convention, matching CLICKUP_PAT usage elsewhere in this repo).
    let clickupUserId: string | null = null;
    let clickupUsername: string | null = null;
    const userRes = await fetch(CLICKUP_USER_URL, {
      headers: { Authorization: accessToken },
    });
    if (userRes.ok) {
      const u = await userRes.json() as {
        user?: { id?: number | string; username?: string };
      };
      clickupUserId = u.user?.id != null ? String(u.user.id) : null;
      clickupUsername = u.user?.username ?? null;
    }

    const svc = createServiceRoleClient();
    const { error: upsertErr } = await svc
      .from("clickup_user_tokens")
      .upsert({
        team_member_id: memberId,
        clickup_user_id: clickupUserId,
        clickup_username: clickupUsername,
        access_token: accessToken,
        connected_at: new Date().toISOString(),
      }, { onConflict: "team_member_id" });

    if (upsertErr) return htmlError(`Failed to save token: ${upsertErr.message}`);

    return redirect(`${siteUrl}/settings?clickup=connected`);
  }

  // ── start ──────────────────────────────────────────────────────────────────
  if (action === "start") {
    if (!clientId) return htmlError("CLICKUP_OAUTH_CLIENT_ID secret not configured.");
    if (!stateSecret) return htmlError("CLICKUP_OAUTH_STATE_SECRET not configured.");

    const caller = await resolveCallerMemberId(req, url);
    if ("error" in caller) return htmlError(caller.error);

    const signedState = await signState(caller.memberId, stateSecret);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state: signedState,
    });
    return redirect(`${CLICKUP_AUTH_URL}?${params.toString()}`);
  }

  // ── status ───────────────────────────────────────────────────────────────
  if (action === "status") {
    const caller = await resolveCallerMemberId(req, url);
    if ("error" in caller) return json({ connected: false, clickup_username: null });

    const svc = createServiceRoleClient();
    const { data: row } = await svc
      .from("clickup_user_tokens")
      .select("clickup_username")
      .eq("team_member_id", caller.memberId)
      .maybeSingle();

    return json({
      connected: !!row,
      clickup_username: (row as { clickup_username: string | null } | null)?.clickup_username ?? null,
    });
  }

  // ── disconnect ─────────────────────────────────────────────────────────────
  if (action === "disconnect") {
    const caller = await resolveCallerMemberId(req, url);
    if ("error" in caller) return json({ error: caller.error }, 401);

    const svc = createServiceRoleClient();
    const { error } = await svc
      .from("clickup_user_tokens")
      .delete()
      .eq("team_member_id", caller.memberId);

    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json(
    { error: "Unknown action. Use: start, callback (code+state), status, disconnect" },
    400,
  );
});
