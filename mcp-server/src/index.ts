import 'dotenv/config'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
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

// Helper: extract ZodRawShape from a ZodObject or ZodEffects(ZodObject).
// The MCP SDK server.tool() requires a ZodRawShape (plain record of Zod types),
// not a ZodObject or ZodEffects instance.
function rawShape(schema: z.ZodTypeAny): z.ZodRawShape {
  if (schema instanceof z.ZodEffects) {
    return (schema._def.schema as z.ZodObject<z.ZodRawShape>).shape
  }
  return (schema as z.ZodObject<z.ZodRawShape>).shape
}

const server = new McpServer({
  name: 'cc-calculator',
  version: '0.1.0',
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (...args: any[]) => any) => fn

server.tool(
  'find-client',
  'Find a client record by sender email domain or name. Returns { id, name, wiki_path, primary_domain } or null.',
  rawShape(findClient.schema),
  h(findClient.handler),
)

server.tool(
  'check-duplicate-brief',
  'Check if a Gmail thread has already been ingested as a brief. Returns { brief_id } or null.',
  rawShape(checkDuplicate.schema),
  h(checkDuplicate.handler),
)

server.tool(
  'get-active-projects',
  'List active and in-progress projects for a client. Returns array (may be empty).',
  rawShape(getActiveProjects.schema),
  h(getActiveProjects.handler),
)

server.tool(
  'get-active-retainer',
  'Get the most recent active retainer brief for a client with its scope summary. Returns { brief_id, subject, scope_summary } or null.',
  rawShape(getActiveRetainer.schema),
  h(getActiveRetainer.handler),
)

server.tool(
  'list-briefs',
  'List inbox briefs with optional filters. Returns array of brief summaries.',
  rawShape(listBriefs.schema),
  h(listBriefs.handler),
)

server.tool(
  'get-brief',
  'Get a full brief including scope fields, intent_type, and draft_reply.',
  rawShape(getBrief.schema),
  h(getBrief.handler),
)

server.tool(
  'create-brief',
  'Idempotently create a new brief from an email. Dedupes by gmail_thread_id, fires auto-scope in background. Returns { brief_id, created: bool }.',
  rawShape(createBrief.schema),
  h(createBrief.handler),
)

server.tool(
  'sync-messages',
  'Idempotently insert new Gmail messages into brief_messages. Skips any gmail_message_id already stored. Returns { inserted, skipped }.',
  rawShape(syncMessages.schema),
  h(syncMessages.handler),
)

server.tool(
  'set-brief-intent',
  'Update a brief with its AI-classified intent_type and store scope fields or draft_reply. Upserts scope row on conflict with brief_id.',
  rawShape(setBriefIntent.schema),
  h(setBriefIntent.handler),
)

server.tool(
  'set-brief-intelligence',
  'Upsert a brief_intelligence record for a brief. Stages call this after completing their output. Appends audit_trail_entry if provided. Returns { id, brief_id, am_status }.',
  rawShape(setBriefIntelligence.schema),
  h(setBriefIntelligence.handler),
)

server.tool(
  'get-brief-intelligence',
  'Get the brief_intelligence record for a brief by brief_id. Returns the full record or null if not yet generated.',
  rawShape(getBriefIntelligence.schema),
  h(getBriefIntelligence.handler),
)

server.tool(
  'list-client-domains',
  'Returns all unique email domains known to belong to clients — derived from inbound brief_messages history and clients.primary_domain. Used by intake to build Gmail scan filters.',
  rawShape(listClientDomains.schema),
  h(listClientDomains.handler),
)

const transport = new StdioServerTransport()
await server.connect(transport)
