# User-action items — rebuild branch `rebuild/phases-0-to-4`

These are the steps the rebuild could not complete autonomously. Work through them in order. Most are one-time setup; a few must happen before applying any new migration.

## CRITICAL — do before applying migrations

### 1. Rotate the publishable anon key (HIGH)
The key `sb_publishable_UcaLJ0sbL5jRDntcT5r-EA_KxL6hxfp` is in git history (committed in migration `0011_cron_sync_actuals.sql`). Migration `0012_security_hardening.sql` rewrites the cron job so it no longer hardcodes a key, but the old key is still valid until rotated.

- In the Supabase dashboard, rotate the publishable (anon) key.
- Update `.env.local` `VITE_SUPABASE_ANON_KEY` to the new value.
- Update GitHub Actions / deployment env if relevant.

### 2. Set the `app.anon_key` postgres setting (HIGH)
Migration `0012` reads the cron job's anon-key header from `current_setting('app.anon_key', true)` instead of a literal. Set it once with the (rotated) key:

```sql
alter database postgres set app.anon_key = 'sb_publishable_…';
```

If unset, the cron job's HTTPS POST will return NULL headers and fail at the HTTP layer (visible in pg_cron logs).

### 3. Set `CLICKUP_PAT` as a Supabase Edge Function secret (HIGH)
Migration `0017` drops `settings.clickup_pat`. The `push-to-clickup` and `sync-clickup-actuals` edge functions now read `Deno.env.get('CLICKUP_PAT')`. Without this set, both functions return "CLICKUP_PAT secret not set" / "clickup disabled or CLICKUP_PAT not set".

In Supabase dashboard → Edge Functions → Secrets, add `CLICKUP_PAT` with the same value the `settings.clickup_pat` row holds today.

## Apply migrations (HIGH)

Apply migrations 0012 through 0020 in order. Each migration's header includes a one-line `mcp__cc-supabase__apply_migration` invocation (replace with `supabase db push` if you don't use the MCP).

| # | Name | Notes |
|---|------|-------|
| 0012 | security_hardening | Requires action 1+2 above first |
| 0013 | project_actuals_history | Append-only history; backfills synced_at → recorded_at |
| 0014 | drop_service_allocation_overrides | Drops dead deprecated table |
| 0015 | projects_name | Backfills via projects → quotes → scopes → briefs join |
| 0016 | db_housekeeping | Section 3 silently NULLs out unmatched locked_by/triaged_by — see action 5 |
| 0017 | clickup_pat_to_secret | Requires action 3 above first |
| 0018 | quote_service_overrides | Adds unique (quote_id, ordinal) constraint; check existing data first |
| 0019 | quote_line_item_allocations | Backfills line_items_jsonb into snapshot rows |
| 0020 | master_sows | Self-contained seed of 11 master SOW templates |

## Audit before applying

### 4. Verify migration 0002 state (MED)
Migration `0002_*.sql` is missing from the repo. The numbering jumps 0001 → 0003. Run:

```sql
select * from supabase_migrations.schema_migrations order by version;
```

If `0002` appears in the live DB, recreate a placeholder file with a comment explaining what it contained (read git history if recoverable). If it never existed, add a brief placeholder so the gap is intentional.

### 5. Audit `scopes.locked_by` and `briefs.triaged_by` before applying 0016 (MED)
Migration `0016` converts these from text to uuid FK to `team_members(id)`. Best-effort match on full_name and email; unmatched values silently become NULL. Before applying:

```sql
select distinct locked_by from scopes where locked_by is not null
  and lower(locked_by) not in (select lower(full_name) from team_members)
  and lower(locked_by) not in (select lower(email) from team_members);

select distinct triaged_by from briefs where triaged_by is not null
  and lower(triaged_by) not in (select lower(full_name) from team_members)
  and lower(triaged_by) not in (select lower(email) from team_members);
```

Any results = attribution that will be lost on conversion. Either fix the team_members row first, or accept the loss.

## Deploy edge functions (HIGH)

After migrations apply, redeploy all 7 edge functions so they pick up the migration to the `_shared/` modules and the new schema reads:

- `draft-scope`
- `draft-sow`
- `suggest-services`
- `generate-process-steps`
- `render-sow-pdf`
- `push-to-clickup`
- `sync-clickup-actuals`

```sh
supabase functions deploy draft-scope
# … etc, or use the MCP
```

## Type regeneration (MED)

After all migrations apply, regenerate `src/types/db.ts`:

```sh
supabase gen types typescript --project-id lpgwxacoqiqpcfpkklib > src/types/db.ts
```

This replaces hand-edits made during the rebuild for tables (`master_sows`, `quote_service_overrides`, `quote_line_item_allocations`) and removes references to the dropped `service_allocation_overrides` + `line_items_jsonb` columns. The hand-edits should be byte-identical to the regenerated output; if not, the regenerated version wins.

## Optional — script setup for SOW sync (LOW)

`scripts/sync-sows.ts` was rewritten to upsert directly into the `master_sows` table via a service-role key. To use `npm run sync-sows`:

- Add to `.env.local`:
  - `SUPABASE_URL=https://lpgwxacoqiqpcfpkklib.supabase.co`
  - `SUPABASE_SERVICE_ROLE_KEY=<service-role-key>` (NOT the anon key)
- Migration 0020 self-seeds with current content, so this is only needed when SOW templates change.

## Google OAuth setup (HIGH)

Required before individual Google sign-in works in a real browser. The code is already merged — this is dashboard-only configuration.

### 1. Create Google Cloud OAuth credentials

In [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID:
- Application type: **Web application**
- Authorised redirect URI: `https://lpgwxacoqiqpcfpkklib.supabase.co/auth/v1/callback`

Copy the **Client ID** and **Client Secret**.

### 2. Enable Google provider in Supabase

In Supabase dashboard → Authentication → Providers → Google:
- Toggle **Enabled**
- Paste the Client ID and Client Secret from step 1
- Save

### 3. Add redirect URLs

In Supabase dashboard → Authentication → URL Configuration → Redirect URLs, add:
- `http://localhost:5174`
- Production URL (when available)

---

## Items deferred from the original plan (LOW)

These were part of the original plan but consciously deferred during execution. Track or schedule as needed.

- **Money column standardization on `bigint`** (plan item 1.10) — requires risky type changes on existing rows; document and defer.
- **`ServicesList` virtualization** (plan item 3.2) — `@tanstack/react-virtual` conflicted with the sticky-column `<table>` layout. Memoization landed; full virtualization deferred until catalogue grows beyond several hundred services.
- **Tests for `useQuoteBuilder` and `push-to-clickup` rollback** (plan item 4.x) — would each require a substantial mock harness; pure-logic tests in `src/lib/*.test.ts` still pass (28 vitest + 9 Deno tests).
- **`burn_sync_cron_minutes` UI re-wiring to `cron.alter_job`** — the column was instead removed in 0017 because it was inert; cron cadence changes via `select cron.alter_job(...)` manually.
- **Feature folders restructure (`src/features/...`)** — the architecture review proposed reorganizing into per-domain folders. Plan moved on without this; the actual T2.x work touched the same files anyway and a future restructure can happen incrementally.
