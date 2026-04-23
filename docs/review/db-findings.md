# Database Review Findings — cc-service-calculator

**Reviewed:** 2026-04-22  
**Reviewer role:** Database specialist  
**Scope:** All 10 migrations (0001, 0003–0011), hooks in `src/hooks/`, edge functions in `supabase/functions/`

> **Note:** The `mcp__cc-supabase__*` MCP server requires `SUPABASE_ACCESS_TOKEN_CC_CALCULATOR` in the environment, which was not set in this session. All findings below are derived from migration SQL, hook source, and edge-function source. Live-state queries (pg_indexes, pg_stat_user_tables, cron.job) could not be executed; findings marked with *(live check needed)* should be verified once the env var is set.

---

## Summary

1. **A publishable API key is committed in plain text in migration 0011.** The `sync-clickup-actuals-30min` cron job embeds `sb_publishable_UcaLJ0sbL5jRDntcT5r-EA_KxL6hxfp` directly in the SQL. This is in git history permanently and should be rotated.
2. **`settings` table stores the ClickUp PAT and (optionally) Xero OAuth tokens as plain text/jsonb in a user-readable row.** Any authenticated session can read `settings.*`, including the PAT. On a single-shared-login app this is currently acceptable but becomes a critical issue the moment per-user auth lands.
3. **`quotes.line_items_jsonb` denormalises the allocation snapshot into an opaque blob, breaking the single source of truth.** This is the only record of what was sent to ClickUp; the DB has no way to join or query individual line items without JSON path operators, and there is no FK to `services`.
4. **`project_actuals` has no `updated_at` column and no `created_at` column beyond `synced_at`, making audit trails impossible.** Rows are upserted on every cron cycle; there is no history of how actuals changed over time.
5. **`service_allocation_overrides` is deprecated-in-place (migration 0003 comments it out, drops its trigger, but does not drop the table).** It still exists, `useService` still queries it, and `useServices` ships its type to the UI. This creates dead-code debt that will silently diverge from the live data model.

---

## Schema Issues

### 1. `quotes.line_items_jsonb` — denormalised snapshot, no FK integrity

**Location:** `supabase/migrations/0006_quotes.sql:15`  
**What's wrong:** The column stores a snapshot of line items as opaque JSONB. The shape is `SnapshotLineItem[]` (defined only in `push-to-clickup/index.ts:26-36`), not enforced by any DB constraint. There is no FK to `services`, `departments`, or `project_actuals`. Querying "which services appear in accepted quotes" requires `jsonb_array_elements` and text casts. There is no DB-level guarantee that `dept_id` inside the JSON corresponds to any real `departments.id`.

**Greenfield design:** Normalise into a `quote_line_item_allocations` junction: `(quote_id, service_id, dept_id, hours, cost_share_cents)`. The `quote_services` table already exists but stores the *service selection*; a separate allocation snapshot table is needed to record what was pushed to ClickUp without losing the link to live entities.

**Severity:** M — no data corruption risk today (single-user), but prevents any useful reporting, and the shape assumption silently breaks if `push-to-clickup` is changed.

---

### 2. `project_actuals` — missing `created_at`, no audit history

**Location:** `supabase/migrations/0007_projects_and_actuals.sql:17-29`  
**What's wrong:** `project_actuals` has `synced_at timestamptz not null default now()` but no `created_at`. Every cron cycle upserts rows in-place (`update … eq("id", a.id)` in `sync-clickup-actuals/index.ts:76-84`), destroying the previous value. There is no way to reconstruct the burn rate curve over time; you only ever have the most recent snapshot per task.

Also missing: `updated_at` (the `tg_touch_updated_at` trigger is not applied to this table). The `tg_touch_updated_at` trigger exists on `departments`, `rules`, `services`, `team_members`, `process_steps` but not `projects` or `project_actuals`.

**Greenfield design:** Either (a) make `project_actuals` an append-only time-series log — each cron run inserts new rows with `recorded_at timestamptz default now()`, keeping history — or (b) keep the current upsert model and add a separate `project_actuals_history` table populated by a trigger on update. Option (a) is simpler and lets you render a real burn chart.

**Severity:** H — the burn chart feature (`useProject` in `src/hooks/useProjects.ts`) currently shows only a point-in-time snapshot. Historical trend data is permanently lost on each sync.

---

### 3. `projects` — no `updated_at`, `tg_touch_updated_at` trigger not applied

**Location:** `supabase/migrations/0007_projects_and_actuals.sql:6-15`  
**What's wrong:** `projects` has `updated_at timestamptz not null default now()` but no `trg_projects_touch` trigger is created in any migration. The column will not auto-update on any `UPDATE`. The only mutation path is `sync-clickup-actuals/index.ts:88-91` which passes an explicit `updated_at: new Date().toISOString()` — but `push-to-clickup` does not, and any future code that forgets to pass `updated_at` will silently leave stale values.

**Greenfield design:** Apply `tg_touch_updated_at` to `projects` in the same block as the other tables in migration 0001 (or add it in 0007 alongside the table creation).

**Severity:** L — low impact currently, but inconsistent convention.

---

### 4. `settings.clickup_pat` and `settings.xero_oauth_tokens` — secrets in a user-readable table

**Location:** `supabase/migrations/0008_settings.sql:9-10`  
**What's wrong:** `clickup_pat text` and `xero_oauth_tokens jsonb` are stored in the `settings` table, which is readable by any authenticated user (the RLS policy is `for all to authenticated using (true)`). On a single-shared-login app this is low risk, but:
- Any future multi-user setup will expose the ClickUp PAT to every user.
- The PAT is also logged in Supabase edge function logs when it appears in queries.
- There is no encryption at rest beyond what Postgres/Supabase provides by default.

**Greenfield design:** Store integration credentials as Supabase Secrets (env vars) on the edge functions rather than in a DB table. The `settings` table should only hold non-sensitive configuration (sync cadence, feature flags, model name).

**Severity:** M today (single login), H when multi-user auth lands.

---

### 5. `settings` single-row pattern — `check (id = 1)` is correct but fragile

**Location:** `supabase/migrations/0008_settings.sql:5`  
**What's wrong:** The `id int primary key default 1 check (id = 1)` pattern enforces a singleton, which is correct. However, every edge function reads this row with `.eq("id", 1).single()` without a `.maybeSingle()` fallback. If the row is ever accidentally deleted (the insert in 0008 is a one-shot; migrations are not re-run in prod), every edge function will throw a 500.

**Greenfield design:** Use `maybeSingle()` and default all settings inline in the function. Or: add a `not null` default for every settings column so the row can be re-inserted safely with `insert … on conflict do nothing`.

**Severity:** L — low probability, but catastrophic if triggered.

---

### 6. `scopes.locked_by` and `briefs.triaged_by` — loose `text` columns that should reference `auth.users` or `team_members`

**Location:** `supabase/migrations/0005_intake_pipeline.sql:62-63` and `:44`  
**What's wrong:** `locked_by text` and `triaged_by text` store free-form strings (presumably email or name). There is no FK to `team_members` or `auth.users`. This means: (a) you can never join to get the team member's full record, (b) a typo silently inserts bogus data, (c) if a team member is renamed, these historical records don't update.

**Greenfield design:** Replace with `locked_by uuid references public.team_members(id) on delete set null` and `triaged_by uuid references public.team_members(id) on delete set null`. In the current single-login app this can simply reference `team_members.id`; in a multi-user future it would reference `auth.users.id`.

**Severity:** L — data quality issue, not a correctness bug today.

---

### 7. `contacts` — no `updated_at`

**Location:** `supabase/migrations/0005_intake_pipeline.sql:23-31`  
**What's wrong:** `contacts` has only `created_at`. There is no `updated_at` and no `tg_touch_updated_at` trigger applied. If a contact's `full_name`, `role`, or `is_primary` changes, there is no way to know when it changed.

**Greenfield design:** Add `updated_at timestamptz not null default now()` and apply the `tg_touch_updated_at` trigger, consistent with every other mutable table in the schema.

**Severity:** L.

---

### 8. `clients` — `archived_at` soft-delete present; `contacts` has none

**Location:** `supabase/migrations/0005_intake_pipeline.sql`  
**What's wrong:** `clients` has `archived_at timestamptz` (soft-delete). `contacts` does not. If a client is archived, all their contacts remain fully visible in queries that don't filter on `clients.archived_at`. `useClients` in `src/hooks/useClients.ts` may not filter on `archived_at` (file not read — should be verified).

**Greenfield design:** Add `archived_at timestamptz` to `contacts` for consistency, or document explicitly that contacts are archived by cascading from `clients`. Currently the cascade is `on delete cascade` (hard delete), not soft-delete, so the two approaches are mixed.

**Severity:** L.

---

### 9. `quote_services.hours_override` and `allocation_override` — opaque JSONB, undocumented shape

**Location:** `supabase/migrations/0006_quotes.sql:37-38`  
**What's wrong:** Two `jsonb` columns with no documented schema, no check constraints, and no FK structure. The shape is never referenced in any migration comment or constraint. Edge functions (`draft-sow`) do not consume these columns. The hooks (`useQuotes`) fetch them but the UI (`QuoteLineEditor`) presumably uses them — verifying the actual shape requires reading the component.

**Greenfield design:** If `hours_override` is a per-department hours map and `allocation_override` is a per-department pct map, both should be typed jsonb check constraints or normalised into a `quote_service_overrides (quote_service_id, dept_id, hours_override, pct_override)` table with real FKs.

**Severity:** M — invisible schema drift risk; hard to maintain.

---

### 10. `list_aliases.aliases` — `text[]` array column, no normalisation

**Location:** `supabase/migrations/0009_list_aliases.sql:12`  
**What's wrong:** `aliases text[] not null` stores multiple ClickUp list name strings as a Postgres array. Searching for a specific alias requires `= ANY(aliases)` or `@>` operators. The migration comment notes that this table must be kept manually in sync with a skills file (`~/.claude/skills/brief/references/list-aliases.md`). This is a dual-source-of-truth problem acknowledged in the comment but not resolved.

**Greenfield design:** If aliases will grow or be queried individually, normalise into `list_alias_values (alias_id uuid pk, work_stream text references list_aliases(work_stream), alias text not null, unique(work_stream, alias))`. This allows simple `WHERE alias = $1` queries and removes the array dependency.

**Severity:** L — works fine for the current data volume (~8 rows), but the manual sync comment is a maintainability risk.

---

### 11. Money type inconsistency: `bigint` vs `integer` for cents

**Location:** `supabase/migrations/0006_quotes.sql:17-20` vs `0001_init.sql:11`  
**What's wrong:** `quotes.subtotal_cents` and `quotes.total_cents` are `bigint`. All other money columns (`departments.hourly_rate_cents`, `services.sell_price_cents`, `project_actuals.planned_hours` is numeric, `team_members.cost_rate_cents`) are `integer`. The CLAUDE.md convention says "stored as int cents" but `bigint` is used for quote totals. This is actually correct (a quote with many services can exceed 2^31 cents = ~R21M), but the inconsistency is undocumented and causes implicit casts in views and expressions.

**Greenfield design:** Standardise on `bigint` for all money columns (a 2G-cent = R20M limit on individual service prices is plausible). Document the choice in a schema comment.

**Severity:** L — no current overflow risk for individual service prices, but the mixed convention is confusing.

---

### 12. `service_allocation_overrides` — deprecated table still live, still queried

**Location:** `supabase/migrations/0003_checklist_source_of_truth.sql:31-35`; `src/hooks/useServices.ts:71-74`  
**What's wrong:** Migration 0003 adds a `COMMENT` marking `service_allocation_overrides` as deprecated since 2026-04-21 and drops its trigger. However: (a) the table is not dropped, (b) `useService` in `useServices.ts` still selects from it at runtime (`select("*").eq("service_id", id)`), (c) the `ServiceWithTotals` type still exposes `overrides` to components. The `service_allocation_resolved` view was rewritten in 0003 to ignore this table entirely and use `process_steps` as the authoritative source. So the UI fetches data from a table that the view no longer reads — the fetched `overrides` are meaningless.

**Greenfield design:** Drop `service_allocation_overrides` in a migration 0012. Remove the `overrides` fetch and field from `useService`. Update any component reading `overrides`.

**Severity:** M — dead data fetch on every service detail load; confusion risk for future developers.

---

## RLS & Auth

### RLS coverage

All tables created in migrations 0001–0009 have RLS enabled with a single `for all to authenticated using (true) with check (true)` policy. This is correct for a single-shared-login app.

**Tables without explicit RLS check (storage-layer tables):**
- `storage.buckets` entries added in 0010 (`brief-attachments`, `quote-pdfs`) have no storage policies. The comment in 0010 says "Phase 1 runs without RLS; single shared login has full access." This means any authenticated user (or anyone with the anon key, since storage uses anon key for public URLs) can list/download all PDFs. The buckets are `public: false`, which prevents unauthenticated public URL access, but does not prevent a user with the anon key from guessing object paths.

**Severity (storage policies):** M — low risk with a single shared login, but becomes H when per-user auth lands. Add storage policies before that point.

### `list_aliases` and `list_alias_overrides` — RLS not enabled

**Location:** `supabase/migrations/0009_list_aliases.sql`  
**What's wrong:** Migration 0009 creates `list_aliases` and `list_alias_overrides` but does not call `alter table … enable row level security` or create policies for either table. This means these tables are **accessible to the `anon` role** (unauthenticated requests) if Supabase's default deny-unless-RLS-enabled behaviour is overridden. By default in Supabase, if RLS is not enabled on a table, the `anon` role can only access it if an explicit `GRANT` was issued. No explicit grant is in the migrations, so these tables likely default to no access — but this should be confirmed. The safer and more consistent pattern is to enable RLS and apply the same `authenticated_all` policy used everywhere else.

**Severity:** M — inconsistency with every other table in the schema; confirm live state.

### `settings` — RLS enabled but all-access for authenticated

**Location:** `supabase/migrations/0008_settings.sql`  
**What's wrong:** The `settings` table gets the same `for all to authenticated using (true)` policy as every other table, allowing any authenticated user to read and update it. There is no `for select` / `for update` split, and no restriction on which columns are updatable. Any authenticated session can set `clickup_pat`, `anthropic_model`, or even delete the singleton row.

**Greenfield design:** Split into `for select to authenticated using (true)` (read-only for all) and `for update to authenticated using (true)` (write allowed for all — acceptable in single-login). Or, for hardening, add a `settings_admin` role check. At minimum, document that this table is write-accessible to all sessions.

**Severity:** L in single-login, M when multi-user lands.

---

## Indexing & Performance

### Missing index: `briefs(client_id)` — exists; `briefs(status, received_at)` — exists

Migration 0005 creates:
- `briefs_status_received_idx on public.briefs (status, received_at desc)` — good, covers `useBriefs` which filters on `status` and orders by `received_at desc`.
- `briefs_client_idx on public.briefs (client_id)` — good.

### Missing index: `scopes(brief_id)` — no explicit index

**Location:** `supabase/migrations/0005_intake_pipeline.sql:54-66`  
**What's wrong:** `scopes.brief_id` has `unique` (which implies a unique index), so the constraint implicitly creates `scopes_brief_id_key`. Edge functions (`draft-scope`, `suggest-services`) query `scopes` with `.eq("brief_id", brief_id)` — this is covered by the implicit unique index. No issue.

### Missing index: `process_steps(service_id)` — no explicit index

**Location:** `supabase/migrations/0001_init.sql:85-97`  
**What's wrong:** `process_steps` has a `unique(service_id, ordinal)` constraint, which creates a composite unique index `process_steps_service_id_ordinal_key`. Queries against `process_steps` always filter by `service_id` first (both in views and in `useServices.ts:208-214`). The composite unique index `(service_id, ordinal)` covers `WHERE service_id = $1` efficiently as long as `service_id` is the leading column — which it is. No missing index here.

### Missing index: `quote_services(quote_id, ordinal)` — exists

Migration 0006 creates `quote_services_quote_ordinal_idx on public.quote_services (quote_id, ordinal)`. This covers `useQuote` which queries `quote_id` and orders by `ordinal`. Good.

### Missing index: `project_actuals(project_id)` — covered by unique index

`project_actuals_project_task_idx on (project_id, clickup_task_id)` — covers `useProject` which queries `.eq("project_id", id)`. Good.

### Missing index: `projects(status)` — needed by cron sync

**Location:** `supabase/migrations/0007_projects_and_actuals.sql:6-15`; `sync-clickup-actuals/index.ts:41`  
**What's wrong:** `sync-clickup-actuals` queries `projects` with `.eq("status", "in_progress")` on every cron tick (every 30 minutes). No index on `projects.status` exists. With a small dataset this is a seq scan with no material cost, but as projects accumulate the absence of this index becomes relevant.

**Recommended index:**
```sql
create index projects_status_idx on public.projects (status) where status = 'in_progress';
```
A partial index is ideal here — only `in_progress` projects are polled; completed/cancelled projects are never touched by the cron job.

**Severity:** L now, worth adding proactively.

### Missing index: `project_actuals(clickup_task_id)`

**Location:** `sync-clickup-actuals/index.ts:76`  
**What's wrong:** The cron sync updates `project_actuals` rows with `.eq("id", a.id)` — PK lookup, fine. But there is no index on `clickup_task_id` alone. If a future query needs to look up an actual by task ID (e.g., "which project owns this task?"), a seq scan on `project_actuals` is required. The existing unique index `(project_id, clickup_task_id)` only covers the composite; a standalone `clickup_task_id` lookup requires a seq scan unless the optimiser uses the composite index with a skip scan.

**Recommended index:**
```sql
create index project_actuals_clickup_task_idx on public.project_actuals (clickup_task_id);
```

**Severity:** L — not critical today.

### `service_allocation_resolved` view — recursive CTE cost

**Location:** `supabase/migrations/0004_compound_services.sql:74-175`  
**What's wrong:** The `service_allocation_resolved` view is a recursive CTE (`with recursive tree as (…)`) that walks the `service_children` parent-child tree for every service on every query. `useAllocationMatrix` in `useServices.ts:200-242` queries `select("*")` on this view (full table scan), plus a separate query for all `process_steps` and all `service_children`. This is three sequential queries, but the view itself is expensive at scale because the recursive CTE re-traverses the tree for every root service.

On ~140 seeded services with shallow trees this is negligible. If compound services become common (deeply nested), this view will be slow. The fix is either (a) materialise the view as a materialized view refreshed on `service_children` insert/update, or (b) cache the resolved allocation in a `service_allocation_cache` table updated by a trigger.

**Severity:** L at current data volume, M at scale.

---

## Triggers & Constraints

### Allocation sum guard — `rule_allocations`

**Location:** `supabase/migrations/0001_init.sql:122-143`  
**What's correct:** The trigger `trg_rule_alloc_sum` is a `deferrable initially deferred` constraint trigger. This means the 99.5–100.5 check fires at transaction commit, not per-row. This is the correct design for a "replace all rows" pattern where intermediate states would fail a per-statement check.

**Issue:** The guard fires on `INSERT OR UPDATE OR DELETE` but uses `select coalesce(sum(pct), 0)` which reads the current state *after* the triggering statement. For a `DELETE` that leaves the rule with 0 rows, `coalesce(sum(pct), 0) = 0`, and the `if (select count(*) …) > 0` guard skips the check — so deleting all allocations is permitted. This is intentional (a rule can have zero allocations while being edited) but means a rule can have zero allocations and still be in a "valid" state. A service pointing at such a rule will resolve to zero hours.

**Recommendation:** Add an application-layer warning when a service references a rule with zero allocations. The trigger is correct as-is.

### Service override sum guard — dropped in migration 0003

**Location:** `supabase/migrations/0003_checklist_source_of_truth.sql:31-32`  
The `trg_service_override_sum` trigger and its function are dropped in migration 0003. This is correct — the table is deprecated. No issue.

### Cycle-prevention trigger — `service_children`

**Location:** `supabase/migrations/0004_compound_services.sql:39-68`  
**What's correct:** The recursive CTE cycle check is logically correct. Depth limit of 20 prevents infinite loops.

**Issue:** The trigger fires `before insert or update` but not `before delete`. A `DELETE` of a service that is a child cannot create a cycle, so this is fine. However, the `parent_id <> child_id` self-reference check is a table-level `CHECK` constraint (line 16) — this is correct.

**Issue:** The trigger function uses `NEW.child_id` as the cycle check root, walking *upward* (from parent toward ancestors). This is correct. However, the depth limit `a.depth < 20` applies to the number of hops traversed upward. With a depth limit of 20, a chain of 21 services would pass the cycle check even if the 21st hop creates a cycle — **this is a bug**. If the tree has depth > 20, the cycle guard can be bypassed. In practice, a service tree > 20 levels deep is extremely unlikely, but the guard should use `EXISTS (… WHERE node_id = NEW.child_id)` over an unlimited traversal (relying on `check parent_id <> child_id` to prevent depth-1 cycles), or the depth should be bumped to something like 50.

**Severity:** L — practically impossible to trigger with real data.

### `process_steps` minimum hours constraint

**Location:** `supabase/migrations/0003_checklist_source_of_truth.sql:41-43`  
```sql
check (estimated_hours is null or estimated_hours >= 0.25)
```
This is correct and consistent with the app-layer filter in `useSetServiceChecklist` (`.filter((r) => (r.estimated_hours ?? 0) >= 0.25)`).

---

## Migration Hygiene

### Missing migration 0002

**What happened:** There is no `0002_*.sql` file. The gap is between `0001_init.sql` and `0003_checklist_source_of_truth.sql`. Likely explanations:
- A migration was written, applied locally, then renamed or deleted before being committed to the repo (this breaks replay on a fresh DB).
- The migration was authored as a temporary experiment, applied directly, and never committed.
- The numbering was intentionally skipped (e.g., reserved).

**Risk:** If the live DB has migration 0002 in `supabase_migrations.schema_migrations` but the file no longer exists, `supabase db push` or a fresh `supabase db reset` will fail or produce a divergent schema. *(Live check needed: `select * from supabase_migrations.schema_migrations order by version` to see if 0002 appears.)*

**Recommendation:** Determine what 0002 contained. If it was applied to the live DB and is missing from the repo, recreate the DDL as a no-op migration or add a comment explaining the gap. If it was never applied, add a placeholder file with a comment.

**Severity:** H if the live DB has it; L if it was never applied.

---

### Data backfill in migration 0003 — replay safety

**Location:** `supabase/migrations/0003_checklist_source_of_truth.sql:8-25`  
**What's wrong:** Migration 0003 contains a live data backfill:

```sql
insert into public.process_steps (service_id, ordinal, ...)
select ...
from public.service_allocation_overrides o
  join public.services s ...
where s.sell_price_cents > 0 and d.hourly_rate_cents > 0
  and not exists (select 1 from public.process_steps ps where ps.service_id = o.service_id);
```

This is a one-shot backfill. On a fresh DB (`supabase db reset`), `service_allocation_overrides` will be empty (no seed data in any migration), so the insert produces 0 rows. On the live DB it ran once and migrated data from the old table to the new model. **The migration is not safely replayable** — on a fresh DB it is a no-op rather than a failure, which is acceptable. But anyone doing local development on a fresh DB will have empty `process_steps` and will need to manually seed data or re-run the seed script.

**Severity:** L — documented behaviour, but worth noting.

---

### Additive-only vs destructive migrations

All migrations are additive, with two exceptions:
1. **0003** drops `trg_service_override_sum` trigger and its function (safe — they are superseded).
2. **0003** replaces the `service_allocation_resolved` view using `create or replace` (safe — backward compatible for readers).
3. **0004** replaces `service_allocation_resolved` again with a recursive CTE version.

No migration edits prior migration state in a destructive way. This is good hygiene.

---

### Cron schedule hardcoded in migration 0011 — drift from `settings.burn_sync_cron_minutes`

**Location:** `supabase/migrations/0011_cron_sync_actuals.sql:5-8` (comment) and `:25-39` (body)  
The migration comment explicitly acknowledges: "settings.burn_sync_cron_minutes does NOT automatically reschedule." The cron cadence is fixed at `*/30` in the SQL. The `settings` table has a `burn_sync_cron_minutes int not null default 30` column that has no effect. This is a documented limitation, not a bug, but it creates a discoverability trap — a user changing `settings.burn_sync_cron_minutes` via the UI will see no effect.

**Recommendation:** Either remove `burn_sync_cron_minutes` from the `settings` table (since it does nothing), or implement a Supabase function that calls `cron.alter_job` when the setting changes (a trigger on `settings` that fires `cron.alter_job('sync-clickup-actuals-30min', …)`).

**Severity:** M — silent non-functionality in the settings UI.

---

### Published API key in migration 0011 — critical

**Location:** `supabase/migrations/0011_cron_sync_actuals.sql:32`  
```sql
'Authorization', 'Bearer sb_publishable_UcaLJ0sbL5jRDntcT5r-EA_KxL6hxfp',
'apikey', 'sb_publishable_UcaLJ0sbL5jRDntcT5r-EA_KxL6hxfp'
```
A publishable (anon) key is committed verbatim into a migration file that is tracked in git. This key is now in git history and **cannot be removed by a force push** without coordinating a history rewrite across all clones. The publishable key has limited permissions (anon role only), but since `sync-clickup-actuals` is deployed with `--no-verify-jwt`, anyone who obtains this key can trigger the sync endpoint at will.

**Recommended remediation:**
1. Rotate the publishable key in the Supabase dashboard (this invalidates the committed key immediately).
2. Replace the hardcoded key in the migration with a `current_setting('app.anon_key', true)` reference or use a Postgres secret/parameter, so future re-runs don't re-embed a live key.
3. Note: since the key is already in git history, rotating it is sufficient — a history rewrite is unnecessary for an anon/publishable key (not a service role key).

**Severity:** M (anon key only — not service role); rotate immediately.

---

## Edge Function DB Usage

### `push-to-clickup` — uses anon key with forwarded auth header (correct for RLS)

**Location:** `supabase/functions/push-to-clickup/index.ts:46-49`  
The function uses `SUPABASE_ANON_KEY` with the user's `Authorization` header forwarded — this is the correct pattern for user-context RLS. Service role is not needed here.

**Issue — N+1 pattern in child task creation loop (lines 152-193):**
```typescript
for (const item of items) {
  for (const alloc of item.allocation) {
    const childRes = await fetch(`…/task/${parent.id}`, …); // ClickUp API call
    await fetch(`…/task/${child.id}/comment`, …);           // ClickUp API call
    actualsRows.push(…);
  }
}
if (actualsRows.length > 0) {
  await supabase.from("project_actuals").insert(actualsRows); // batched — good
}
```
The ClickUp task creation and comment calls are sequential (one `await fetch` per allocation). For a quote with 10 services × 3 departments = 30 child tasks, this is 60 sequential HTTP calls. ClickUp's API rate limit is 100 req/min at the free tier. A large quote could hit the rate limit. The `project_actuals` insert is correctly batched at the end.

**Recommendation:** Parallelise child task creation with `Promise.all` or `Promise.allSettled` in groups of 5 to stay within rate limits.

**Severity:** M — functional but slow and fragile on large quotes.

---

### `sync-clickup-actuals` — uses service role (correct), but N+1 against the DB

**Location:** `supabase/functions/sync-clickup-actuals/index.ts:18-23` (service role), `:43-84` (sync loop)  
**Service role usage:** Correct. The cron function bypasses RLS intentionally to read/write all projects.

**N+1 DB pattern:**
```typescript
for (const p of projects ?? []) {
  const { data: actuals } = await supabase.from("project_actuals").select("*").eq("project_id", p.id);
  for (const a of actuals ?? []) {
    await supabase.from("project_actuals").update(…).eq("id", a.id);
  }
  await supabase.from("projects").update(…).eq("id", p.id);
}
```
This is a classic N+1: one query to fetch all projects, then `N` queries to fetch actuals per project, then `M` updates per actual. With 10 in-progress projects × 10 actuals each, this is 10 + 10×10 + 10×10 = 120 DB round trips per cron tick (plus 200 ClickUp API calls).

**Recommended refactor:** Fetch all `project_actuals` for all `in_progress` projects in one query (join or `in` filter on project IDs), then update in batch after processing ClickUp responses.

**Severity:** M — acceptable at small scale, degrades as the project count grows.

---

### `draft-scope` and `suggest-services` — no service role, correct

Both functions use anon key + forwarded auth. They read `briefs`, `scopes`, and `services` — all user-owned data. This is correct.

### `suggest-services` — loads entire active service catalogue on every call

**Location:** `supabase/functions/suggest-services/index.ts:34`  
```typescript
supabase.from("services").select("id,name,code,scope_definition").eq("status", "active"),
```
This fetches all active services on every AI suggestion request. With ~140 services this is fine. With 1,000+ services the prompt will exceed token limits (the catalogue is injected directly into the system prompt). This is a future risk, not a current bug.

**Severity:** L — no immediate action needed.

### `push-to-clickup` — `assignee` resolved by `primary_department_id` match only

**Location:** `supabase/functions/push-to-clickup/index.ts:154-156`  
```typescript
const assignee = (team ?? []).find(
  (t) => t.primary_department_id === alloc.dept_id,
);
```
This finds the *first* team member whose `primary_department_id` matches the allocation's `dept_id`. If multiple team members share a department (common), only the first one found (arbitrary order) gets assigned. The `team_members` table is fetched without ordering, so the assigned member is non-deterministic.

This is a Phase 1 limitation but worth noting — the `assignees` field silently assigns the wrong person in ambiguous cases.

**Severity:** L — known limitation, but undocumented.

### `push-to-clickup` — `projects` row inserted before ClickUp children, but `project_actuals` insert is not transactional

**Location:** `supabase/functions/push-to-clickup/index.ts:133-197`  
**What's wrong:** The function inserts a `projects` row, then loops through ClickUp child task creations, then inserts `project_actuals`. If the edge function crashes mid-loop (e.g., ClickUp rate limit), the `projects` row exists but `project_actuals` is incomplete or empty. There is no rollback mechanism. A subsequent call with the same `quote_id` will fail on the `projects.quote_id unique` constraint (`projects` has `unique` on `quote_id`), leaving the quote permanently in a broken state.

**Recommended fix:** Insert `projects` last (after all ClickUp calls succeed), or wrap the insert in a try/finally that deletes the projects row on failure. Alternatively, add a `clickup_push_status` column to `projects` (`pending | complete | failed`) and set it to `complete` only after all children are created.

**Severity:** H — a failed mid-push leaves the quote permanently un-pushable without manual DB intervention.

---

## Storage Buckets

**Location:** `supabase/migrations/0010_storage_buckets.sql`

- `brief-attachments` (private) — used for email attachment storage. No storage policies defined. The comment acknowledges this ("Phase 1 runs without RLS").
- `quote-pdfs` (private) — used by `render-sow-pdf`. Signed URLs with 90-day TTL are returned. No storage policies.

**Issues:**
1. **No storage policies** — authenticated users can list all objects in both buckets via the Supabase Storage API (`storage.from("quote-pdfs").list()`). A future multi-user setup would expose all clients' PDFs to all users.
2. **90-day signed URLs** — `render-sow-pdf` creates a signed URL with `60 * 60 * 24 * 90` seconds TTL. The URL is stored in `quotes.sow_pdf_url`. If a quote is rejected or superseded, the PDF URL remains valid for 90 days and is not revoked.
3. **PDF path scheme** — `${quote_id}/sow-v${quote.version}.pdf`. The `upsert: true` flag means re-generating a PDF for the same quote version overwrites the file. This is reasonable.

**Severity:** M (storage policies gap), L (URL lifetime).

---

## Recommended Rebuild Order

If this schema were designed from scratch today, the dependency graph suggests this build order:

**Tier 1 — Core reference data (no deps)**
1. `departments` — foundation for all rate and allocation logic
2. `rules` + `rule_allocations` — allocation templates; `rule_allocations` depends on `departments`
3. `team_members` + `team_member_departments` — staff roster; depends on `departments`

**Tier 2 — Service catalogue**
4. `services` — depends on `departments` (via rule_id), `rules`, `team_members`
5. `service_children` — self-referential on `services`
6. `process_steps` — depends on `services`, `departments`
7. `service_allocation_resolved` view — depends on `process_steps`, `services`, `rule_allocations`, `departments`
8. `service_totals` view — depends on `service_allocation_resolved`

**Tier 3 — Intake pipeline**
9. `clients` + `contacts` — client CRM
10. `briefs` — depends on `clients`
11. `scopes` — depends on `briefs`

**Tier 4 — Quoting**
12. `quotes` — depends on `scopes`
13. `quote_services` — depends on `quotes`, `services`
14. *(optional)* `quote_service_allocations` — normalised replacement for `hours_override`/`allocation_override` JSONB

**Tier 5 — Execution tracking**
15. `projects` — depends on `quotes`
16. `project_actuals` — depends on `projects`, `departments`
17. *(optional)* `project_actuals_history` — audit log for actuals changes

**Tier 6 — Configuration & ops**
18. `settings` — standalone singleton
19. `list_aliases` + `list_alias_overrides` — depends on `clients`
20. Storage buckets
21. pg_cron schedule

**Key insight:** The current build order follows this sequence closely. The main structural debt is in Tier 4 (the JSONB snapshot in `quotes.line_items_jsonb` should be a proper Tier 4 table), Tier 5 (`project_actuals` should be append-only for history), and the orphaned `service_allocation_overrides` table (no tier — should be deleted).
