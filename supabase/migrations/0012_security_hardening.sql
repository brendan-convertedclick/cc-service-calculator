-- 0012_security_hardening.sql
-- Apply via mcp__cc-supabase__apply_migration (name: security_hardening)
--
-- Phase 0 safety fixes:
-- (a) Replace the hardcoded anon key in the cron job with current_setting()
-- (b) Enable RLS on list_aliases and list_alias_overrides (0009 forgot)
-- (c) Add authenticated-all storage policies to brief-attachments and quote-pdfs (0010 deferred)

-- ============================================================
-- (a) Reschedule sync-clickup-actuals-30min without the literal key
-- ============================================================
--
-- The previous schedule (0011) embedded the publishable anon key as a string
-- literal in the cron body, committing it to git. Rewrite the schedule so the
-- Authorization/apikey headers read from a postgres setting the operator
-- configures out-of-band:
--
--   alter database postgres set app.anon_key = 'sb_publishable_...';
--
-- When the setting is absent, current_setting('app.anon_key', true) returns
-- NULL, producing NULL header values; jsonb_build_object keeps the keys but
-- with null values, and the HTTPS POST fails cleanly at the HTTP layer rather
-- than sending a malformed 'Bearer ' header.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-clickup-actuals-30min') then
    perform cron.unschedule('sync-clickup-actuals-30min');
  end if;
end $$;

select cron.schedule(
  'sync-clickup-actuals-30min',
  '*/30 * * * *',
  $cron$
  select net.http_post(
    -- project URL is intentionally static here; change if the project is cloned to a different ref
    url := 'https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/sync-clickup-actuals',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.anon_key', true),
      'apikey', current_setting('app.anon_key', true)
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- ============================================================
-- (b) RLS on list_aliases and list_alias_overrides
-- ============================================================
-- 0009 created these tables without RLS; add it now for parity with every other public table.

alter table public.list_aliases enable row level security;
alter table public.list_alias_overrides enable row level security;

drop policy if exists list_aliases_authed_all on public.list_aliases;
create policy list_aliases_authed_all
  on public.list_aliases
  for all to authenticated
  using (true) with check (true);

drop policy if exists list_alias_overrides_authed_all on public.list_alias_overrides;
create policy list_alias_overrides_authed_all
  on public.list_alias_overrides
  for all to authenticated
  using (true) with check (true);

-- ============================================================
-- (c) Storage policies for brief-attachments and quote-pdfs
-- ============================================================
--
-- storage.objects does not support `for all`; split per verb.

alter table storage.objects enable row level security;

-- brief-attachments
drop policy if exists "authed_all_brief_attachments_select" on storage.objects;
create policy "authed_all_brief_attachments_select"
  on storage.objects for select to authenticated
  using (bucket_id = 'brief-attachments');

drop policy if exists "authed_all_brief_attachments_insert" on storage.objects;
create policy "authed_all_brief_attachments_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'brief-attachments');

drop policy if exists "authed_all_brief_attachments_update" on storage.objects;
create policy "authed_all_brief_attachments_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'brief-attachments')
  with check (bucket_id = 'brief-attachments');

drop policy if exists "authed_all_brief_attachments_delete" on storage.objects;
create policy "authed_all_brief_attachments_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'brief-attachments');

-- quote-pdfs
drop policy if exists "authed_all_quote_pdfs_select" on storage.objects;
create policy "authed_all_quote_pdfs_select"
  on storage.objects for select to authenticated
  using (bucket_id = 'quote-pdfs');

drop policy if exists "authed_all_quote_pdfs_insert" on storage.objects;
create policy "authed_all_quote_pdfs_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'quote-pdfs');

drop policy if exists "authed_all_quote_pdfs_update" on storage.objects;
create policy "authed_all_quote_pdfs_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'quote-pdfs')
  with check (bucket_id = 'quote-pdfs');

drop policy if exists "authed_all_quote_pdfs_delete" on storage.objects;
create policy "authed_all_quote_pdfs_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'quote-pdfs');
