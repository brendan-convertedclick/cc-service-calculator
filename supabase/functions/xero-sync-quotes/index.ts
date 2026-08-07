// supabase/functions/xero-sync-quotes/index.ts
//
// Phase 1 of the Xero time->money connection.
//
// For every quote with a xero_quote_id (i.e. already pushed via
// push-to-xero), pulls its live Status/QuoteNumber from Xero and stores it.
// Then, for quotes Xero reports as ACCEPTED or INVOICED, best-effort links a
// synced xero_invoices row back to the quote: same client, closest total
// amount, invoice dated on/after the quote was sent. Xero has no native
// Quote->Invoice reference, so this is a heuristic — the match confidence is
// recorded on the invoice row rather than asserted as certain.
//
// Uses the xero_connection table (same store xero-sync/xero-oauth use), not
// settings.xero_oauth_tokens (push-to-xero's older store) — Xero refresh
// tokens are single-use, so whichever function refreshes first rotates the
// shared token and silently invalidates the other table's stale copy.
// xero_connection is the one xero-sync keeps live, so it's the reliable one.
//
// POST {} or GET — no request body required.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

const XERO_API = "https://api.xero.com/api.xro/2.0";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";

type XeroConnection = {
  id: string;
  tenant_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO timestamptz
};

async function refreshIfNeeded(
  conn: XeroConnection,
  clientId: string,
  clientSecret: string,
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<string> {
  const expiresAt = new Date(conn.expires_at).getTime();
  const now = Date.now();
  if (expiresAt - now > 5 * 60 * 1000) return conn.access_token;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: conn.refresh_token,
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
  const fresh = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  const newExpiresAt = new Date(now + (fresh.expires_in ?? 1800) * 1000).toISOString();
  await supabase
    .from("xero_connection")
    .update({
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conn.id);
  return fresh.access_token;
}

type QuoteRow = {
  id: string;
  xero_quote_id: string;
  total_cents: number;
  sent_at: string | null;
  scope: { brief: { client_id: string | null } | null } | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });

  try {
    const clientId = Deno.env.get("XERO_CLIENT_ID");
    const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      return json({ error: "XERO_CLIENT_ID / XERO_CLIENT_SECRET secrets not configured" }, 500);
    }

    const supabase = createServiceRoleClient();

    const { data: conn, error: connErr } = await supabase
      .from("xero_connection")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    if (connErr || !conn) {
      return json({ error: "Xero not connected. Visit Settings to connect." }, 400);
    }

    const accessToken = await refreshIfNeeded(conn as XeroConnection, clientId, clientSecret, supabase);
    const xeroHeaders = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Xero-Tenant-Id": (conn as XeroConnection).tenant_id,
    };

    const { data: quotesRaw, error: qErr } = await supabase
      .from("quotes")
      .select("id, xero_quote_id, total_cents, sent_at, scope:scopes(brief:briefs(client_id))")
      .not("xero_quote_id", "is", null);
    if (qErr) return json({ error: qErr.message }, 500);

    const quotes = (quotesRaw ?? []) as unknown as QuoteRow[];
    if (quotes.length === 0) {
      return json({ synced: 0, linked: 0, message: "No pushed quotes to sync." });
    }

    let synced = 0;
    let linked = 0;
    const errors: string[] = [];

    for (const q of quotes) {
      try {
        const res = await fetch(`${XERO_API}/Quotes/${q.xero_quote_id}`, { headers: xeroHeaders });
        if (!res.ok) {
          errors.push(`${q.id}: Xero ${res.status} ${await res.text()}`);
          continue;
        }
        const body = await res.json() as {
          Quotes?: Array<{ Status: string; QuoteNumber?: string }>;
        };
        const xq = body.Quotes?.[0];
        if (!xq) {
          errors.push(`${q.id}: Xero returned no quote for ${q.xero_quote_id}`);
          continue;
        }

        await supabase
          .from("quotes")
          .update({ xero_quote_status: xq.Status, xero_quote_number: xq.QuoteNumber ?? null })
          .eq("id", q.id);
        synced++;

        if (xq.Status !== "ACCEPTED" && xq.Status !== "INVOICED") continue;

        const clientIdForQuote = q.scope?.brief?.client_id;
        if (!clientIdForQuote) continue;

        // Best-effort link: same client, unmatched invoice, closest total —
        // within 1% (min R1) tolerance so currency rounding doesn't block it.
        const { data: candidates } = await supabase
          .from("xero_invoices")
          .select("id, amount_cents, due_date")
          .eq("client_id", clientIdForQuote)
          .is("quote_id", null);

        const tolerance = Math.max(100, Math.round(q.total_cents * 0.01));
        const sentDate = q.sent_at ? new Date(q.sent_at) : null;
        const withinDate = (due: string | null) =>
          !sentDate || !due || new Date(due) >= sentDate;

        const best = (candidates ?? [])
          .filter((c) => withinDate(c.due_date))
          .map((c) => ({ ...c, delta: Math.abs(c.amount_cents - q.total_cents) }))
          .filter((c) => c.delta <= tolerance)
          .sort((a, b) => a.delta - b.delta)[0];

        if (best) {
          await supabase
            .from("xero_invoices")
            .update({
              quote_id: q.id,
              quote_match_confidence: best.delta === 0 ? "exact_amount" : "closest_amount",
            })
            .eq("id", best.id);
          linked++;
        }
      } catch (e) {
        errors.push(`${q.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return json({ synced, linked, errors: errors.length ? errors : undefined });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
