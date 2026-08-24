// supabase/functions/notify-system-revision/index.ts
//
// Request:  POST { revision_id, event: "proposed" | "published" | "changes_requested" }
// Response: 200 { chat_ok: boolean }
//
// The Systems library's approval traffic, in the ⚙️ Systems ops channel:
// a revision sent for review, and the approve/decline that answers it.
// Best-effort throughout — the caller fires this and forgets, so a chat
// failure can never sink a publish.
//
// `event` comes from the caller rather than being read off the row: by the
// time this runs the state has already moved, and "published" and
// "changes_requested" are both reached from 'proposed'.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient, createUserClient } from "../_shared/supabase-client.ts";
import { postChatMessage, mentionToken, SYSTEMS_CHANNEL_ID } from "../_shared/clickup-chat.ts";
import { getOperatorClickupToken } from "../_shared/clickup-token.ts";

const APP_URL = "https://conductor.convertedclick.co.za";

type Event = "proposed" | "published" | "changes_requested";
const EVENTS: Event[] = ["proposed", "published", "changes_requested"];

type Member = { full_name: string; clickup_user_id: number | null };

// system_kind → what the team calls it. Mirrors systemLayer() +
// SYSTEM_LAYER_NOUN in src/hooks/useSystemDefinitions.ts; the four attachment
// kinds are all procedures.
function layerNoun(kind: string): string {
  return kind === "policy" || kind === "process" ? kind : "procedure";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { revision_id, event } = (await req.json()) as { revision_id?: string; event?: Event };
    if (!revision_id) return json({ error: "revision_id required" }, 400);
    if (!event || !EVENTS.includes(event)) {
      return json({ error: `event must be one of ${EVENTS.join(", ")}` }, 400);
    }

    const sb = createServiceRoleClient();

    const { data: revRaw, error: revErr } = await sb
      .from("system_revisions")
      .select("id, system_id, revision, reason_for_change, proposed_by")
      .eq("id", revision_id)
      .single();
    if (revErr || !revRaw) return json({ error: revErr?.message ?? "Revision not found" }, 404);
    const rev = revRaw as unknown as {
      system_id: string;
      revision: number;
      reason_for_change: string | null;
      proposed_by: string | null;
    };

    const { data: sysRaw, error: sysErr } = await sb
      .from("system_definitions")
      .select("name, kind, owner_id")
      .eq("id", rev.system_id)
      .single();
    if (sysErr || !sysRaw) return json({ error: sysErr?.message ?? "System not found" }, 404);
    const sys = sysRaw as unknown as { name: string; kind: string; owner_id: string | null };

    const noun = layerNoun(sys.kind);
    const what = `"${sys.name}" rev ${rev.revision}`;
    const link = `${APP_URL}/systems/${rev.system_id}`;

    // proposed_by is nullable — the shared team@ login resolves currentUserId
    // to null, so both the mention and the "sent by" degrade to nothing.
    const { data: proposerRaw } = rev.proposed_by
      ? await sb.from("team_members").select("full_name, clickup_user_id").eq("id", rev.proposed_by).single()
      : { data: null };
    const proposer = proposerRaw as Member | null;

    let content: string;
    if (event === "proposed") {
      // The people actually being asked, named in the Send-for-review dialog.
      const { data: approvalRows } = await sb
        .from("system_revision_approvals")
        .select("team_member_id")
        .eq("revision_id", revision_id)
        .eq("required", true);
      const memberIds = ((approvalRows ?? []) as { team_member_id: string }[]).map((r) => r.team_member_id);
      const { data: namedRaw } = memberIds.length
        ? await sb.from("team_members").select("full_name, clickup_user_id").in("id", memberIds)
        : { data: null };
      const named = (namedRaw ?? []) as Member[];

      // Revisions proposed before the dialog required a reviewer have no rows
      // at all — fall back to everyone who could approve. Publishing is gated
      // on admin-or-owner (publish_system_revision), so both roles, not admin
      // alone.
      const { data: fallbackRaw } = named.length
        ? { data: null }
        : await sb
          .from("team_members")
          .select("full_name, clickup_user_id")
          .in("role", ["admin", "owner"])
          .is("archived_at", null);
      const recipients = named.length ? named : ((fallbackRaw ?? []) as Member[]);
      const mentions = recipients
        .map((a) => mentionToken({ clickupUserId: a.clickup_user_id, name: a.full_name }))
        .join(" ");
      const by = proposer ? ` by ${proposer.full_name}` : "";
      const reason = rev.reason_for_change ? `\n> ${rev.reason_for_change}` : "";
      content = `📋 ${mentions || "team"} — ${noun} review requested${by}: ${what}${reason}\n${link}`;
    } else {
      // Both the person who sent it and the person accountable for the
      // procedure (system_definitions.owner_id) — often not the same person,
      // and the owner is the one who has to act on a decline. Deduped when
      // they are, and either can be missing (team@ resolves to no member).
      const { data: ownerRaw } = sys.owner_id && sys.owner_id !== rev.proposed_by
        ? await sb.from("team_members").select("full_name, clickup_user_id").eq("id", sys.owner_id).single()
        : { data: null };
      const mention = [proposer, ownerRaw as Member | null]
        .filter((m): m is Member => !!m)
        .map((m) => mentionToken({ clickupUserId: m.clickup_user_id, name: m.full_name }))
        .join(" ") || "team";
      // Who acted. team@ has no team_members row, so this is often absent.
      const callerEmail = (await createUserClient(req).auth.getUser()).data.user?.email ?? "";
      const { data: actorRaw } = callerEmail
        ? await sb.from("team_members").select("full_name").eq("email", callerEmail).maybeSingle()
        : { data: null };
      const actor = (actorRaw as { full_name: string } | null)?.full_name;
      const by = actor ? ` by ${actor}` : "";
      content = event === "published"
        ? `✅ ${mention} — ${noun} approved${by}: ${what}\n${link}`
        : `↩️ ${mention} — changes requested${by} on ${what}. Read the notes; the fix goes out as the next revision.\n${link}`;
    }

    const { token: clickupPat } = await getOperatorClickupToken(req);
    const chatResult = await postChatMessage(clickupPat, SYSTEMS_CHANNEL_ID, content);

    return json({ chat_ok: chatResult.ok, chat_error: chatResult.ok ? undefined : chatResult.error });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
