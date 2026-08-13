import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import * as findClient from './tools/find-client.js'
import * as checkDuplicate from './tools/check-duplicate-brief.js'
import * as getActiveProjects from './tools/get-active-projects.js'
import * as getActiveRetainer from './tools/get-active-retainer.js'
import * as listBriefs from './tools/list-briefs.js'
import * as getBrief from './tools/get-brief.js'
import * as createBrief from './tools/create-brief.js'
import * as syncMessages from './tools/sync-messages.js'
import * as setBriefIntent from './tools/set-brief-intent.js'
import * as setBriefIntelligence from './tools/set-brief-intelligence.js'
import * as getBriefIntelligence from './tools/get-brief-intelligence.js'
import * as listClientDomains from './tools/list-client-domains.js'
import * as evaluateSender from './tools/evaluate-sender.js'
import * as listSenderRules from './tools/list-sender-rules.js'
import * as setSenderRule from './tools/set-sender-rule.js'
import * as listPendingSenders from './tools/list-pending-senders.js'
import * as resolvePendingSender from './tools/resolve-pending-sender.js'
import * as listBriefsMatchingSender from './tools/list-briefs-matching-sender.js'
import * as applyRetroAction from './tools/apply-retro-action.js'
import * as recordPendingClient from './tools/record-pending-client.js'
import * as listProcedures from './tools/list-procedures.js'
import * as getProcedure from './tools/get-procedure.js'
import * as createProcedure from './tools/create-procedure.js'
import * as addProcedureTask from './tools/add-procedure-task.js'

// Helper: extract ZodRawShape from a ZodObject or ZodEffects(ZodObject).
// registerTool wants a ZodRawShape (plain record of Zod types), not a
// ZodObject or ZodEffects instance.
function rawShape(schema: z.ZodTypeAny): z.ZodRawShape {
  if (schema instanceof z.ZodEffects) {
    return (schema._def.schema as z.ZodObject<z.ZodRawShape>).shape
  }
  return (schema as z.ZodObject<z.ZodRawShape>).shape
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolModule = { schema: z.ZodTypeAny; handler: (...args: any[]) => any }

/** The fourth element marks a tool that only reads. Clients use `readOnlyHint`
 *  to decide what can run without asking — worth being accurate about now the
 *  server is reachable over HTTP and not just by this repo's own agents. */
type ToolEntry = [name: string, description: string, mod: ToolModule, readOnly?: true]

const tools: ToolEntry[] = [
  ['find-client', 'Find a client record by sender email domain or name. Returns { id, name, wiki_path, primary_domain } or null.', findClient, true],
  ['check-duplicate-brief', 'Check if a Gmail thread has already been ingested as a brief. Returns { brief_id } or null.', checkDuplicate, true],
  ['get-active-projects', 'List active and in-progress projects for a client. Returns array (may be empty).', getActiveProjects, true],
  ['get-active-retainer', 'Get the most recent active retainer brief for a client with its scope summary. Returns { brief_id, subject, scope_summary } or null.', getActiveRetainer, true],
  ['list-briefs', 'List inbox briefs with optional filters. Returns array of brief summaries.', listBriefs, true],
  ['get-brief', 'Get a full brief including scope fields, intent_type, and draft_reply.', getBrief, true],
  ['create-brief', 'Idempotently create a new brief from an email. Dedupes by gmail_thread_id, fires auto-scope in background. Returns { brief_id, created: bool }.', createBrief],
  ['sync-messages', 'Idempotently insert new Gmail messages into brief_messages. Skips any gmail_message_id already stored. Returns { inserted, skipped }.', syncMessages],
  ['set-brief-intent', 'Update a brief with its AI-classified intent_type and store scope fields or draft_reply. Upserts scope row on conflict with brief_id.', setBriefIntent],
  ['set-brief-intelligence', 'Upsert a brief_intelligence record for a brief. Stages call this after completing their output. Appends audit_trail_entry if provided. Returns { id, brief_id, am_status }.', setBriefIntelligence],
  ['get-brief-intelligence', 'Get the brief_intelligence record for a brief by brief_id. Returns the full record or null if not yet generated.', getBriefIntelligence, true],
  ['list-client-domains', 'Returns all unique email domains known to belong to clients — derived from inbound brief_messages history and clients.primary_domain. Used by intake to build Gmail scan filters.', listClientDomains, true],
  ['evaluate-sender', 'Evaluate a sender email against per-client allow/block rules. Returns { decision: allow | block | pending | unknown, client_id?, rule_id? }. Block wins; unknown means the sender domain is not a client domain.', evaluateSender, true],
  ['list-sender-rules', 'List allow/block rules for a client. Returns { allow: Rule[], blocked: Rule[] }.', listSenderRules, true],
  ['set-sender-rule', 'Upsert (or delete with delete=true) a single allow/block rule. Pattern is lowercased; must contain @.', setSenderRule],
  ['list-pending-senders', 'List senders awaiting explicit approval, optionally scoped to one client. Ordered by last_seen_at desc.', listPendingSenders, true],
  ['resolve-pending-sender', 'Approve (action=allow) or reject (action=block) a pending sender. Creates a rule and removes the pending row.', resolvePendingSender],
  ['list-briefs-matching-sender', 'Preview which existing briefs would be affected by a sender rule pattern. Returns { briefs: [...] }.', listBriefsMatchingSender, true],
  ['apply-retro-action', 'Bulk archive or delete briefs by id. Used after adding a block rule to clean up historical briefs from the now-blocked sender.', applyRetroAction],
  ['record-pending-client', 'Record an inbound email from a domain that does not match any client. Upserts pending_clients keyed by domain; clears dismissed_at so the row reappears in the inbox. Called by /intake when evaluate-sender returns "unknown".', recordPendingClient],

  // ── Systems: procedures, processes and policies ──────────────────────────
  ['list-procedures', 'List documented procedures (or processes/policies) by name. Start here to find the system_id for the other procedure tools.', listProcedures, true],
  ['get-procedure', 'Read a procedure in full: its goal, its tasks in order, and each task\'s checklist. Tasks are numbered 1..N and steps are numbered straight through the run, matching what Conductor shows on screen.', getProcedure, true],
  ['create-procedure', 'Write a whole procedure in one call: the procedure itself, its tasks, and each task\'s checklist. A task becomes one ClickUp task (it owns the department, owner and estimate); its steps become that task\'s checklist items. Departments, owners and services are given by name, not id. The result is a draft — nothing reaches ClickUp until an admin publishes a revision.', createProcedure],
  ['add-procedure-task', 'Append one task, with its checklist, to the end of an existing procedure and chain it onto the task before it.', addProcedureTask],
]

/**
 * Builds a fully wired MCP server.
 *
 * A factory rather than a singleton because the HTTP transport is stateless:
 * each request gets its own server and transport, so nothing is shared between
 * two callers who happen to arrive at the same moment.
 */
export function createServer(): McpServer {
  const server = new McpServer({ name: 'conductor', version: '0.2.0' })
  for (const [name, description, mod, readOnly] of tools) {
    server.registerTool(
      name,
      {
        description,
        inputSchema: rawShape(mod.schema),
        annotations: { readOnlyHint: readOnly === true },
      },
      mod.handler,
    )
  }
  return server
}
