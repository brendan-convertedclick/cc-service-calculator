// supabase/functions/xero-oauth/index.ts
//
// Handles Xero OAuth2 flow.
//
// ?action=connect   — redirects to Xero authorization URL
// ?action=callback  — exchanges code for tokens, stores in settings, redirects to SITE_URL/settings
// ?action=disconnect — clears tokens and disables Xero in settings
//
// Required secrets: XERO_CLIENT_ID, XERO_CLIENT_SECRET, SITE_URL
// Built-in env: SUPABASE_URL (auto-set by runtime)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

const XERO_AUTH_URL = "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_SCOPES = "openid profile email accounting.transactions accounting.contacts";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  const clientId = Deno.env.get("XERO_CLIENT_ID");
  const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const siteUrl = Deno.env.get("SITE_URL") ?? "http://localhost:5174";

  const redirectUri = `${supabaseUrl}/functions/v1/xero-oauth?action=callback`;

  // ── connect ─────────────────────────────────────────────────────────────
  if (action === "connect") {
    if (!clientId) return htmlError("XERO_CLIENT_ID secret not configured.");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: XERO_SCOPES,
      state: crypto.randomUUID(),
    });
    return redirect(`${XERO_AUTH_URL}?${params.toString()}`);
  }

  // ── callback ─────────────────────────────────────────────────────────────
  if (action === "callback") {
    const code = url.searchParams.get("code");
    if (!code) return htmlError("Missing code parameter from Xero.");
    if (!clientId || !clientSecret) return htmlError("Xero credentials not configured.");

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });

    const tokenRes = await fetch(XERO_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return htmlError(`Token exchange failed: ${text}`);
    }

    const tokens = await tokenRes.json();
    // Store expires_at so refresh logic can check expiry without server time.
    tokens.expires_at = Date.now() + (tokens.expires_in ?? 1800) * 1000;

    const supabase = createServiceRoleClient();
    const { error } = await supabase
      .from("settings")
      .update({ xero_oauth_tokens: tokens, xero_enabled: true })
      .eq("id", 1);

    if (error) return htmlError(`Failed to save tokens: ${error.message}`);

    return redirect(`${siteUrl}/settings`);
  }

  // ── disconnect ───────────────────────────────────────────────────────────
  if (action === "disconnect") {
    const supabase = createServiceRoleClient();
    const { error } = await supabase
      .from("settings")
      .update({ xero_oauth_tokens: null, xero_enabled: false })
      .eq("id", 1);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "content-type": "application/json", ...cors() },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json", ...cors() },
    });
  }

  return new Response(JSON.stringify({ error: "Unknown action" }), {
    status: 400,
    headers: { "content-type": "application/json", ...cors() },
  });
});
