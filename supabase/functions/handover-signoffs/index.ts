// supabase/functions/handover-signoffs/index.ts
//
// Request:  POST {}                    scan every briefed task in "send to client"
//           POST { task_id: string }   just this one (clickup-webhook's path)
// Response: 200 { checked, drafted, bounced, skipped, errors }
//
// Turns the doer's hand-over into a sign-off draft (0204). For each briefed
// task that ClickUp says — LIVE, not from the 30-minute sync — is in "send to
// client":
//   1. gate it (_shared/handover.ts): a closing comment and proof, or it goes
//      back to the doer with a comment saying what is missing;
//   2. copy the proof files into the private signoff-proof bucket;
//   3. insert a PARKED client_approvals row: off the client's page and off
//      every clock until someone presses Send on /client-signoffs;
//   4. ping the Approvals channel so somebody does.
//
// Idempotent: a brief with an open (parked or pending) sign-off is skipped,
// and the partial unique index client_approvals_one_open_handover backs that
// up if the cron and the webhook race. Safe to call unauthenticated, like the
// other cron functions: all it can do is run this same scan.
//
// Deploy with --no-verify-jwt (cron and webhook carry no JWT).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { APP_URL, cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { cuFetch } from "../_shared/clickup.ts";
import { APPROVALS_CHANNEL_ID, mentionToken, postChatMessage } from "../_shared/clickup-chat.ts";
import { suggestClientTitle, UNTITLED_WORK } from "../_shared/client-title.ts";
import {
  bounceComment,
  bounceStatus,
  type CuAttachment,
  type CuComment,
  gate,
  storageName,
} from "../_shared/handover.ts";

const CU = "https://api.clickup.com/api/v2";
const HANDOVER_STATUS = "send to client";
const SCAN_LIMIT = 25;

type BriefRow = {
  id: string;
  client_id: string;
  clickup_task_id: string;
  raw_subject: string | null;
  clients: { name: string } | { name: string }[] | null;
};

type CuTask = {
  id: string;
  name?: string;
  url?: string;
  status?: { status?: string };
  list?: { id?: string };
  assignees?: { id?: number; username?: string }[];
  attachments?: CuAttachment[];
};

type Outcome = "drafted" | "bounced" | "skipped";

async function cu<T>(pat: string, path: string, init?: RequestInit): Promise<T> {
  const res = await cuFetch(`${CU}${path}`, {
    ...init,
    headers: { Authorization: pat, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`ClickUp ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

const companyOf = (b: BriefRow) => (Array.isArray(b.clients) ? b.clients[0]?.name : b.clients?.name) ?? "";

async function handOver(sb: SupabaseClient, pat: string, brief: BriefRow): Promise<Outcome> {
  // An open sign-off already exists — nothing to do, whoever drafted it.
  const { data: open } = await sb
    .from("client_approvals")
    .select("id")
    .eq("brief_id", brief.id)
    .in("state", ["parked", "pending"])
    .limit(1);
  if (open?.length) return "skipped";

  const task = await cu<CuTask>(pat, `/task/${encodeURIComponent(brief.clickup_task_id)}`);
  // Live status, not the synced copy: a bounced task must not bounce twice.
  if ((task.status?.status ?? "").toLowerCase() !== HANDOVER_STATUS) return "skipped";

  // Only what happened since the client last decided on this brief counts.
  const { data: last } = await sb
    .from("client_approvals")
    .select("decided_at")
    .eq("brief_id", brief.id)
    .not("decided_at", "is", null)
    .order("decided_at", { ascending: false })
    .limit(1);
  const since = last?.[0]?.decided_at ? Date.parse(last[0].decided_at as string) : 0;

  const { comments } = await cu<{ comments: CuComment[] }>(pat, `/task/${encodeURIComponent(task.id)}/comment`);
  const verdict = gate(comments ?? [], task.attachments ?? [], since);

  const doers = task.assignees ?? [];
  const who = doers.length
    ? doers.map((a) => mentionToken({ clickupUserId: a.id, name: a.username })).join(" ")
    : "team";
  const taskName = task.name ?? brief.raw_subject ?? "a task";
  const taskUrl = task.url ?? `https://app.clickup.com/t/${task.id}`;

  if (!verdict.ok) {
    // Back to the doer. The status first, so that if the comment fails the
    // task at least stops sitting in "send to client" charging the client.
    try {
      const list = task.list?.id
        ? await cu<{ statuses?: { status: string; type?: string; orderindex?: number }[] }>(pat, `/list/${task.list.id}`)
        : { statuses: [] };
      const back = bounceStatus(list.statuses ?? []);
      if (back) await cu(pat, `/task/${encodeURIComponent(task.id)}`, { method: "PUT", body: JSON.stringify({ status: back }) });
    } catch (e) {
      console.error("[handover] bounce status failed:", e instanceof Error ? e.message : e);
    }
    await cu(pat, `/task/${encodeURIComponent(task.id)}/comment`, {
      method: "POST",
      body: JSON.stringify({ comment_text: bounceComment(verdict.missing), notify_all: true }),
    }).catch((e) => console.error("[handover] bounce comment failed:", e instanceof Error ? e.message : e));
    await postChatMessage(
      pat,
      APPROVALS_CHANNEL_ID,
      `↩️ ${who} — [${taskName}](${taskUrl}) went to "send to client" without ${
        verdict.missing.map((m) => (m === "comment" ? "a closing comment" : "proof")).join(" or ")
      }, so it's back with you. The task says what to add.`,
    );
    return "bounced";
  }

  // The approval row's id names the proof folder, so mint it here.
  const approvalId = crypto.randomUUID();
  const proof: { name: string; path: string; mime: string; size: number }[] = [];
  for (const [i, a] of verdict.files.entries()) {
    try {
      const res = await fetch(a.url!, { headers: { Authorization: pat } });
      if (!res.ok) throw new Error(`download ${res.status}`);
      const blob = await res.blob();
      const name = a.title || `file-${i + 1}${a.extension ? "." + a.extension : ""}`;
      const mime = a.mimetype || blob.type || "application/octet-stream";
      const path = `${brief.client_id}/${approvalId}/${storageName(name, i)}`;
      const { error } = await sb.storage.from("signoff-proof").upload(path, blob, { contentType: mime, upsert: true });
      if (error) throw error;
      proof.push({ name, path, mime, size: blob.size });
    } catch (e) {
      console.error("[handover] proof copy failed:", a.title, e instanceof Error ? e.message : e);
    }
  }
  // Every file failed to copy and there was no link either: that is not proof
  // the client can open, so treat it as a hand-over still in progress rather
  // than draft an empty sign-off. The next run tries again.
  if (!proof.length && !verdict.links.length) return "skipped";

  const company = companyOf(brief);
  const { error: insErr } = await sb.from("client_approvals").insert({
    id: approvalId,
    client_id: brief.client_id,
    brief_id: brief.id,
    item_type: "brief",
    client_title: suggestClientTitle(taskName, company) || suggestClientTitle(brief.raw_subject, company) || UNTITLED_WORK,
    ask: "Here's what we did. Approve it, or tell us what to change.",
    detail: verdict.comment.text,
    links: verdict.links,
    proof,
    state: "parked",
    handed_over_at: new Date().toISOString(),
    handed_over_by: verdict.comment.author,
  });
  if (insErr) {
    // 23505 = the unique index: the other caller drafted it first.
    if ((insErr as { code?: string }).code === "23505") return "skipped";
    throw insErr;
  }

  await postChatMessage(
    pat,
    APPROVALS_CHANNEL_ID,
    `📦 ${verdict.comment.author} handed over [${taskName}](${taskUrl}) for ${company || "a client"} — ${
      proof.length
    } file${proof.length === 1 ? "" : "s"}, ${verdict.links.length} link${verdict.links.length === 1 ? "" : "s"}. Ready to send: ${APP_URL}/client-signoffs`,
  );
  return "drafted";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const pat = Deno.env.get("CLICKUP_PAT") ?? "";
  if (!pat) return json({ error: "CLICKUP_PAT not set" }, 500);
  let body: { task_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body = scan
  }

  const sb = createServiceRoleClient();
  const base = () =>
    sb
      .from("briefs")
      .select("id, client_id, clickup_task_id, raw_subject, clients(name)")
      .not("clickup_task_id", "is", null)
      .not("client_id", "is", null)
      .is("completed_at", null)
      .neq("status", "archived")
      .neq("billing_type", "internal");
  const { data, error } = body.task_id
    ? await base().eq("clickup_task_id", body.task_id).limit(1)
    : await base().ilike("clickup_task_status", HANDOVER_STATUS).limit(SCAN_LIMIT);
  if (error) return json({ error: error.message }, 500);

  const tally = { checked: 0, drafted: 0, bounced: 0, skipped: 0, errors: [] as string[] };
  for (const brief of (data ?? []) as unknown as BriefRow[]) {
    tally.checked++;
    try {
      tally[await handOver(sb, pat, brief)]++;
    } catch (e) {
      tally.errors.push(`${brief.clickup_task_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return json(tally);
});
