// supabase/functions/xero-oauth/index.ts
//
// Handles Xero OAuth2 flow.
//
// ?action=start / connect — redirects to Xero authorization URL
// ?action=callback        — exchanges code for tokens, stores in xero_connection + settings,
//                           redirects to SITE_URL/settings?xero=connected
// ?action=refresh         — refreshes access token from xero_connection, returns JSON
// ?action=status          — returns { connected: boolean, tenantName: string | null }
// ?action=disconnect      — clears xero_connection + settings tokens
//
// Required secrets: XERO_CLIENT_ID, XERO_CLIENT_SECRET
// Optional secret:  XERO_REDIRECT_URI (overrides default redirect URI)
// Built-in env:     SUPABASE_URL (auto-set by runtime), SITE_URL

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

const XERO_AUTH_URL = "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_URL = "https://login.xero.com/identity/connect/token";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
const XERO_SCOPES =
  "openid profile email offline_access accounting.contacts accounting.invoices accounting.payments accounting.settings";

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

async function getTenantInfo(
  accessToken: string,
): Promise<{ id: string; name: string } | null> {
  const res = await fetch(XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const conns = await res.json() as Array<{ tenantId: string; tenantName: string }>;
  if (!conns || conns.length === 0) return null;
  return { id: conns[0].tenantId, name: conns[0].tenantName };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  const clientId = Deno.env.get("XERO_CLIENT_ID");
  const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const siteUrl = Deno.env.get("SITE_URL") ?? "http://localhost:5174";

  // Allow XERO_REDIRECT_URI override for production deployments
  const redirectUri =
    Deno.env.get("XERO_REDIRECT_URI") ??
    `${supabaseUrl}/functions/v1/xero-oauth?action=callback`;

  // ── start / connect ──────────────────────────────────────────────────────
  if (action === "start" || action === "connect") {
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

    const tokens = await tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      [key: string]: unknown;
    };

    const expiresAt = new Date(
      Date.now() + (tokens.expires_in ?? 1800) * 1000,
    ).toISOString();

    // Get tenant info from Xero
    const tenant = await getTenantInfo(tokens.access_token);

    const supabase = createServiceRoleClient();
    const now = new Date().toISOString();

    // Replace any existing xero_connection row
    await supabase
      .from("xero_connection")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    const { error: insertErr } = await supabase.from("xero_connection").insert({
      tenant_id: tenant?.id ?? "unknown",
      tenant_name: tenant?.name ?? null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      updated_at: now,
    });

    if (insertErr) return htmlError(`Failed to save connection: ${insertErr.message}`);

    // Keep legacy settings.xero_oauth_tokens in sync so push-to-xero still works
    const legacyTokens = {
      ...tokens,
      expires_at: Date.now() + (tokens.expires_in ?? 1800) * 1000,
    };
    await supabase
      .from("settings")
      .update({
        xero_oauth_tokens: legacyTokens as unknown as Record<string, unknown>,
        xero_enabled: true,
      })
      .eq("id", 1);

    return redirect(`${siteUrl}/settings?xero=connected`);
  }

  // ── refresh ───────────────────────────────────────────────────────────────
  if (action === "refresh") {
    if (!clientId || !clientSecret) {
      return json({ error: "Xero credentials not configured" }, 500);
    }

    const supabase = createServiceRoleClient();
    const { data: conn, error: connErr } = await supabase
      .from("xero_connection")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (connErr || !conn) return json({ error: "Xero not connected" }, 400);

    const refreshBody = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: (conn as { refresh_token: string }).refresh_token,
    });

    const res = await fetch(XERO_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: refreshBody.toString(),
    });

    if (!res.ok) return json({ error: `Token refresh failed: ${await res.text()}` }, 502);

    const fresh = await res.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    const newExpiresAt = new Date(
      Date.now() + (fresh.expires_in ?? 1800) * 1000,
    ).toISOString();

    await supabase
      .from("xero_connection")
      .update({
        access_token: fresh.access_token,
        refresh_token: fresh.refresh_token,
        expires_at: newExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", (conn as { id: string }).id);

    return json({ ok: true, expires_at: newExpiresAt });
  }

  // ── status ────────────────────────────────────────────────────────────────
  if (action === "status") {
    const supabase = createServiceRoleClient();
    const { data: conn } = await supabase
      .from("xero_connection")
      .select("tenant_name, expires_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conn) return json({ connected: false, tenantName: null });

    const expired =
      new Date((conn as { expires_at: string }).expires_at).getTime() < Date.now();
    return json({
      connected: !expired,
      tenantName: (conn as { tenant_name: string | null }).tenant_name,
    });
  }

  // ── disconnect ───────────────────────────────────────────────────────────
  if (action === "disconnect") {
    const supabase = createServiceRoleClient();

    // Clear xero_connection table
    await supabase
      .from("xero_connection")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    // Also clear legacy settings
    const { error } = await supabase
      .from("settings")
      .update({ xero_oauth_tokens: null, xero_enabled: false })
      .eq("id", 1);

    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json(
    { error: "Unknown action. Use: start, callback, refresh, status, disconnect" },
    400,
  );
});
