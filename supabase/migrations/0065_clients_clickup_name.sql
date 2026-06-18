-- 0065_clients_clickup_name.sql
-- Apply via mcp__cc-supabase__apply_migration (name: clients_clickup_name)
--
-- ClickUp's "Client Name" dropdown option labels don't always match a client's
-- Conductor name (e.g. "Dovetail RSA" vs the ClickUp option "Dovetail"). Custom
-- field resolution matches by exact option name, so those clients silently miss
-- the Client Name field on created tasks (retainer provisioner + /brief flows).
--
-- This adds an optional per-client override. NULL = use the client's own name
-- (the common case); a value = the exact ClickUp dropdown option label to match.
-- Seeds the known mismatches; the rest already match by name.

alter table public.clients
  add column if not exists clickup_client_name text;

update public.clients c
   set clickup_client_name = v.cu
  from (values
    ('Dovetail RSA', 'Dovetail'),
    ('Crawford & Co / Chedza', 'Chedza'),
    ('GR Executive Financial Adviser', 'GR Financial Advisor'),
    ('Kings College', 'The King''s College'),
    ('Little Flock School', 'Little Flock'),
    ('Black Magic Communications', 'Black Magic'),
    ('Matumaini Guest House', 'Matumaini'),
    ('Peter Rawson Consulting Services', 'Peter Rawson Consulting')
  ) as v(name, cu)
 where c.name = v.name
   and c.clickup_client_name is distinct from v.cu;
