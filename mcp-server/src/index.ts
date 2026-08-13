import 'dotenv/config'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.js'

// Local entry point: one process per client, spoken to over stdin/stdout.
// This is what .mcp.json launches for agents working inside this repo.
// For a server other people can point a client at, run src/http.ts instead.
await createServer().connect(new StdioServerTransport())
