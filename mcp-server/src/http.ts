import 'dotenv/config'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer } from './server.js'

/**
 * Conductor over HTTP — the transport a client on somebody else's machine can
 * connect to, rather than one process per person launched from a checkout.
 *
 * **Stateless.** Every request builds its own server and transport and throws
 * both away when the response closes (`sessionIdGenerator: undefined`). There
 * is no session to keep in memory, which is what makes this safe to put behind
 * a tunnel, restart mid-conversation, or eventually run on more than one
 * process: no request depends on having been preceded by another one on the
 * same box. It costs a server construction per call — registering 24 tool
 * schemas, no I/O — which is nothing against a round trip to Postgres.
 *
 * **Auth is a bearer token, and it is not optional.** Every tool here runs on
 * the Supabase service role, which bypasses RLS entirely: whoever reaches this
 * port can read every client, brief and rate in the agency. A shared token is
 * the weakest thing that is still honest about that — it is not per-person and
 * it does not expire, so treat it like the service key it is standing in front
 * of, and rotate it when somebody leaves.
 */

const PORT = Number(process.env.MCP_HTTP_PORT ?? 8787)
const TOKEN = process.env.MCP_AUTH_TOKEN

if (!TOKEN) {
  throw new Error(
    'MCP_AUTH_TOKEN must be set before serving over HTTP — these tools run on the service role key. ' +
      'Generate one with: openssl rand -hex 32',
  )
}

/** Constant-time compare, so the token can't be guessed a character at a time. */
function tokenMatches(presented: string): boolean {
  const a = Buffer.from(presented)
  const b = Buffer.from(TOKEN as string)
  return a.length === b.length && timingSafeEqual(a, b)
}

function authorised(req: IncomingMessage): boolean {
  const header = req.headers.authorization ?? ''
  const [scheme, value] = header.split(' ')
  return scheme?.toLowerCase() === 'bearer' && !!value && tokenMatches(value)
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const http = createHttpServer(async (req, res) => {
  // Browser-hosted clients preflight before they'll speak to us at all.
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id, mcp-protocol-version')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  // Unauthenticated, so a tunnel or uptime check can tell the process is alive
  // without holding the token. Says nothing but that.
  if (req.url?.startsWith('/health')) {
    send(res, 200, { ok: true })
    return
  }

  if (!authorised(req)) {
    res.setHeader('WWW-Authenticate', 'Bearer')
    send(res, 401, { error: 'Unauthorized' })
    return
  }

  const server = createServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // One JSON response per call instead of an SSE stream. Nothing here
    // streams partial output or pushes notifications, and a plain response
    // survives proxies that buffer.
    enableJsonResponse: true,
  })

  res.on('close', () => {
    void transport.close()
    void server.close()
  })

  try {
    await server.connect(transport)
    await transport.handleRequest(req, res)
  } catch (e) {
    console.error('[conductor-mcp] request failed:', e)
    if (!res.headersSent) send(res, 500, { error: 'Internal server error' })
  }
})

http.listen(PORT, () => {
  console.error(`[conductor-mcp] stateless HTTP transport listening on http://localhost:${PORT}/`)
})
