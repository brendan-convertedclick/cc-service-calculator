import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

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
  // ── Systems: procedures, processes and policies ──────────────────────────
  ['list-procedures', 'List documented procedures (or processes/policies) by name. Start here to find the system_id for the other procedure tools.', listProcedures, true],
  ['get-procedure', 'Read a procedure in full: its goal, its tasks in order, and each task\'s checklist. Tasks are numbered 1..N and steps are numbered straight through the run, matching what Conductor shows on screen.', getProcedure, true],
  ['create-procedure', 'Write a whole procedure in one call: the procedure itself, its tasks, and each task\'s checklist. A task becomes one ClickUp task (it owns the department, owner and estimate); its steps become that task\'s checklist items. Ask how many CARDS the work deserves, not how many lines the source document had: a recurring routine (a daily sweep, a month-end run) is ONE task whose steps are its checklist \u2014 split into separate tasks only where the work stops and waits on someone else. Departments, owners and services are given by name, not id. The result is a draft — nothing reaches ClickUp until an admin publishes a revision.', createProcedure],
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
