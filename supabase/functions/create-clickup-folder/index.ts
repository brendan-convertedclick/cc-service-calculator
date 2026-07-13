import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";
import { getOperatorClickupToken } from "../_shared/clickup-token.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { name } = await req.json().catch(() => ({}));
    if (!name || typeof name !== "string") {
      return json({ error: "name required" }, 400);
    }

    const supabase = createUserClient(req);
    const { token: clickupPat, via } = await getOperatorClickupToken(req);
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    const { data: settings } = await supabase
      .from("settings").select("clickup_clients_space_id").eq("id", 1).single();
    if (!settings?.clickup_clients_space_id) {
      return json({ error: "Clients space not configured in Settings" }, 400);
    }

    const res = await fetch(
      `https://api.clickup.com/api/v2/space/${settings.clickup_clients_space_id}/folder`,
      {
        method: "POST",
        headers: { Authorization: clickupPat, "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      },
    );
    if (!res.ok) return json({ error: `ClickUp ${res.status}: ${await res.text()}` }, 502);

    const body = await res.json();
    return json({ id: String(body.id), name: body.name ?? name, via });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
