// supabase/functions/provision-client-wiki/index.ts
//
// Request:  POST { client_name: string; wiki_path: string }
// Response: 200 { created: boolean }
//
// Fire-and-forget from useCreateClient — creates wiki/clients/<slug>/index.md
// in the private GitHub CC-Vault repo. 409 (file exists) is a silent no-op.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";

const WIKI_REPO = Deno.env.get("WIKI_GITHUB_REPO") ?? "";
const WIKI_PAT  = Deno.env.get("WIKI_GITHUB_PAT")  ?? "";

function starterTemplate(name: string): string {
  return [
    "---",
    `type: client`,
    `title: "${name}"`,
    `created: ${new Date().toISOString().slice(0, 10)}`,
    `status: active`,
    `tags: [client]`,
    "---",
    "",
    `# ${name}`,
    "",
    "## About",
    "",
    "## Brand",
    "",
    "## Decisions",
    "",
  ].join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!WIKI_REPO || !WIKI_PAT) return json({ error: "WIKI secrets not configured" }, 503);

  try {
    const supabase = createUserClient(req);
    const { error: authErr } = await supabase.auth.getUser();
    if (authErr) return json({ error: "Unauthorized" }, 401);

    const { client_name, wiki_path } = await req.json();
    if (!client_name || !wiki_path) {
      return json({ error: "client_name and wiki_path required" }, 400);
    }

    const filePath = `${wiki_path}/index.md`;
    const content = starterTemplate(client_name);
    const encoded = btoa(unescape(encodeURIComponent(content)));

    const safePath = filePath.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(
      `https://api.github.com/repos/${WIKI_REPO}/contents/${safePath}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${WIKI_PAT}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `chore: provision wiki for ${client_name}`,
          content: encoded,
        }),
      },
    );

    if (res.status === 422 || res.status === 409) {
      return json({ created: false });
    }
    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[provision-client-wiki] GitHub ${res.status}: ${errBody}`);
      return json({ error: "GitHub API error" }, 500);
    }

    return json({ created: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[provision-client-wiki] ${msg}`);
    return json({ error: msg }, 500);
  }
});
