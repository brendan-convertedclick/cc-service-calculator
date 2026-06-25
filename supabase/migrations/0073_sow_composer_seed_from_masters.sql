-- Scope Composer — bootstrap the template library from the 12 existing
-- master_sows so the library is non-empty on day one rather than starting
-- blank. One sow_templates(kind='template') row per master, with a single
-- prose section whose markdown = body_md and master_sow_slug set for
-- traceability.
--
-- Idempotent + re-runnable: skips masters that already have a template.
-- Apply with mcp__cc-supabase__apply_migration name 'sow_composer_seed_from_masters'.

insert into public.sow_templates (name, slug, kind, master_sow_slug, body, schema_version)
select
  m.title,
  'tpl-' || m.slug,
  'template',
  m.slug,
  jsonb_build_array(
    jsonb_build_object(
      'id', gen_random_uuid()::text,
      'type', 'prose',
      'ordinal', 0,
      'props', jsonb_build_object('markdown', m.body_md)
    )
  ),
  1
from public.master_sows m
where not exists (
  select 1 from public.sow_templates t where t.master_sow_slug = m.slug
);
