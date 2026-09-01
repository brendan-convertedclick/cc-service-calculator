// supabase/functions/approve-staff-brief/index.ts
//
// Request:  POST { staff_brief_id: string }
// Response: 200 { clickup_task_id, clickup_task_url }
//          | 400 { error } | 403 { error } | 502 { error }
//
// Approves a staff-authored brief and creates the corresponding ClickUp
// task on the requested list. Assigns to the submitter, sets sprint points,
// fills standard custom fields, posts a BRIEF:: audit comment. Idempotent:
// re-approving a brief that already has a clickup_task_id is a no-op success.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";
import { getOperatorClickupToken } from "../_shared/clickup-token.ts";
import { addClickupChecklist, buildBriefComment, buildBriefTaskBody } from "../_shared/clickup.ts";
import { renderDocLinks } from "../_shared/system-materialise.ts";
import { postChatMessage, mentionToken, approvalsChannel, CONVERTED_CLICK_CHANNEL_ID } from "../_shared/clickup-chat.ts";

type StaffBrief = {
  id: string;
  submitter_id: string;
  client_id: string;
  clickup_list_id: string;
  clickup_list_name: string;
  task_name: string;
  sprint_points: number;
  is_internal: boolean;
  goal: string;
  success_criteria: string;
  measurable_outcome: string;
  status: string;
  system_id: string | null;
  project_id: string | null;
  clickup_task_id: string | null;
  clickup_task_url: string | null;
};

type Member = {
  id: string;
  full_name: string;
  email: string | null;
  clickup_user_id: number | null;
  role: string;
};

type Client = { id: string; name: string; clickup_client_name: string | null; clickup_chat_channel_id: string | null };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { staff_brief_id, project_id, billing } = (await req.json()) as {
      staff_brief_id?: string;
      project_id?: string | null;
      billing?: "retainer" | "adhoc" | "internal";
    };
    if (!staff_brief_id) return json({ error: "staff_brief_id required" }, 400);

    const supabase = createUserClient(req);
    const { token: clickupPat, via } = await getOperatorClickupToken(req);
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    // Caller must be admin or owner.
    const { data: caller } = await supabase
      .from("team_members")
      .select("id, role, email")
      .eq("email", (await supabase.auth.getUser()).data.user?.email ?? "")
      .maybeSingle();
    const callerRole = (caller as { role?: string } | null)?.role;
    if (!callerRole || (callerRole !== "admin" && callerRole !== "owner")) {
      return json({ error: "Forbidden — admin or owner role required" }, 403);
    }
    const approverId = (caller as { id: string }).id;

    const { data: briefRaw, error: briefErr } = await supabase
      .from("staff_briefs")
      .select("*")
      .eq("id", staff_brief_id)
      .single();
    if (briefErr || !briefRaw) return json({ error: briefErr?.message ?? "Not found" }, 404);
    const brief = briefRaw as unknown as StaffBrief;

    // Idempotency
    if (brief.status === "approved" && brief.clickup_task_id) {
      return json({
        clickup_task_id: brief.clickup_task_id,
        clickup_task_url: brief.clickup_task_url,
        already_approved: true,
      });
    }
    if (brief.status === "rejected") {
      return json({ error: "Brief was already rejected" }, 400);
    }

    // Allocation is enforced here rather than on the staff form: the submitter
    // is rarely the person who knows whether this is retainer work or something
    // to invoice.
    //
    // Work has three honest destinations, not one. Requiring a retainer meant a
    // client with none — an internal one, or a client whose extra work is
    // deliberately billed ad hoc — had briefs that could never be approved.
    const allocatedProjectId = project_id ?? brief.project_id ?? null;
    const destination = billing ?? (brief.is_internal ? "internal" : allocatedProjectId ? "retainer" : null);
    if (!destination) {
      return json({
        error: "Say where this belongs — a retainer, adhoc to invoice, or internal.",
      }, 400);
    }
    if (destination === "retainer" && !allocatedProjectId) {
      return json({ error: "Pick the retainer this is delivered against." }, 400);
    }
    // Only retainer work carries a project; the other two are deliberately
    // unattached, which is what makes them visible as off-retainer work.
    const projectForBrief = destination === "retainer" ? allocatedProjectId : null;

    const { data: submitter, error: subErr } = await supabase
      .from("team_members")
      .select("id, full_name, email, clickup_user_id, role")
      .eq("id", brief.submitter_id)
      .single();
    if (subErr || !submitter) return json({ error: "Submitter not found" }, 400);
    const member = submitter as unknown as Member;

    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, name, clickup_client_name, clickup_chat_channel_id")
      .eq("id", brief.client_id)
      .single();
    if (clientErr || !client) return json({ error: "Client not found" }, 400);
    const cli = client as Client;

    const CU = {
      headers: { Authorization: clickupPat, "Content-Type": "application/json" },
    };

    // Load custom field defs for the list.
    const fieldsRes = await fetch(
      `https://api.clickup.com/api/v2/list/${brief.clickup_list_id}/field`,
      CU,
    );
    if (!fieldsRes.ok) {
      return json({ error: `ClickUp fields ${fieldsRes.status}: ${await fieldsRes.text()}` }, 502);
    }
    const fieldsBody = (await fieldsRes.json()) as {
      fields?: Array<{ id: string; name: string; type: string }>;
    };
    const cuFields = fieldsBody.fields ?? [];

    const dateOfEngagement = new Date().toISOString().slice(0, 10);
    const engagementType = brief.is_internal ? "Task" : "Project";
    const workStream = brief.clickup_list_name;

    // The chosen system's reference documents (0129), so the person doing the
    // work opens them from the ClickUp task. Any kind qualifies — this is the
    // one push path a kind='process' system can reach, since WorkflowSelect
    // offers anything with steps and a process's blocks all materialise as
    // 'none' (so the checklist below comes out empty but the task still ships).
    // Best-effort: a brief must not fail to approve because a doc list didn't
    // load.
    let docLinks: string[] = [];
    if (brief.system_id) {
      const { data: sys, error: sysErr } = await supabase
        .from("system_definitions")
        .select("doc_links")
        .eq("id", brief.system_id)
        .maybeSingle();
      if (sysErr) {
        console.error(`[approve-staff-brief] doc_links lookup failed for system ${brief.system_id}: ${sysErr.message}`);
      } else {
        docLinks = ((sys as { doc_links: string[] | null } | null)?.doc_links) ?? [];
      }
    }
    const docsSection = renderDocLinks(docLinks);

    // Compose description: the three answers, the reference docs, then an
    // audit footer.
    const description =
      `# ${brief.task_name}\n\n` +
      `**Goal**\n${brief.goal}\n\n` +
      `**What success looks like**\n${brief.success_criteria}\n\n` +
      `**Measurable outcome**\n${brief.measurable_outcome}\n\n` +
      (docsSection ? `${docsSection}\n\n` : "") +
      `---\n` +
      `_Phase 1 staff brief · submitted by ${member.full_name} · approved on ${dateOfEngagement}_`;

    // Compose the ClickUp create body (name, description, time_estimate,
    // custom_fields, optional assignees). Omits `status` — client spaces use
    // custom status sets, so hardcoding "to do" fails with CRTSK_001.
    const taskBody = buildBriefTaskBody(cuFields, {
      name: brief.task_name,
      description,
      clientName: cli.clickup_client_name ?? cli.name,
      workStream,
      engagementType,
      sprintPoints: brief.sprint_points,
      dateOfEngagement,
      assigneeClickupId: member.clickup_user_id,
      dueDateMs: null,
    });

    const taskUrl = `https://api.clickup.com/api/v2/list/${brief.clickup_list_id}/task`;
    let createRes = await fetch(taskUrl, { ...CU, method: "POST", body: JSON.stringify(taskBody) });
    // ClickUp rejects some sprint-point values on create (too large, or not on
    // the list's configured point scale — e.g. a fractional 7.5). Retry once
    // without `points` rather than fail the task (time_estimate still carries
    // the effort). See project note on the ClickUp points cap.
    if (!createRes.ok && "points" in taskBody) {
      const errText = await createRes.text();
      console.warn(`[approve-staff-brief] create failed with points (${createRes.status}: ${errText}); retrying without points`);
      const { points: _dropped, ...noPoints } = taskBody;
      createRes = await fetch(taskUrl, { ...CU, method: "POST", body: JSON.stringify(noPoints) });
    }
    if (!createRes.ok) {
      return json({ error: `ClickUp create ${createRes.status}: ${await createRes.text()}` }, 502);
    }
    const created = (await createRes.json()) as { id: string; url: string };

    // Workflow checklist: the chosen system's top-level process steps, in
    // order. Resolved now rather than at submit time so steps edited in
    // /systems while the brief waited still land on the task. Best-effort —
    // the task already exists, so a checklist failure must not fail approval.
    // ponytail: top-level steps only, flat; nest sub-steps if any get authored.
    if (brief.system_id) {
      try {
        const { data: steps, error: stepsErr } = await supabase
          .from("process_steps")
          .select("title")
          .eq("system_id", brief.system_id)
          .is("parent_id", null)
          .neq("materialise_as", "none") // decision nodes etc. never materialise
          .order("ordinal");
        if (stepsErr) throw new Error(stepsErr.message);
        await addClickupChecklist(
          clickupPat,
          created.id,
          ((steps ?? []) as { title: string }[]).map((s) => s.title),
          member.clickup_user_id,
        );
      } catch (checklistEx) {
        console.error(
          `[approve-staff-brief] checklist failed for task ${created.id} (system ${brief.system_id}): ${checklistEx instanceof Error ? checklistEx.message : String(checklistEx)}`,
        );
      }
    }

    // Audit comment so /brief skill conventions stay consistent.
    const comment = buildBriefComment({
      client_name: cli.name,
      engagement_type: engagementType,
      work_stream: workStream,
      sprint_points: brief.sprint_points,
      date_of_engagement: dateOfEngagement,
      source_quote_id: `staff_brief:${brief.id}`,
    });
    await fetch(`https://api.clickup.com/api/v2/task/${created.id}/comment`, {
      ...CU,
      method: "POST",
      body: JSON.stringify({ comment_text: comment, notify_all: false }),
    });

    // Confirm to the submitter in chat that their brief went through — same
    // client-channel routing as every other notify function (fallback to
    // Converted Click if the client has no channel mapped).
    const chatChannelId = approvalsChannel(cli.clickup_chat_channel_id ?? CONVERTED_CLICK_CHANNEL_ID);
    const mention = mentionToken({ clickupUserId: member.clickup_user_id, name: member.full_name });
    await postChatMessage(
      clickupPat,
      chatChannelId,
      `✅ ${mention} — your brief was approved: "${brief.task_name}" · ${brief.sprint_points}pt · ${created.url}`,
    );

    // Persist outcome.
    const { error: updateErr } = await supabase
      .from("staff_briefs")
      .update({
        status: "approved",
        approved_by: approverId,
        approved_at: new Date().toISOString(),
        clickup_task_id: created.id,
        clickup_task_url: created.url,
        project_id: projectForBrief,
      })
      .eq("id", brief.id);
    if (updateErr) {
      return json({
        error: `ClickUp task ${created.id} created but DB update failed: ${updateErr.message}`,
        clickup_task_id: created.id,
        clickup_task_url: created.url,
      }, 500);
    }

    // A staff brief that only exists in ClickUp is invisible to every report
    // Conductor draws. Mirroring it into briefs is what puts it on the
    // allocation view, and sync-clickup-actuals then tracks its closure and
    // actual points automatically, exactly as for a normal brief.
    const { error: mirrorErr } = await supabase.from("briefs").insert({
      client_id: brief.client_id,
      parent_project_id: projectForBrief,
      source: "manual",
      status: "briefed",
      raw_subject: brief.task_name,
      raw_body: brief.goal,
      original_points: brief.sprint_points,
      // internal is billed to nobody, but adhoc is what the invoice run reads.
      billing_type: destination === "retainer" ? "retainer" : "adhoc",
      clickup_task_id: created.id,
    });
    if (mirrorErr) {
      // Loud, not silent: a failed mirror means the work is in ClickUp and in no
      // report, which is the exact problem this insert exists to prevent.
      console.error(`[staff-brief] mirror into briefs FAILED for ${brief.id}: ${mirrorErr.message}`);
      return json({
        clickup_task_id: created.id,
        clickup_task_url: created.url,
        via,
        warning: `Task created, but it could not be recorded against the retainer: ${mirrorErr.message}`,
      });
    }

    return json({ clickup_task_id: created.id, clickup_task_url: created.url, via });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
