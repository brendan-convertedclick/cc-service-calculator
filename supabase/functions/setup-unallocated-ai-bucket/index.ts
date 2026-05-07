// supabase/functions/setup-unallocated-ai-bucket/index.ts
//
// One-shot setup for the "Converted-Click :: Unallocated AI" bucket task.
// The Stop hook posts AI usage to this task whenever it can't resolve a
// project (no .cc-project file, no git remote match).
//
// Two invocation modes:
//   POST { list_id: string }
//     → creates the bucket task in that ClickUp list, initialises the 4 AI
//       custom fields to 0, stores the task_id in settings, returns it.
//
//   POST { task_id: string }
//     → uses an existing task (you may have created it manually); just
//       stores its id in settings.
//
// Idempotent: if settings.unallocated_ai_clickup_task_id is already set
// AND the existing task still exists, returns the existing one without
// creating a duplicate. Pass { force: true } to override.
//
// Preconditions: settings.clickup_enabled=true, CLICKUP_PAT secret set.
//
// Response: 200 { task_id, task_url, created: boolean }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";
import { findCustomField } from "../_shared/clickup.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const { list_id, task_id, force } = body as {
      list_id?: string;
      task_id?: string;
      force?: boolean;
    };
    if (!list_id && !task_id) {
      return json({ error: "Provide list_id (to create) or task_id (to link existing)" }, 400);
    }

    const supabase = createUserClient(req);
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    const { data: settings } = await supabase
      .from("settings").select("*").eq("id", 1).single();
    if (!settings?.clickup_enabled) return json({ error: "ClickUp disabled in settings" }, 400);

    const CU = {
      headers: {
        Authorization: clickupPat,
        "Content-Type": "application/json",
      },
    };

    // Idempotency: if there's already a bucket task pointed at, verify it
    // still exists and reuse unless force=true.
    const existing = settings.unallocated_ai_clickup_task_id;
    if (existing && !force) {
      const checkRes = await fetch(`https://api.clickup.com/api/v2/task/${existing}`, CU);
      if (checkRes.ok) {
        const t = await checkRes.json();
        return json({
          task_id: existing,
          task_url: t.url,
          created: false,
          message: "Existing bucket task still valid — reused",
        });
      }
      // 404 etc — fall through and create a fresh one
    }

    // Mode 1: link to an existing task
    if (task_id) {
      const checkRes = await fetch(`https://api.clickup.com/api/v2/task/${task_id}`, CU);
      if (!checkRes.ok) {
        return json({ error: `Task ${task_id} not found in ClickUp: ${await checkRes.text()}` }, 404);
      }
      const t = await checkRes.json();
      const { error: sErr } = await supabase
        .from("settings")
        .update({ unallocated_ai_clickup_task_id: task_id })
        .eq("id", 1);
      if (sErr) return json({ error: sErr.message }, 500);
      return json({ task_id, task_url: t.url, created: false });
    }

    // Mode 2: create a fresh bucket task in the given list
    type CuField = {
      id: string;
      name: string;
      type: string;
      type_config?: { options?: Array<{ id: string; name: string }> };
    };
    let cuFields: CuField[] = [];
    const fieldsRes = await fetch(
      `https://api.clickup.com/api/v2/list/${list_id}/field`,
      CU,
    );
    if (fieldsRes.ok) {
      cuFields = (await fieldsRes.json()).fields ?? [];
    }

    const createRes = await fetch(
      `https://api.clickup.com/api/v2/list/${list_id}/task`,
      {
        ...CU,
        method: "POST",
        body: JSON.stringify({
          name: "Converted-Click :: Unallocated AI",
          description:
            "Catch-all for Claude Code sessions where the SessionStart hook " +
            "couldn't resolve a project (no .cc-project file, no git remote " +
            "match). Tokens accumulate here for weekly manual reconciliation.",
        }),
      },
    );
    if (!createRes.ok) {
      return json({ error: `CU create task: ${await createRes.text()}` }, 502);
    }
    const created = await createRes.json();

    // Initialise the 4 AI custom fields to 0 so the Stop hook's first
    // PATCH succeeds. Same pattern as push-to-clickup. Missing fields are
    // logged but not fatal — the Stop hook will surface the missing field
    // if and when it tries to update.
    for (const fname of [
      "AI Input Tokens",
      "AI Output Tokens",
      "AI Cost ZAR",
      "AI Duration Minutes",
    ]) {
      const f = findCustomField(cuFields, fname);
      if (!f) {
        console.warn(`Custom field "${fname}" not on list ${list_id} — Stop hook will fail until added`);
        continue;
      }
      const cfRes = await fetch(
        `https://api.clickup.com/api/v2/task/${created.id}/field/${f.id}`,
        { ...CU, method: "POST", body: JSON.stringify({ value: 0 }) },
      );
      if (!cfRes.ok) {
        console.warn(`Init ${fname} on bucket task: ${await cfRes.text()}`);
      }
    }

    const { error: sErr } = await supabase
      .from("settings")
      .update({ unallocated_ai_clickup_task_id: created.id })
      .eq("id", 1);
    if (sErr) return json({ error: sErr.message }, 500);

    return json({
      task_id: created.id,
      task_url: created.url,
      created: true,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
