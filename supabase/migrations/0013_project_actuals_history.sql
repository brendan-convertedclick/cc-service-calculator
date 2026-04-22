-- 0013_project_actuals_history.sql
-- Apply via mcp__cc-supabase__apply_migration (name: project_actuals_history)
--
-- Convert project_actuals from a single-row-per-task "latest state" table into
-- an append-only history. Each run of sync-clickup-actuals now INSERTs a new
-- row per task rather than UPDATE-ing in place, so we retain every snapshot
-- the cron sees. This unlocks burn-over-time charting without any further
-- schema change.
--
-- Changes:
--   1. Add recorded_at (timestamptz) for snapshot ordering, via the
--      add-nullable / backfill / not-null / default pattern so re-applying
--      the migration is a true no-op (see section 1 comment for why).
--   2. Drop the old unique (project_id, clickup_task_id) index — append-only
--      semantics mean we expect many rows for the same task over time.
--   3. Add a composite index on (project_id, clickup_task_id, recorded_at desc)
--      so "latest row per task" lookups (via DISTINCT ON or the new view) hit
--      an index rather than sorting the whole partition.
--   4. Create view project_actuals_current returning only the most-recent
--      snapshot per (project_id, clickup_task_id). Same column shape as the
--      base table, so consumers can swap from the table to the view without
--      any other code change.
--
-- All statements are idempotent so re-applying is safe.

-- 1. recorded_at column — add-nullable, backfill, set NOT NULL, set default.
--
-- The split matters for idempotency. Adding the column nullable means the
-- backfill UPDATE's `where recorded_at is null` precisely identifies
-- pre-migration rows: on first apply, every existing row matches and gets
-- synced_at copied over. On any re-apply, every row either (a) pre-dated
-- the first apply and was already backfilled to NOT NULL, or (b) was
-- inserted after the first apply and got recorded_at from the default —
-- either way, zero rows match `is null`, so the UPDATE is a true no-op.
--
-- This avoids the pitfall of a WHERE-on-value guard (e.g.
-- `recorded_at <> synced_at`): the edge fn sets synced_at in JS, while
-- postgres evaluates `default now()` for recorded_at independently, so
-- they typically differ by a few ms and a re-apply would silently rewrite
-- every post-migration row.
alter table public.project_actuals
  add column if not exists recorded_at timestamptz;

update public.project_actuals
   set recorded_at = synced_at
 where recorded_at is null;

alter table public.project_actuals
  alter column recorded_at set not null;

alter table public.project_actuals
  alter column recorded_at set default now();

-- 2. Drop legacy uniqueness constraint.
drop index if exists public.project_actuals_project_task_idx;

-- 3. Latest-row-per-task lookup index.
create index if not exists project_actuals_project_task_time_idx
  on public.project_actuals (project_id, clickup_task_id, recorded_at desc);

-- 4. "Current" view — latest snapshot per (project_id, clickup_task_id).
drop view if exists public.project_actuals_current;
create view public.project_actuals_current as
  select distinct on (project_id, clickup_task_id) *
    from public.project_actuals
   order by project_id, clickup_task_id, recorded_at desc;
