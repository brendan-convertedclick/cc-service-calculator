import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { CLICKUP_WORKSPACE_ID } from "../_shared/clickup-chat.ts";

interface ClickUpChatChannel {
  id: string;
  name?: string;
  type?: string;
}

interface ClickUpChatChannelsResponse {
  data?: ClickUpChatChannel[];
  next_cursor?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    const channels: ClickUpChatChannel[] = [];
    let cursor: string | undefined;
    const MAX_PAGES = 10;

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(
        `https://api.clickup.com/api/v3/workspaces/${CLICKUP_WORKSPACE_ID}/chat/channels`,
      );
      if (cursor) url.searchParams.set("cursor", cursor);

      const res = await fetch(url, {
        headers: { Authorization: clickupPat, "Content-Type": "application/json" },
      });
      if (!res.ok) return json({ error: `ClickUp ${res.status}: ${await res.text()}` }, 502);

      const body: ClickUpChatChannelsResponse = await res.json();
      channels.push(...(body.data ?? []));

      if (!body.next_cursor) break;
      cursor = body.next_cursor;
    }

    const result = channels
      .filter((c): c is ClickUpChatChannel & { name: string } => c.type === "CHANNEL" && !!c.name)
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return json({ channels: result });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
