-- CC Service Calculator — clients page + ClickUp folder linking
-- Apply via mcp__cc-supabase__apply_migration (name: settings_clickup_clients_space_id)

alter table public.settings
  add column if not exists clickup_clients_space_id text;

comment on column public.settings.clickup_clients_space_id is
  'ClickUp top-level space id that contains client folders. Used by list-clickup-folders to populate the Clients page dropdown.';
