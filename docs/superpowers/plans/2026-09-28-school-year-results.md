# School year results — implementation plan

Spec: `docs/superpowers/specs/2026-09-28-school-year-results-design.md`. Mockup: `…-mockup.html` in the same folder.
Worktree: `.claude/worktrees/school-results`, branch `feat/school-results`. Never `git add -A`; add explicit paths. Commit at the end of each task.

## Task 1 — Database (Sonnet)
1. Write `supabase/migrations/0178_school_results.sql` exactly per the spec's data model, triggers, RLS and seed. Idempotent (`if not exists`, `create or replace`, `drop policy if exists`). Seed with fixed uuids or `on conflict do nothing` keyed on template name so a re-run does not duplicate.
2. Apply to the live project `lpgwxacoqiqpcfpkklib` via the Management API (the cc-supabase MCP is unauthorised in this session):
   `jq -Rs '{query: .}' <file> | curl -s -X POST https://api.supabase.com/v1/projects/lpgwxacoqiqpcfpkklib/database/query -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN_CC_CALCULATOR" -H "Content-Type: application/json" -d @-` (source `~/.zshenv` for the token). Then insert the ledger row `insert into supabase_migrations.schema_migrations (version, name) values ('<yyyymmddhhmmss>', 'school_results')`.
3. Verify: tables exist, 6 templates seeded, trigger rejects a third star and a type change on a field with values (test inside a transaction you roll back).
4. Add hand-written types for the six tables to `src/types/db.ts` in the same shape as neighbouring tables (check how the file is structured; do not regenerate the whole file).

## Task 2 — Pure logic + hooks (Sonnet)
1. `src/lib/results-grid.ts` + `src/lib/results-grid.test.ts` (vitest), per spec. Use `todayISO()` from `@/lib/dates` for "now"; accept `now` as a parameter for tests. Money values are cents, format with `formatZar` from `@/lib/utils`.
2. `src/hooks/useResults.ts` per spec. Board query loads groups → rows → entries+values for the requested years in as few round trips as possible (three selects is fine). Save = upsert entry on `(row_id,year,month)` then upsert/delete value rows. `updated_by` = `currentUserId` (may be null on the shared login).
3. `npm run typecheck && npm run test -- results` pass.

## Task 3 — Planner UI (Sonnet)
1. `src/pages/ResultsIndex.tsx`, `src/pages/ResultsPlanner.tsx`, components in `src/components/results/` (grid, cell, panel, year picker, compare picker, group filter, inline add forms). Follow the mockup's behaviour. Use existing shadcn/ui pieces (Button, Popover/Checkbox if present), M3 token classes, `FilterGroup` only if it fits (it is a rail; a popover multi-select is fine here).
2. Routes `/results`, `/results/:clientId` inside the admin gate in `App.tsx`; nav item "Year results" near Pipeline in `navItems.ts`.
3. Gates: `npm run verify`, `npm run lint:dead`, `npm run build`.

## Task 4 — Templates editor (Sonnet)
1. `src/pages/ResultsTemplates.tsx` (+ components) per spec and mockup: list, editor with plan/result field tables, star (max 2, oldest unstarred), type select locked when the field has values (query a count), target select, retire/restore, add field, rename, new template, grid preview, rules card. Edits save on an explicit Save button per template (no autosave).
2. Route `/results/templates` (declare before `/results/:clientId`). Link to it from the planner header.
3. Gates as above.

## Task 5 — Review (Opus)
Independent review of the branch diff against the spec: correctness, RLS, triggers, the rules list, token usage, CLAUDE.md helper table. Fix findings via a Sonnet fixer. Then browser check on a dev server from the worktree (`npm run dev -- --port 5396 --strictPort`), create groups for Kings College via the UI, enter a plan and a result, compare years, edit a template.
