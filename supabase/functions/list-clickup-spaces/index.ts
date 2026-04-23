import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const supabase = createUserClient(req);
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    const { data: settings } = await supabase
      .from("settings").select("clickup_workspace_id").eq("id", 1).single();
    if (!settings?.clickup_workspace_id) {
      return json({ error: "Workspace ID not configured in Settings" }, 400);
    }

    const res = await fetch(
      `https://api.clickup.com/api/v2/team/${settings.clickup_workspace_id}/space`,
      { headers: { Authorization: clickupPat, "Content-Type": "application/json" } },
    );
    if (!res.ok) return json({ error: `ClickUp ${res.status}: ${await res.text()}` }, 502);

    const body = await res.json();
    const spaces = (body.spaces ?? [])
      .map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));

    return json({ spaces });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
