// supabase/functions/push-to-xero/index.ts
//
// Request:  POST { quote_id: string }
// Response: 200 { xero_quote_id: string }
//
// Flow:
//   1. Load quote + scope + client from DB.
//   2. Get xero_oauth_tokens from settings. Return 400 if missing.
//   3. Refresh access token if expired (Xero tokens expire in 30 min).
//   4. Get or create the Xero contact for the client.
//   5. Load quote line items from quote_line_item_allocations.
//   6. Create a Xero Quote (DRAFT status, ZAR currency).
//   7. Save returned QuoteID to quotes.xero_quote_id.
//   8. Return { xero_quote_id }.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

const XERO_API = "https://api.xero.com/api.xro/2.0";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";

type XeroTokens = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  [key: string]: unknown;
};

async function refreshTokensIfNeeded(
  tokens: XeroTokens,
  clientId: string,
  clientSecret: string,
): Promise<XeroTokens> {
  const now = Date.now();
  // Refresh if within 60s of expiry or already expired.
  const expiresAt = tokens.expires_at ?? 0;
  if (expiresAt - now > 60_000) return tokens;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });

  const res = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: body.toString(),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);

  const fresh = await res.json();
  fresh.expires_at = Date.now() + (fresh.expires_in ?? 1800) * 1000;
  return fresh as XeroTokens;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { quote_id } = await req.json();
    if (!quote_id) return json({ error: "quote_id required" }, 400);

    const clientId = Deno.env.get("XERO_CLIENT_ID");
    const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      return json({ error: "XERO_CLIENT_ID / XERO_CLIENT_SECRET secrets not configured" }, 500);
    }

    const supabase = createServiceRoleClient();

    // Load settings.
    const { data: settings, error: sErr } = await supabase
      .from("settings")
      .select("xero_enabled,xero_oauth_tokens")
      .eq("id", 1)
      .single();
    if (sErr) return json({ error: sErr.message }, 500);
    if (!settings?.xero_oauth_tokens) return json({ error: "Xero not connected" }, 400);

    let tokens = settings.xero_oauth_tokens as XeroTokens;

    // Refresh if needed.
    tokens = await refreshTokensIfNeeded(tokens, clientId, clientSecret);
    // Persist refreshed tokens back.
    // Cast through unknown to satisfy the Supabase Json type.
    await supabase
      .from("settings")
      .update({ xero_oauth_tokens: tokens as unknown as Record<string, unknown> })
      .eq("id", 1);

    const xeroHeaders = {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Xero-Tenant-Id": await getXeroTenantId(tokens.access_token),
    };

    // Load quote with client.
    const { data: quote, error: qErr } = await supabase
      .from("quotes")
      .select("*, scope:scopes(*, brief:briefs(*, client:clients(*)))")
      .eq("id", quote_id)
      .single();
    if (qErr || !quote) return json({ error: qErr?.message ?? "Quote not found" }, 404);

    type ClientRow = { id: string; name: string; xero_contact_id: string | null };
    const scope = (quote as {
      scope: { brief: { client: ClientRow | null } | null };
    }).scope;
    const client = scope?.brief?.client as ClientRow | null;
    if (!client) return json({ error: "Client not found on quote" }, 400);

    // Get or create Xero contact.
    let xeroContactId = client.xero_contact_id;
    if (!xeroContactId) {
      const contactRes = await fetch(`${XERO_API}/Contacts`, {
        method: "POST",
        headers: xeroHeaders,
        body: JSON.stringify({ Name: client.name }),
      });
      if (!contactRes.ok) {
        return json({ error: `Xero contact create failed: ${await contactRes.text()}` }, 502);
      }
      const contactData = await contactRes.json();
      xeroContactId = contactData?.Contacts?.[0]?.ContactID ?? null;
      if (!xeroContactId) return json({ error: "Xero did not return a ContactID" }, 502);

      // Persist contact ID back to clients table.
      await supabase
        .from("clients")
        .update({ xero_contact_id: xeroContactId })
        .eq("id", client.id);
    }

    // Load line items from frozen snapshot.
    const { data: lineRows, error: lErr } = await supabase
      .from("quote_line_item_allocations")
      .select("service_name,qty,unit_price_cents,subtotal_cents,xero_code")
      .eq("quote_id", quote_id)
      .order("ordinal");
    if (lErr) return json({ error: lErr.message }, 500);

    // Aggregate by service_name to avoid per-department duplicates.
    const lineMap = new Map<string, {
      description: string;
      quantity: number;
      unitAmountCents: number;
      xeroCode: string | null;
    }>();
    for (const row of (lineRows ?? []) as Array<{
      service_name: string;
      qty: number;
      unit_price_cents: number;
      subtotal_cents: number;
      xero_code: string | null;
    }>) {
      if (!lineMap.has(row.service_name)) {
        lineMap.set(row.service_name, {
          description: row.service_name,
          quantity: row.qty,
          unitAmountCents: row.unit_price_cents,
          xeroCode: row.xero_code,
        });
      }
    }

    const lineItems = Array.from(lineMap.values()).map((li) => ({
      Description: li.description,
      Quantity: li.quantity,
      UnitAmount: +(li.unitAmountCents / 100).toFixed(2),
      AccountCode: li.xeroCode ?? "200",
    }));

    // Build epoch date string for Xero (/Date(ms)/ format).
    const epochStr = `/Date(${Date.now()})/`;

    const xeroQuoteBody = {
      QuoteNumber: `Q-${String(quote_id).slice(0, 8).toUpperCase()}`,
      Contact: { ContactID: xeroContactId },
      Date: epochStr,
      LineItems: lineItems,
      CurrencyCode: "ZAR",
      Status: "DRAFT",
    };

    const quoteRes = await fetch(`${XERO_API}/Quotes`, {
      method: "POST",
      headers: xeroHeaders,
      body: JSON.stringify(xeroQuoteBody),
    });
    if (!quoteRes.ok) {
      return json({ error: `Xero quote create failed: ${await quoteRes.text()}` }, 502);
    }
    const quoteData = await quoteRes.json();
    const xeroQuoteId = quoteData?.Quotes?.[0]?.QuoteID ?? null;
    if (!xeroQuoteId) return json({ error: "Xero did not return a QuoteID" }, 502);

    // Persist Xero quote ID.
    await supabase
      .from("quotes")
      .update({ xero_quote_id: xeroQuoteId })
      .eq("id", quote_id);

    return json({ xero_quote_id: xeroQuoteId });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/** Fetch the first tenant ID from Xero connections endpoint. */
async function getXeroTenantId(accessToken: string): Promise<string> {
  const res = await fetch("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Xero connections failed: ${await res.text()}`);
  const conns = await res.json();
  const tenantId = conns?.[0]?.tenantId;
  if (!tenantId) throw new Error("No Xero tenant found. Please reconnect.");
  return tenantId;
}
