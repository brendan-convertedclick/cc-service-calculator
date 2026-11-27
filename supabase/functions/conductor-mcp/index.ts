// supabase/functions/conductor-mcp/index.ts
//
// Conductor as a remote MCP server, so claude.ai (and the Brief Team artifact
// running inside it) can add it as a connector. The laptop MCP in mcp-server/
// stays as it is for intake on Brendan's machine; this one is what a person
// signs in to from claude.ai, and it is deliberately small:
//
//   get-brief-context  who the sender is, their retainer month, open work,
//                      lists/work streams/tags, the team — everything the
//                      artifact needs to draft a good brief, in one call
//   brief-to-clickup   writes the brief into Conductor FIRST, then briefs it
//                      into ClickUp through create-quick-brief-task, so the
//                      task, its time and its retainer all hang off one row
//   list-tickets       briefed work that is done or on its way to sign-off
//   get-brief          one brief, its task and its sign-off, for a reply
//
// AUTH. No shared token. claude.ai signs the person in through Supabase Auth's
// OAuth 2.1 server (authorization server: <project>/auth/v1, consent screen:
// the SPA's /oauth/consent) and sends their access token here. Every query
// runs AS THAT PERSON through the anon key + their JWT, so RLS applies exactly
// as it does in the app, and a ClickUp write goes out under their own ClickUp
// token where they have one (getOperatorClickupToken). Only team_members may
// use it: a signed-in account with no live team_members row gets 403.
//
// An unauthenticated request gets 401 with a WWW-Authenticate header naming
// the protected-resource metadata below, which is how an MCP client discovers
// where to sign in (RFC 9728). Deploy with --no-verify-jwt: the platform's own
// 401 carries no such header, so discovery would never start.
//
// PROTOCOL. MCP 2026-07-28 through the v2 SDK: stateless by design (no
// initialize handshake, no session id; every request carries its own _meta),
// which suits an edge function that holds nothing between calls. Clients
// still on 2025-era MCP are served too: createMcpHandler's `legacy:
// "stateless"` answers their initialize/tools/call per request, so neither era
// is turned away while claude.ai and other clients move over.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createMcpHandler, McpServer } from "npm:@modelcontextprotocol/server@2.4.0";
import { z } from "npm:zod@4.3.6";
import { APP_URL } from "../_shared/helpers.ts";
import {
  emailOf,
  hostMatches,
  normalizeHost,
  retainerMonth,
  STAGE_LABEL,
  ticketStage,
} from "../_shared/conductor-context.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESOURCE = `${SUPABASE_URL}/functions/v1/conductor-mcp`;
const METADATA_URL = `${RESOURCE}/.well-known/oauth-protected-resource`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id, mcp-protocol-version, mcp-method, mcp-name, last-event-id",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-session-id, www-authenticate",
};

const withCors = (res: Response): Response => {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
};

const jsonRes = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS, ...extra } });

const unauthorized = (why: string) =>
  jsonRes({ error: "unauthorized", error_description: why }, 401, {
    "WWW-Authenticate": `Bearer resource_metadata="${METADATA_URL}"`,
  });

type Caller = { sb: SupabaseClient; auth: string; memberId: string; name: string };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (msg: string) => ({ content: [{ type: "text" as const, text: msg }], isError: true });

/** Call another Conductor edge function as the same person. */
async function callFn<T>(caller: Caller, name: string, body: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { Authorization: caller.auth, apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const msg = (parsed as { error?: string } | null)?.error ?? text.slice(0, 300);
    throw new Error(`${name}: ${msg}`);
  }
  return parsed as T;
}

type Client = { id: string; name: string; clickup_folder_id: string | null };

async function findClient(sb: SupabaseClient, sender: string) {
  const host = normalizeHost(emailOf(sender));
  if (!host) return null;
  const { data: cds } = await sb.from("client_domains").select("domain, client:clients!inner(id, name, clickup_folder_id)");
  const cd = (cds ?? []).find((r) => hostMatches(host, normalizeHost(r.domain as string)));
  if (cd) return one(cd.client as Client | Client[]);
  const { data: clients } = await sb.from("clients").select("id, name, clickup_folder_id, primary_domain").not("primary_domain", "is", null);
  const hit = (clients ?? []).find((c) => hostMatches(host, normalizeHost(c.primary_domain as string)));
  if (hit) return { id: hit.id as string, name: hit.name as string, clickup_folder_id: hit.clickup_folder_id as string | null };
  const { data: msgs } = await sb
    .from("brief_messages")
    .select("brief:briefs!inner(client:clients!inner(id, name, clickup_folder_id))")
    .ilike("from_email", `%@${host}`)
    .eq("direction", "inbound")
    .limit(1);
  const brief = one(msgs?.[0]?.brief as unknown as { client: unknown } | null);
  return one(brief?.client as Client | null);
}

async function retainerFor(sb: SupabaseClient, clientId: string) {
  const { data: projects } = await sb
    .from("projects")
    .select("id, name, retainer_hours_target")
    .eq("client_id", clientId)
    .eq("engagement_type", "retainer")
    .eq("is_recurring_task", false)
    .eq("status", "in_progress")
    .limit(1);
  const p = projects?.[0];
  if (!p) return null;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { data: actuals } = await sb
    .from("project_actuals_current")
    .select("actual_hours, recorded_at")
    .eq("project_id", p.id)
    .gte("recorded_at", start);
  const used = (actuals ?? []).reduce((s, a) => s + Number(a.actual_hours ?? 0), 0);
  return { project_id: p.id, project_name: p.name, ...retainerMonth(p.retainer_hours_target as number | null, used, now) };
}

type BriefIn = {
  client_id: string;
  task_name: string;
  description: string;
  work_stream: string;
  sprint_points: number;
  assignee_member_id?: string;
  due_date?: string;
  list_id?: string;
  checklist_items?: string[];
  tags?: string[];
  email_subject?: string;
  email_body?: string;
  sender_email?: string;
  gmail_thread_id?: string;
};

function buildServer(caller: Caller): McpServer {
  const server = new McpServer({ name: "conductor", version: "1.0.0" });
  const { sb } = caller;

  server.registerTool(
    "get-brief-context",
    {
      title: "Get brief context",
      description:
        "Everything Conductor knows that should shape a brief from a client email: the client (matched from the sender), " +
        "who signs things off, this month's retainer hours, open and recently finished work, the ClickUp lists, work streams " +
        "and tags to brief into, and the team with their departments and skills. Call this before drafting a brief. " +
        "Pass client_id instead of sender_email when the client is already known.",
      inputSchema: z.object({
        sender_email: z.string().optional().describe("The email's From, e.g. \"Jane <jane@acme.co.za>\""),
        client_id: z.string().uuid().optional().describe("Skip sender matching when you already know the client"),
        gmail_thread_id: z.string().optional().describe("If this thread was already briefed, the existing brief is returned"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ sender_email, client_id, gmail_thread_id }: { sender_email?: string; client_id?: string; gmail_thread_id?: string }) => {
      try {
        const client = client_id
          ? one((await sb.from("clients").select("id, name, clickup_folder_id").eq("id", client_id).limit(1)).data)
          : sender_email
          ? await findClient(sb, sender_email)
          : null;

        const existing = gmail_thread_id
          ? one(
            (await sb
              .from("briefs")
              .select("id, raw_subject, clickup_task_id, clickup_task_url, clickup_task_status")
              .eq("gmail_thread_id", gmail_thread_id)
              .limit(1)).data,
          )
          : null;

        const { data: team } = await sb
          .from("team_members")
          .select("id, full_name, skills, clickup_user_id, department:departments!team_members_primary_department_id_fkey(name, clickup_work_stream)")
          .is("archived_at", null)
          .order("full_name");

        if (!client) {
          return ok({
            client: null,
            note: "No client matched this sender. Ask which client it is, then call again with client_id.",
            already_briefed: existing,
            team: (team ?? []).map((t) => ({ id: t.id, name: t.full_name, department: one(t.department as never)?.["name"] ?? null, skills: t.skills })),
          });
        }

        const [contacts, retainer, open, finished, signoffs, lists] = await Promise.all([
          sb.from("contacts").select("id, full_name, email, role, is_primary").eq("client_id", client.id).order("is_primary", { ascending: false }),
          retainerFor(sb, client.id),
          sb
            .from("briefs")
            .select("id, raw_subject, clickup_task_status, clickup_task_url, original_due_date, assignee:team_members!briefs_assignee_id_fkey(full_name)")
            .eq("client_id", client.id)
            .not("clickup_task_id", "is", null)
            .is("completed_at", null)
            .neq("status", "archived")
            .order("created_at", { ascending: false })
            .limit(15),
          sb
            .from("briefs")
            .select("raw_subject, completed_at, actual_hours")
            .eq("client_id", client.id)
            .not("completed_at", "is", null)
            .order("completed_at", { ascending: false })
            .limit(5),
          sb.from("client_approvals").select("id", { count: "exact", head: true }).eq("client_id", client.id).eq("state", "pending").eq("owed_by", "client"),
          callFn<{ lists: { id: string; name: string; work_stream: string | null }[]; work_stream_options: { id: string; name: string }[]; tags: string[] }>(
            caller,
            "list-client-clickup-lists",
            { client_id: client.id },
          ).catch((e) => ({ error: e instanceof Error ? e.message : String(e), lists: [], work_stream_options: [], tags: [] })),
        ]);

        return ok({
          client,
          already_briefed: existing,
          signs_off: (contacts.data ?? []).map((c) => ({ id: c.id, name: c.full_name, email: c.email, role: c.role, primary: c.is_primary })),
          retainer: retainer ?? "No running retainer: this would be ad-hoc work.",
          waiting_on_client: signoffs.count ?? 0,
          open_work: (open.data ?? []).map((b) => ({
            subject: b.raw_subject,
            status: b.clickup_task_status,
            due: b.original_due_date,
            assignee: one(b.assignee as never)?.["full_name"] ?? null,
            url: b.clickup_task_url,
          })),
          recently_finished: finished.data ?? [],
          clickup: {
            lists: lists.lists.map((l) => ({ id: l.id, name: l.name, work_stream: l.work_stream })),
            work_streams: lists.work_stream_options.map((o) => o.name),
            tags: lists.tags,
            ...("error" in lists ? { error: lists.error } : {}),
          },
          team: (team ?? []).map((t) => ({
            id: t.id,
            name: t.full_name,
            department: one(t.department as never)?.["name"] ?? null,
            skills: t.skills,
            clickup_user_id: t.clickup_user_id,
          })),
          points_guide: "1 sprint point = 15 minutes of work.",
        });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "brief-to-clickup",
    {
      title: "Brief it into ClickUp",
      description:
        "Records the brief in Conductor and creates its ClickUp task in one step, so the task's time counts toward the " +
        "client's retainer and its completion can go through sign-off. Idempotent on gmail_thread_id: a thread already " +
        "briefed returns its existing task. Attach files to the returned task afterwards with ClickUp's own tool.",
      inputSchema: z.object({
        client_id: z.string().uuid(),
        task_name: z.string().min(3).max(200),
        description: z.string().max(20000).describe("The brief the doer reads: what, why, done-when"),
        work_stream: z.string().describe("One of get-brief-context's clickup.work_streams"),
        sprint_points: z.number().int().min(1).max(400).describe("1 point = 15 minutes"),
        assignee_member_id: z.string().uuid().optional().describe("team[].id from get-brief-context"),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        list_id: z.string().optional().describe("clickup.lists[].id; omitted = the client's projects list"),
        checklist_items: z.array(z.string().max(300)).max(30).optional(),
        tags: z.array(z.string()).max(10).optional(),
        email_subject: z.string().max(500).optional(),
        email_body: z.string().max(50000).optional().describe("The client's words, kept on the brief"),
        sender_email: z.string().optional(),
        gmail_thread_id: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (a: BriefIn) => {
      try {
        let briefId: string | null = null;
        if (a.gmail_thread_id) {
          const { data } = await sb
            .from("briefs")
            .select("id, client_id, clickup_task_id, clickup_task_url")
            .eq("gmail_thread_id", a.gmail_thread_id)
            .limit(1);
          const hit = data?.[0];
          if (hit?.clickup_task_id) {
            return ok({ brief_id: hit.id, clickup_task_id: hit.clickup_task_id, clickup_task_url: hit.clickup_task_url, already_briefed: true });
          }
          if (hit) {
            briefId = hit.id as string;
            if (!hit.client_id) await sb.from("briefs").update({ client_id: a.client_id }).eq("id", briefId);
          }
        }
        if (!briefId) {
          const { data, error } = await sb
            .from("briefs")
            .insert({
              client_id: a.client_id,
              raw_subject: a.email_subject ?? a.task_name,
              raw_body: a.email_body ?? a.description,
              sender_email: a.sender_email ? emailOf(a.sender_email) : null,
              gmail_thread_id: a.gmail_thread_id ?? null,
              source: a.gmail_thread_id ? "email" : "manual",
              status: "new",
            })
            .select("id")
            .single();
          if (error) throw new Error(`Could not record the brief: ${error.message}`);
          briefId = data.id as string;
        }

        const created = await callFn<{ clickup_task_id: string; clickup_task_url: string }>(caller, "create-quick-brief-task", {
          brief_id: briefId,
          task_name: a.task_name,
          description: a.description,
          work_stream: a.work_stream,
          sprint_points: a.sprint_points,
          assignee_member_id: a.assignee_member_id ?? null,
          due_date: a.due_date ?? null,
          list_id: a.list_id,
          checklist_items: a.checklist_items ?? [],
          tags: a.tags ?? [],
          briefed_by_member_id: caller.memberId,
        });
        return ok({
          brief_id: briefId,
          ...created,
          conductor_url: `${APP_URL}/briefs/view/${briefId}`,
          next: "When the doer finishes, they leave a closing comment, attach the proof and move the task to \"send to client\". Conductor drafts the sign-off from that.",
        });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "list-tickets",
    {
      title: "List tickets",
      description:
        "Briefed work that has finished or is on its way to the client, newest first, with where each one stands: " +
        "handed over and waiting for Send, with the client, approved, changes asked for, or done in ClickUp with no sign-off. " +
        "Each carries the Gmail thread it came from, so a reply can go back into that thread.",
      inputSchema: z.object({
        client_id: z.string().uuid().optional(),
        days: z.number().int().min(1).max(90).optional().describe("How far back finished work goes (default 14)"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ client_id, days }: { client_id?: string; days?: number }) => {
      try {
        const since = new Date(Date.now() - (days ?? 14) * 86_400_000).toISOString();
        let q = sb
          .from("briefs")
          .select("id, raw_subject, sender_email, gmail_thread_id, clickup_task_id, clickup_task_url, clickup_task_status, completed_at, updated_at, actual_hours, client:clients(id, name)")
          .not("clickup_task_id", "is", null)
          .or(`completed_at.gte.${since},clickup_task_status.ilike.send to client,clickup_task_status.ilike.waiting on client`)
          .order("updated_at", { ascending: false })
          .limit(40);
        if (client_id) q = q.eq("client_id", client_id);
        const { data: briefs, error } = await q;
        if (error) throw new Error(error.message);
        const ids = (briefs ?? []).map((b) => b.id);
        const { data: approvals } = ids.length
          ? await sb
            .from("client_approvals")
            .select("brief_id, state, created_at, decided_by_name, client_note")
            .in("brief_id", ids)
            .order("created_at", { ascending: false })
          : { data: [] };
        const latest = new Map<string, { state: string; decided_by_name: string | null; client_note: string | null }>();
        for (const r of approvals ?? []) if (!latest.has(r.brief_id as string)) latest.set(r.brief_id as string, r as never);
        return ok(
          (briefs ?? []).map((b) => {
            const s = latest.get(b.id);
            const stage = ticketStage(b.clickup_task_status, b.completed_at, s?.state);
            return {
              brief_id: b.id,
              client: one(b.client as never)?.["name"] ?? null,
              subject: b.raw_subject,
              stage,
              stage_label: STAGE_LABEL[stage],
              decided_by: s?.decided_by_name ?? null,
              client_note: s?.client_note ?? null,
              clickup_status: b.clickup_task_status,
              clickup_url: b.clickup_task_url,
              hours: b.actual_hours,
              gmail_thread_id: b.gmail_thread_id,
              sender_email: b.sender_email,
              completed_at: b.completed_at,
            };
          }),
        );
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "get-brief",
    {
      title: "Get brief",
      description:
        "One brief with its ClickUp task, hours, and its sign-off: what the doer said was done, the proof files, and the " +
        "client's decision. Use it to write the reply to the client's original email.",
      inputSchema: z.object({ brief_id: z.string().uuid() }),
      annotations: { readOnlyHint: true },
    },
    async ({ brief_id }: { brief_id: string }) => {
      try {
        const { data: b, error } = await sb
          .from("briefs")
          .select("id, raw_subject, raw_body, sender_email, gmail_thread_id, clickup_task_id, clickup_task_url, clickup_task_status, completed_at, actual_hours, client:clients(id, name)")
          .eq("id", brief_id)
          .single();
        if (error) throw new Error(error.message);
        const { data: approvals } = await sb
          .from("client_approvals")
          .select("id, state, client_title, detail, links, proof, handed_over_at, decided_at, decided_by_name, client_note")
          .eq("brief_id", brief_id)
          .order("created_at", { ascending: false })
          .limit(3);
        const s = approvals?.[0];
        return ok({
          ...b,
          client: one(b.client as never),
          stage: STAGE_LABEL[ticketStage(b.clickup_task_status, b.completed_at, s?.state as string | undefined)],
          signoff: s
            ? {
              title: s.client_title,
              what_we_did: s.detail,
              links: s.links,
              proof_files: ((s.proof ?? []) as { name: string }[]).map((p) => p.name),
              handed_over_at: s.handed_over_at,
              state: s.state,
              decided_at: s.decided_at,
              decided_by: s.decided_by_name,
              client_note: s.client_note,
            }
            : null,
          signoffs_page: `${APP_URL}/client-signoffs`,
        });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  return server;
}

async function authenticate(req: Request): Promise<Caller | Response> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || token === auth) return unauthorized("Sign in to Conductor to use this connector.");
  const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return unauthorized("That sign-in has expired. Sign in to Conductor again.");
  const { data: member } = await sb
    .from("team_members")
    .select("id, full_name")
    .or(`auth_user_id.eq.${data.user.id}${data.user.email ? `,email.eq.${data.user.email}` : ""}`)
    .is("archived_at", null)
    .limit(1);
  if (!member?.[0]) return jsonRes({ error: "forbidden", error_description: "This connector is for the Converted Click team." }, 403);
  return { sb, auth: `Bearer ${token}`, memberId: member[0].id as string, name: member[0].full_name as string };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const path = new URL(req.url).pathname;

  // RFC 9728: where to sign in. Public by definition.
  if (path.endsWith("/.well-known/oauth-protected-resource")) {
    return jsonRes({
      resource: RESOURCE,
      authorization_servers: [`${SUPABASE_URL}/auth/v1`],
      bearer_methods_supported: ["header"],
      resource_name: "Conductor",
      resource_documentation: APP_URL,
    });
  }

  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;

  const handler = createMcpHandler(() => buildServer(caller), {
    legacy: "stateless",
    responseMode: "json",
    onerror: (e) => console.error("[conductor-mcp]", e.message),
  });
  try {
    return withCors(await handler.fetch(req));
  } catch (e) {
    console.error("[conductor-mcp]", e instanceof Error ? e.message : e);
    return jsonRes({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }, 500);
  }
});
