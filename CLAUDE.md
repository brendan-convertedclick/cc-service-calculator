# cc-service-calculator — Agent Handbook

Internal service calculator for Converted Click. React SPA + Supabase. See the plan at `~/.claude/plans/https-lpgwxacoqiqpcfpkklib-supabase-co-i-cuddly-puffin.md` for the full V1 spec.

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
- **AI:** Anthropic Claude Sonnet 4.6 via a single Supabase Edge Function `generate-process-steps`. Key stored as Supabase secret, never shipped to the browser.

## Out of scope for V1 (do not implement)

- Xero push/pull.
- Live feedback ingestion from ClickUp or other systems.
- AI beyond process-step generation.
- Capacity/availability planning.
- Per-user roles (single shared login only).
