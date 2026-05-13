# cc-service-calculator — Agent Handbook

Internal service calculator for Converted Click. React SPA + Supabase. See the plan at `~/.claude/plans/https-lpgwxacoqiqpcfpkklib-supabase-co-i-cuddly-puffin.md` for the full V1 spec.

## Development workflow

Feature work defaults to **superpowers subagents with git worktrees**:

1. Use the `superpowers:using-git-worktrees` skill to create an isolated worktree before touching code.
2. Use the `superpowers:dispatching-parallel-agents` or `superpowers:subagent-driven-development` skills to execute independent tasks in parallel subagents.
3. Each subagent works in its own worktree branch; changes are reviewed and merged back to main.

## Shared dev login

- Email: `team@convertedclick.co.za`
- Password: `cc-calc-2026-temp`

Single shared login (V1 has no per-user roles). There is no `team_members` row for this email, so `currentUserId` resolves to `null` when signed in as `team@…`. For attributable writes in testing, sign in as `brendan@convertedclick.co.za` instead.

## cc-calculator MCP server setup

The repo ships a local MCP server at `mcp-server/` that exposes 7 agency tools (find-client, check-duplicate-brief, get-active-projects, get-active-retainer, list-briefs, get-brief, create-brief).

**First-time setup (once per machine):**

```sh
cd mcp-server
npm install
cp .env.example .env
# Edit .env — fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
```

The server runs via `npm run dev` (tsx, no build step needed). It is registered in `.mcp.json` as `cc-calculator` and starts automatically when Claude Code opens this repo.

To call tools in agent sessions: use `mcp__cc-calculator__<tool-name>`.

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

## Out of scope for V1 (do not implement)

- Xero push/pull.
- Live feedback ingestion from ClickUp or other systems.
- AI beyond process-step generation.
- Capacity/availability planning.
- Per-user roles (single shared login only).
