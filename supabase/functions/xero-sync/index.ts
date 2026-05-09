// supabase/functions/xero-sync/index.ts
//
// Fetches AUTHORISED and PAID invoices from Xero and upserts into xero_invoices.
// After upsert, auto-links client_id by matching xero_contact_name → clients.name
// (case-insensitive).
//
// Uses xero_connection table for OAuth tokens. Refreshes if < 5 min remaining.
//
// POST {} or GET — no request body required.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, cors } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

const XERO_API = "https://api.xero.com/api.xro/2.0";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";

type XeroConnection = {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
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
  const fiveMin = 5 * 60 * 1000;

  if (expiresAt - now > fiveMin) {
    return conn.access_token;
  }

  // Refresh
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

  const fresh = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });

  try {
    const clientId = Deno.env.get("XERO_CLIENT_ID");
    const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      return json({ error: "XERO_CLIENT_ID / XERO_CLIENT_SECRET secrets not configured" }, 500);
    }

    const supabase = createServiceRoleClient();

    // Load connection row
    const { data: conn, error: connErr } = await supabase
      .from("xero_connection")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (connErr || !conn) {
      return json({ error: "Xero not connected. Visit Settings to connect." }, 400);
    }

    const accessToken = await refreshIfNeeded(
      conn as XeroConnection,
      clientId,
      clientSecret,
      supabase,
    );

    // Find last sync time for incremental fetch
    const { data: lastRow } = await supabase
      .from("xero_invoices")
      .select("synced_at")
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const modifiedAfter = lastRow?.synced_at
      ? new Date(lastRow.synced_at).toISOString()
      : "2020-01-01T00:00:00Z";

    // Fetch invoices from Xero
    const invoicesUrl = new URL(`${XERO_API}/Invoices`);
    invoicesUrl.searchParams.set("Statuses", "AUTHORISED,PAID");
    invoicesUrl.searchParams.set("ModifiedAfter", modifiedAfter);
    invoicesUrl.searchParams.set("page", "1");

    const xeroRes = await fetch(invoicesUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-Tenant-Id": (conn as XeroConnection).tenant_id,
        Accept: "application/json",
      },
    });

    if (!xeroRes.ok) {
      const text = await xeroRes.text();
      return json({ error: `Xero API error: ${text}` }, 502);
    }

    const xeroData = await xeroRes.json() as {
      Invoices?: Array<{
        InvoiceID: string;
        InvoiceNumber?: string;
        Status: string;
        Contact: { ContactID: string; Name: string };
        Total: number;
        DueDateString?: string;
        FullyPaidOnDate?: string;
      }>;
    };

    const invoices = xeroData.Invoices ?? [];
    if (invoices.length === 0) {
      return json({ synced: 0, message: "No new invoices to sync." });
    }

    // Build upsert rows
    const now = new Date().toISOString();
    const rows = invoices.map((inv) => ({
      xero_invoice_id: inv.InvoiceID,
      xero_contact_id: inv.Contact.ContactID,
      xero_contact_name: inv.Contact.Name,
      status: inv.Status as "AUTHORISED" | "PAID",
      amount_cents: Math.round(inv.Total * 100),
      due_date: inv.DueDateString ?? null,
      paid_at: inv.FullyPaidOnDate ?? null,
      invoice_number: inv.InvoiceNumber ?? null,
      synced_at: now,
    }));

    const { error: upsertErr } = await supabase
      .from("xero_invoices")
      .upsert(rows, { onConflict: "xero_invoice_id" });

    if (upsertErr) return json({ error: upsertErr.message }, 500);

    // Auto-link client_id: match xero_contact_name to clients.name case-insensitively
    const contactNames = [...new Set(rows.map((r) => r.xero_contact_name))];
    if (contactNames.length > 0) {
      const { data: clients } = await supabase
        .from("clients")
        .select("id, name")
        .is("archived_at", null);

      for (const contactName of contactNames) {
        const matched = (clients ?? []).find(
          (c) => c.name.toLowerCase() === contactName.toLowerCase(),
        );
        if (matched) {
          await supabase
            .from("xero_invoices")
            .update({ client_id: matched.id })
            .eq("xero_contact_name", contactName)
            .is("client_id", null);
        }
      }
    }

    return json({ synced: rows.length, message: `Synced ${rows.length} invoice(s).` });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
