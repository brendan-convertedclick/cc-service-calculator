# conductor-mcp

Conductor's own MCP server: 24 tools over the agency database — clients,
briefs, sender rules, and the systems library (procedures, processes,
policies).

It speaks two transports from one set of tools:

| Transport | Entry point | Who it is for |
| --- | --- | --- |
| **stdio** | `src/index.ts` (`npm start`) | Agents working inside this checkout. This is what `.mcp.json` launches. |
| **stateless HTTP** | `src/http.ts` (`npm run http`) | Everybody else — a client on someone else's machine, pointed at a URL. |

## Setup (once per machine)

```sh
cd mcp-server
npm install
cp .env.example .env      # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
```

No build step — both entry points run through `tsx`.

## Serving it to other people

```sh
openssl rand -hex 32                      # put the result in .env as MCP_AUTH_TOKEN
npm run http                              # listens on localhost:8787
```

`vite.config.ts` proxies `/mcp` to that port, so the cloudflared tunnel already
fronting the app serves the MCP server too — no second hostname, no DNS record.
The public URL is:

```
https://conductor-dev.convertedclick.co.za/mcp
```

Point a client at it with the token as a bearer header. In Claude Code:

```sh
claude mcp add --transport http conductor https://conductor-dev.convertedclick.co.za/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

`GET /mcp/health` answers `{"ok":true}` without a token, so uptime checks don't
need to hold one.

### What "stateless" means here, and why

Each request builds its own `McpServer` and transport and drops both when the
response closes (`sessionIdGenerator: undefined`). Nothing about a call depends
on having been preceded by another one on the same process, which is what makes
the server safe to restart mid-conversation, put behind a proxy, or eventually
run more than one of. The cost is constructing a server per call — registering
24 tool schemas, no I/O — against a round trip to Postgres.

### The security position, stated plainly

Every tool runs on the **service role key**, which bypasses RLS completely.
Whoever holds `MCP_AUTH_TOKEN` can read every client, brief and rate in the
agency, and can write briefs, sender rules and procedures. The token is shared,
not per-person, and does not expire.

That is an acceptable trade for a small internal team behind one tunnel. It is
not acceptable as the permanent answer — the honest fix is per-user auth
(OAuth, or a Supabase user token the tools run under so RLS applies), and it
should happen before this URL is handed to anyone outside the team.

Availability follows the app: this is a process on a laptop behind a tunnel, so
it is up when the app is up. If people start depending on it, move it somewhere
that stays on.

## Tools

Twenty of them cover intake — finding clients, deduping Gmail threads, creating
and scoping briefs, and the per-client sender allow/block rules. See
`src/server.ts` for the registry; each has a description the client displays.

The four systems tools are the ones worth knowing about:

| Tool | What it does |
| --- | --- |
| `list-procedures` | Find a procedure (or process/policy) by name. Start here — the others need a `system_id`. |
| `get-procedure` | The whole thing: goal, tasks in order, each task's checklist, hours. |
| `create-procedure` | Writes a procedure, its tasks and their checklists in one call. |
| `add-procedure-task` | Appends one task, with its checklist, to the end of an existing procedure. |

### Writing a procedure

A procedure is a run of **tasks**, each holding **steps**. A task becomes one
ClickUp task and owns the department, owner and estimate; its steps become that
task's checklist. The boundary between two tasks is a hand-off — where the work
changes hands.

```json
{
  "name": "Monthly client report",
  "goal_statement": "Send the client their monthly report by the 5th.",
  "owner": "Brendan",
  "tasks": [
    {
      "title": "Pull the numbers",
      "department": "Paid Media",
      "steps": [
        { "title": "Export GA4", "estimated_hours": 0.5 },
        { "title": "Export Ads", "estimated_hours": 0.25 }
      ]
    },
    { "title": "Write the commentary", "department": "Content & Copywriting", "estimated_hours": 1.5 }
  ]
}
```

Three things that make this pleasant to call and are worth not breaking:

* **Names, not uuids.** Departments, owners and services are given by name. An
  unrecognised name comes back as an error listing the valid ones, so a caller
  can correct itself instead of guessing.
* **Nothing is written until every name resolves.** A misspelt department is the
  likeliest failure, and a procedure that exists with none of its tasks is worse
  than one that was never created.
* **Hours belong to the steps.** A task with steps gets its estimate from the
  `process_steps_rollup_hours` trigger; only a task with no steps carries its
  own.

What comes out is a **draft** — live rows, exactly what the editor writes.
Nothing reaches ClickUp until an admin publishes a revision, which is a
different act behind the `publish_system_revision` RPC. So these tools are safe
to hand to anyone: the worst they can do is add a procedure somebody has to
review.

## Tests

```sh
npm test
```
