# Conductor — Agent Handbook

Internal service calculator for Converted Click. React SPA + Supabase. See the plan at `~/.claude/plans/https-lpgwxacoqiqpcfpkklib-supabase-co-i-cuddly-puffin.md` for the full V1 spec.

## Hosting — prod is Cloudflare Pages, the tunnel is dev

Two hostnames, and they are not the same thing:

| URL | What it is | How code gets there |
| --- | --- | --- |
| `https://conductor.convertedclick.co.za` | **Production.** Cloudflare Pages project `conductor` (direct upload, no Git integration), account "Converted Clicks Account". Also reachable at `conductor-ehv.pages.dev`. | `npm run deploy` — builds and uploads `dist/`. Nothing deploys on push; a commit that is not deployed is not live. |
| `https://conductor-dev.convertedclick.co.za` | **Dev preview.** The cloudflared tunnel `conductor` → this machine's Vite dev server on `localhost:5391`. | HMR from the working tree. Uncommitted work shows here and only here. |

- The build is a static SPA. `public/_redirects` (`/* /index.html 200`) is what makes deep links work — without it Pages 404s on every route but `/`.
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are baked into the bundle at build time from `.env.local`, so `npm run deploy` must run on a machine that has it.
- The tunnel is a **public URL**, so `isLocalDev()` (`src/lib/env.ts`) tests for localhost positively. It used to test "not the prod hostname" — on a `-dev` host that would auto-sign the internet in as the shared `team@` owner. Do not loosen it back.
- The tunnel serves `/mcp` (Vite proxies it to `mcp-server` on 8787), so the HTTP MCP URL is on `conductor-dev`, not prod. Prod is static — it has no proxy.
- Edge functions link users to prod (`APP_URL` in `supabase/functions/*`), which is correct — those emails and ClickUp comments should not point at a laptop.
- Tunnel config is `/etc/cloudflared/config.yml` (root LaunchDaemon `com.cloudflare.cloudflared`). `DEV_ALLOWED_HOSTS` in `.env.local` must list the tunnel hostname or Vite refuses the request.

## Development workflow

Feature work defaults to **superpowers subagents with git worktrees**:

1. Use the `superpowers:using-git-worktrees` skill to create an isolated worktree before touching code.
2. Use the `superpowers:dispatching-parallel-agents` or `superpowers:subagent-driven-development` skills to execute independent tasks in parallel subagents.
3. Each subagent works in its own worktree branch; changes are reviewed and merged back to main.

## Shared dev login

- Email: `team@convertedclick.co.za`
- Password: `cc-calc-2026-temp`

Shared dev/admin login, treated as `owner` role for ergonomics (see `useCurrentRole`). There is no `team_members` row for this email, so `currentUserId` resolves to `null` when signed in as `team@…`. For attributable writes in testing, sign in as `brendan@convertedclick.co.za` instead.

Per-staff logins are real and live (not V1-out-of-scope): `team_members.role` (`staff`/`admin`/`owner`) + `team_members.auth_user_id` → Supabase Auth (migration 0052). `App.tsx`'s local `RequireAdmin` gates routes — `staff` role is bounced to `/staff`. (A shared `RequireRole` component once did this; it was deleted in the 2026-08-09 audit because `App.tsx` had reimplemented it inline and nothing imported it. Do not recreate it.) There's no invite/provisioning UI yet — a staff Supabase Auth user + matching `team_members` row currently has to be created by hand.

**Everyone gets the shell.** `AppShell` (nav rail + breadcrumbs) wraps every authenticated route, staff included, and `navEntriesFor(role)` in `components/nav/navItems.ts` filters it. Nav visibility and route gating must agree: a `NavItem` with no `roles` is admin/owner (matching `RequireAdmin`); `roles: ALL_ROLES` marks the surfaces open to everyone — `/staff` ("My work", `src/pages/StaffBriefForm.tsx`), `/systems` (the whole library, editable by everyone) and `/profile` (`src/pages/Profile.tsx`: own name/department/skills, ClickUp + Google connections, sign out). `/settings/google` is outside the admin gate too — it is per-user connection state, not an org setting. A section whose items all filter out is dropped; one that filters to a single item renders as that item.

**The systems library is everyone's to write.** `system_definitions`/`system_edges`/`process_steps`/`process_step_procedures` are read-and-write open to any `authenticated` user (0118) — procedures are documented by the people who run them, so do not re-gate these on role. The single admin/owner act is **publishing** a revision: `publish_system_revision` raises `admin or owner role required`, and the `system_revisions` policies let anyone write a `draft`/`proposed` row while restricting `published`/`superseded` to admin/owner, so a direct insert can't route around the RPC. In the UI that's the pre-existing `canApprove` in `SystemDetail.tsx` — there is no `canEdit`.

**Publishing also needs named sign-offs (0126).** `system_revision_approvals` is who agreed to a revision and when: one row per person, `required` (publish waits for them) or optional (a log entry). `publish_system_revision` raises if a revision has *no* approvers at all, or if any required one has a null `approved_at` — so a revision cannot publish until someone records who approved the procedure. Sign-offs are entered by hand (the datetime is editable, not stamped) because they record an agreement that happened elsewhere, and they do **not** carry forward: a new revision is a new snapshot and needs its own. Anyone authenticated may write the rows; the admin/owner gate stays on the publish itself.

`team_members` (0115, fixed by 0117): anyone may read; only admin/owner may write anyone's row; a person may write their own, with `role`, `cost_rate_cents`, `email`, `archived_at` and `tracking_mode` held immutable by a BEFORE UPDATE trigger. That trigger fires for service-role writes too (RLS is bypassed, triggers are not), so it exempts `auth.uid() is null` — without that, `google-token`'s provisioning upsert silently fails to set `auth_user_id`. `current_team_member_role()` resolves the shared `team@` login to `owner`, so it keeps working.

## Telegram channel session guardrail

When this project is running as a Telegram channel session (the "Channels (experimental) messages from plugin:telegram" banner is shown), **never call `AskUserQuestion`**. There is no one available to click an option in a terminal UI — the tool call blocks forever, which permanently wedges that conversation's message queue (every later Telegram message enqueues but never gets a reply, and restarting `claude --channels` just resumes the same poisoned session since it re-attaches to the same conversation). If a clarifying question is genuinely needed, ask it as a normal chat reply and wait for the next inbound message instead.

If a channel session ever does get stuck this way, don't just restart the launcher — check for orphaned `claude --channels` processes first (`ps -ef | grep -- "--channels"`; `screen -X quit` can silently fail to kill grandchildren, leaving a duplicate poller on the same bot token), then relaunch with an explicit fresh `--session-id <uuid>` so it doesn't resume the poisoned transcript.

## conductor MCP server setup

The repo ships an MCP server at `mcp-server/` exposing 24 tools: 20 for intake (clients, briefs, sender rules) and 4 for the systems library (`list-procedures`, `get-procedure`, `create-procedure`, `add-procedure-task`). `mcp-server/README.md` is the full account — setup, the procedure-writing shape, and the security position.

**First-time setup (once per machine):**

```sh
cd mcp-server
npm install
cp .env.example .env
# Edit .env — fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
```

The server runs via `npm run dev` (tsx, no build step needed). It is registered in `.mcp.json` as `conductor` and starts automatically when Claude Code opens this repo.

To call tools in agent sessions: use `mcp__conductor__<tool-name>`.

**Two transports, one tool registry.** `src/server.ts` builds the server; `src/index.ts` serves it over stdio (what `.mcp.json` launches) and `src/http.ts` serves it over **stateless** Streamable HTTP for clients on other people's machines — a server and transport per request, nothing held between calls. `npm run http` listens on 8787, `vite.config.ts` proxies `/mcp` to it, and the existing tunnel makes that `https://conductor-dev.convertedclick.co.za/mcp`.

Adding a tool means one entry in the `tools` table in `src/server.ts` — do not register it in an entry point, or it will exist on one transport and not the other. Mark it `true` in the fourth slot if it only reads; clients use `readOnlyHint` to decide what may run without asking.

**The HTTP transport is live** — `pm2` runs it as `conductor-mcp` (root `ecosystem.config.cjs`), a launchd agent resurrects pm2 at login, and it binds 127.0.0.1 only, so the Vite proxy is the one thing that can reach it. It is therefore up only while the dev server on :5391 is: the tunnel publishes `/mcp` *through* Vite, not around it. `pm2 logs conductor-mcp` when a client says the URL is dead.

**It runs on the service role key and is gated by one shared bearer token (`MCP_AUTH_TOKEN` in `mcp-server/.env`, generated 2026-08-19).** That token is the only thing between the internet and every client, brief and rate in the agency. Per-user auth is the real fix and has not been done — don't hand the URL outside the team until it is, and rotate the token when someone leaves.

**Writing procedures through the MCP.** `create-procedure` takes departments, owners and services **by name**, not uuid, and resolves every name before writing anything so a typo fails with nothing created. It writes the same rows the editor writes: top-level `process_steps` = task (`materialise_as: 'task'`), children = steps (`'checklist_item'`), consecutive tasks chained by a `system_edges` row and laid out left-to-right. Hours go on the steps — the rollup trigger owns the task's total. The result is a draft; publishing stays an admin act behind `publish_system_revision`.

### Sender rule enforcement in intake

The intake flow must call `mcp__conductor__evaluate-sender` before
`create-brief` for every inbound thread on a known client domain. Decision values:

- `allow` — proceed and create the brief normally.
- `block` — skip the thread; tag it `CC/Intake/Blocked` so it isn't reconsidered.
- `pending` — sender is on a known client domain but has no rule. Proceed,
  but a `pending_senders` row is queued automatically by `create-brief` and
  must be resolved by the operator in **Clients → [client] → Senders**.
- `unknown` — sender's domain is not a client domain (current ignore behavior).

`create-brief` also performs a defensive block check, so an outdated intake
flow can never insert a blocked sender. `sync-messages` drops inbound messages
from blocked senders before upserting.

## Supabase — use the project-scoped MCP server ONLY

This repo ships a dedicated MCP server in `.mcp.json` named **`cc-supabase`**, pinned with `--project-ref=lpgwxacoqiqpcfpkklib`.

- When working in this repo, use **`mcp__cc-supabase__*`** tools exclusively for any database, migration, edge function, or schema operation.
- **Do not use the default `mcp__supabase__*` tools here.** The default server is pointed at a different project (`hmosfbevnlzmduqnvdxz`) and will corrupt unrelated data.
- The access token is read from the environment variable `SUPABASE_ACCESS_TOKEN_CC_CALCULATOR`. Set it in your shell before starting Claude Code:

  ```sh
  export SUPABASE_ACCESS_TOKEN_CC_CALCULATOR="sbp_..."
  ```

  Never commit the token.

## Project conventions

- **Stack:** Vite + React 18 + TypeScript + Tailwind + shadcn/ui + Supabase JS + React Router + TanStack Query + react-hook-form + zod.
- **Money:** stored as `int` cents in Postgres. Format on the edge with `Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' })`.
- **Hours:** numeric(6,2) in the DB.
- **Allocation sum tolerance:** 99.5–100.5. Triggers enforce this.
- **Environment:** `.env.local` is gitignored; `.env.example` shows the shape. Vite prefixes with `VITE_`.
- **Dev server port:** pinned to `5174` with `strictPort: true` in `vite.config.ts`. Other devs on the team use 5173 — do not change this port.
- **AI:** Anthropic Claude Sonnet 4.6 via a single Supabase Edge Function `generate-process-steps`. Key stored as Supabase secret, never shipped to the browser.
- **Ongoing tasks (overhead):** Time spent on standups, internal meetings, admin/comms, learning, and sales/BD is tracked via *perpetual* per-person ClickUp tasks living in `settings.clickup_internal_list_id`. Provision them from the Team page (one click per member). Task names follow `[Internal] {full_name} — {Category}` so Rize.io can auto-match. These tasks never close. Time flows in from Rize → ClickUp → `ongoing_actuals` via `sync-clickup-actuals` (existing cron). In the productivity view, ongoing-task hours are split out as Overhead — they're classified by checking each ClickUp time entry's `task.id` against the active `ongoing_tasks` set inside `get-productivity`.
- **Edge function helpers:** shared via `supabase/functions/_shared/`. Use `cors()`, `json()`, `createUserClient(req)`, `createServiceRoleClient()`, `callAnthropic({...})`, `buildBriefComment(...)`, `resolveListAlias(...)` instead of inlining.

## Design tokens — Figma is the source of truth

The app's visual language (colors, typography, radius, elevation) is driven by **Material 3 role-based tokens** defined in Figma and synced into the repo.

- **Single source of truth:** `tokens/base.json`. Hand-edits to this file are OK for prototyping but will be overwritten by the sync script.
- **Generated artefacts (committed):**
  - `src/styles/tokens.css` — CSS custom properties (`--mcolor-primary`, `--radius-lg`, `--elevation-level1`, `--font-sans`) + shadcn aliases (`--primary`, `--background`, `--border`, …) for both light and `.dark` modes.
  - `src/styles/tokens.ts` — typed exports consumed by `tailwind.config.ts`.
- **Never edit the generated files by hand** — they carry a banner. Run `npm run tokens:build`.

### Workflow

1. **Figma variables naming convention** (must match exactly for the sync script to pick them up):
   - Color variables: `color/<role-kebab-case>` — e.g. `color/primary`, `color/on-primary`, `color/primary-container`, `color/on-primary-container`, `color/surface`, `color/surface-container`, `color/surface-container-high`, `color/outline`, `color/outline-variant`, `color/error`, `color/on-error`, …
   - Each color variable must define **Light** and **Dark** modes.
   - Radius variables: `radius/xs`, `radius/sm`, `radius/md`, `radius/lg`, `radius/xl` as FLOAT variables (px).
2. Set `FIGMA_ACCESS_TOKEN` and `FIGMA_FILE_KEY` in `.env.local` (see `.env.example`). The PAT needs `file_variables:read` scope.
3. Pull + build: `npm run tokens:sync` — fetches variables from Figma, merges into `tokens/base.json`, regenerates CSS + TS. Commit the diffs.
4. Local prototyping without Figma: edit `tokens/base.json`, then `npm run tokens:build`.

### Using tokens in components

- **M3 role colors** are exposed as Tailwind classes via the `m-` prefix: `bg-m-primary-container`, `text-m-on-surface-variant`, `border-m-outline-variant`, etc.
- **Shadcn semantic aliases** still work: `bg-primary`, `text-muted-foreground`, `border-input` — they route to the same CSS vars.
- **Type scale:** `text-display-large`, `text-headline-medium`, `text-title-small`, `text-body-medium`, `text-label-large`, etc. These set size + line-height + weight + letter-spacing in one class.
- **Elevation:** `shadow-elev-1` through `shadow-elev-5`. Prefer elevation over heavy borders.
- **Radius:** `rounded-sm/md/lg/xl` map to M3 shape tokens. Full-round buttons use `rounded-full` (the Button component handles this).

### When to add a new token

- New color role needed → add to `tokens/base.json` (and define it in Figma), then `npm run tokens:build`.
- Per-component magic values → prefer a new token over a hardcoded hex.

## Reuse before you write — the shared helpers

A 2026-08-09 audit found the dominant defect in this codebase was not bad logic,
it was **the same logic re-implemented instead of reused**: 105 inline error
extractions, 28 hand-rolled edge-function fetches across 18 private
`FUNCTIONS_BASE` consts, 23 copies of one Set-toggle block, 16 ZAR formatters,
4 pages inlining the same filter rail. Before writing any of the following,
import the existing helper.

| Need | Use | Never |
| --- | --- | --- |
| Read a message off a thrown value | `errorMessage(e)` — `@/lib/supabase`'s `PostgrestError` is a plain object, so `e instanceof Error` is **false** and the real DB message is lost | `e instanceof Error ? e.message : "..."` |
| Call an edge function | `callEdgeFn(name, body?)` from `@/lib/edge` | a private `FUNCTIONS_BASE` + `getSession` + `fetch` |
| Format money | `formatZar(cents)` from `@/lib/utils` — money is **int cents**. `formatCurrency(zar)` in `@/lib/format` takes **rands**; check the unit | inline `new Intl.NumberFormat("en-ZA", …)` |
| Today's date | `todayISO()` from `@/lib/dates` | `new Date().toISOString().slice(0,10)` — that is **UTC**, and returns yesterday between 00:00 and 02:00 SAST |
| Toggle a value in a Set | `toggleInSet(prev, id)` from `@/lib/utils` | a 5-line `new Set(prev)` block |
| A filter rail | `FilterGroup` / `FilterOption` from `@/components/filters/FilterRail` | a fresh `<h4>` + mapped-button block |
| A Supabase client | the singleton in `@/lib/supabase` | another `createClient(...)` |
| Edge-function CORS/JSON/clients | `supabase/functions/_shared/helpers.ts` | inlining them (already 100% adopted — keep it that way) |

ESLint enforces the last two mechanically via `no-restricted-syntax`.

## Quality gates — run these, they are not decorative

`npm run verify` = typecheck + lint + unit tests. CI runs that plus dead-code
detection, build, and Playwright.

- **`npm run typecheck` is `tsc -b`, not `tsc --noEmit`.** The root tsconfig is
  references-only, so `--noEmit` type-checks *nothing* and exits 0. That false
  pass is how 63 type errors and a broken `npm run build` reached main unnoticed.
- **ESLint runs on a ratchet.** Clean rules are `error`; the pre-existing backlog
  is `warn` with a cap in CI that only ever goes down. Do not raise the cap.
- **`npm run lint:dead` (knip)** fails on files nothing imports. Dead files went
  11 → 0 in the audit; this keeps them there.
- Optional local hook: `git config core.hooksPath .githooks` lints staged files.
- Playwright specs live in `e2e/`. `systems.spec.ts` **writes to the live
  database** (prefixed rows, cleaned up in `afterAll`) — the others are
  read-only, so a routine gate should run those.

## Out of scope for V1 (do not implement)

- Xero push/pull.
- Live feedback ingestion from ClickUp or other systems.
- AI beyond process-step generation.
- Capacity/availability planning.

## Design Context

Design strategy lives in `PRODUCT.md` at the repo root — register (`product`), platform (`web`), users, positioning, brand personality, anti-references, and 5 design principles. The visual system (colors/type/components) is captured in `DESIGN.md` (generated from the Material 3 token system). Both are maintained by the **impeccable** skill (`.claude/skills/impeccable/`); run `/impeccable` for design/review/polish work — it reads these two files first. Note the token system is Figma-synced and generated (see "Design tokens" above); impeccable must use the `m-`/shadcn token classes, never hardcoded hex.

## Internal meetings — Google Calendar setup

Internal meetings reuse the existing Supabase Auth Google login (see `signInWithGoogle` in `AuthContext.tsx`) — there is no separate OAuth app.

- Set Supabase secrets `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` — the same values already configured in Supabase Auth → Providers → Google.
- The Google Cloud project needs the **Calendar API** enabled and `calendar.events` added to the OAuth consent screen's scopes.
- `https://conductor.convertedclick.co.za` must be listed in Supabase Auth → URL Configuration → Redirect URLs, or the provider refresh token is never captured and every meeting reports "No Google account connected". `conductor-dev.convertedclick.co.za` and `conductor-ehv.pages.dev` are on the allow list too, so a Google sign-in works on the dev preview as well.
- Staff must sign in with Google once to grant calendar access — existing sessions (email/password or an earlier Google sign-in without the calendar scope) must **sign out and sign in with Google again**. Status/reconnect lives at Settings → Google Calendar.
- `settings.clickup_internal_list_id` must be set (Settings → ClickUp) or meetings skip the ClickUp leg entirely and their time is never tracked as overhead.
