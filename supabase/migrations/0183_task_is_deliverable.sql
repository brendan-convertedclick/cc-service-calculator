-- 0183_task_is_deliverable.sql
--
-- A pipeline task is either a DELIVERABLE (something handed over or
-- published: a guide, a landing page, a report, the month's posts) or a TASK
-- (work that produces nothing the school receives). The planner card shows
-- which with one icon, and a click on it flips the flag.
--
-- The template carries the default; school_tasks copies it on insert through
-- a trigger, so every insert path (0150, 0151, 0181) inherits it without
-- those functions being rewritten.

alter table public.pipeline_template_tasks
  add column if not exists is_deliverable boolean not null default false;
alter table public.school_tasks
  add column if not exists is_deliverable boolean not null default false;

with deliverables(label) as (
  values
    ($d$Campaign live on the T-minus schedule$d$),
    ($d$Facebook and PMax campaigns built in Slate — ready, not live$d$),
    ($d$Search campaign live within three days of publish$d$),
    ($d$Always-on search live$d$),
    ($d$Five social posts published — two brand, two brag, one FAQ from the current guide$d$),
    ($d$Google Business Profile post and profile hygiene$d$),
    ($d$Live posts on the day$d$),
    ($d$FAQ social post set cut from the guide$d$),
    ($d$Guide layout from the Figma master, brand variables applied$d$),
    ($d$Choosing guide published on the hub, gated, form tested end to end$d$),
    ($d$Fees guide published on the hub — the same URL as the previous edition$d$),
    ($d$Ultimate guides refreshed$d$),
    ($d$Bot FAQ content refreshed from the new guide$d$),
    ($d$Enablement pack masters refreshed$d$),
    ($d$Ad creative set adapted from the kit — multiple concepts, rotation built in$d$),
    ($d$PMax asset set from the Figma kit$d$),
    ($d$Web banner and Facebook cover from the kit$d$),
    ($d$Open day landing page built on the hub and tested$d$),
    ($d$Granite booking form and event pipeline cloned for the cycle$d$),
    ($d$Emailer to the school's base and WhatsApp blast written$d$),
    ($d$Campaign feedback report within ten working days — bookings, cost per booking, traced$d$),
    ($d$School calendar published$d$),
    ($d$Post-open-day nurture running for every booked family$d$),
    ($d$Monthly enrolment report delivered by working day five$d$),
    ($d$Written update sent — generated, reviewed before it goes$d$),
    ($d$Quarterly fee benchmark — every figure sourced and dated$d$),
    ($d$Renewal pack with year-on-year proof on every headline number$d$),
    ($d$Next year's annual calendar issued$d$)
)
, t as (
  update public.pipeline_template_tasks p set is_deliverable = true
    from deliverables d where p.label = d.label
  returning p.id
)
update public.school_tasks s set is_deliverable = true
  from deliverables d where s.label = d.label;

-- ponytail: matched by label because school_tasks keeps no key back to its
-- template task. A renamed template task stops passing its flag on; add a
-- template_task_id to school_tasks if that starts to matter.
create or replace function public.tg_school_tasks_inherit_deliverable()
returns trigger
language plpgsql
as $$
begin
  if not new.is_deliverable then
    new.is_deliverable := exists (
      select 1 from public.pipeline_template_tasks p
       where p.label = new.label and p.is_deliverable
    );
  end if;
  return new;
end;
$$;

drop trigger if exists school_tasks_inherit_deliverable on public.school_tasks;
create trigger school_tasks_inherit_deliverable
  before insert on public.school_tasks
  for each row execute function public.tg_school_tasks_inherit_deliverable();
