-- 0140_service_procedure_link.sql
-- Applied 2026-09-02 (name: service_procedure_link). Backfilled 28 links.
--
-- One procedure, many services.
--
-- Lisa, 2026-08-28: "A single service should have one procedure attached to
-- it, but procedures can apply to multiple services." The catalogue proves it
-- — one "Carousel Paid Social Posts (Photoshop)" procedure is how we do that
-- work for Facebook, Instagram AND LinkedIn. Today it can be attached to
-- exactly one of the three.
--
-- The link lives on system_definitions.service_id, which points the wrong way
-- for that: a procedure has ONE service_id column, so no index change can make
-- it serve three services. It has to be the service that names its procedure.
--
-- Additive only: no DROP, no destructive ALTER. system_definitions.service_id
-- stays exactly as it is, because system_def_kind_link (0113) requires it for
-- kind='service' and every existing reader uses it.

-- ---------------------------------------------------------------------------
-- 1. services.procedure_id — "this service is delivered by that procedure".
-- ---------------------------------------------------------------------------
-- A column, not a join table: a service has at most one procedure (Lisa's
-- rule), so the many-to-many a join table buys would be a constraint we would
-- immediately have to add back as a unique index on service_id.
alter table public.services
  add column if not exists procedure_id uuid references public.system_definitions(id) on delete set null;

create index if not exists services_procedure_idx
  on public.services (procedure_id) where procedure_id is not null;

comment on column public.services.procedure_id is
  'The procedure this service is delivered by. Many services may name the same procedure; a service names at most one. This is the link readers should use — system_definitions.service_id is the procedure''s HOME service (what system_def_kind_link needs), not the full list of services it serves.';

-- ---------------------------------------------------------------------------
-- 2. Backfill from the existing one-to-one links.
-- ---------------------------------------------------------------------------
update public.services s
   set procedure_id = sd.id
  from public.system_definitions sd
 where sd.service_id = s.id
   and sd.kind = 'service'
   and sd.archived_at is null
   and s.procedure_id is distinct from sd.id;

-- ---------------------------------------------------------------------------
-- 3. Keep the home link mirrored, so the old writers still work.
-- ---------------------------------------------------------------------------
-- The MCP's create-procedure and the systems editor both write
-- system_definitions.service_id and know nothing about this column. Without
-- this trigger a procedure written the old way would attach to a service that
-- then reads as having none. It only ever FILLS the home service's link — the
-- extra services a procedure serves are written directly and are not touched
-- here, and neither is a service that already names a different procedure.
create or replace function public.tg_mirror_procedure_home_service()
returns trigger
language plpgsql
as $$
begin
  if new.kind = 'service' and new.service_id is not null and new.archived_at is null then
    update public.services
       set procedure_id = new.id
     where id = new.service_id
       and procedure_id is null;
  end if;
  return new;
end;
$$;

drop trigger if exists mirror_procedure_home_service on public.system_definitions;
create trigger mirror_procedure_home_service
  after insert or update of service_id, kind, archived_at on public.system_definitions
  for each row execute function public.tg_mirror_procedure_home_service();

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
-- None to add: procedure_id is a column on services, which already carries its
-- own policies. Note that writing it is therefore governed by services' policy,
-- not by the systems-library policies (0118) — attaching a procedure is a
-- statement about the SERVICE, and the service page is where it is done.
