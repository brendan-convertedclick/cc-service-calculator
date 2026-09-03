-- 0157_mm_pipeline_template.sql
-- Apply via mcp__cc-supabase__apply_migration. APPLIED 2026-09-03 as TWO rows:
-- sections 1-2 as `mm_pipeline_template`, section 3 as `pipeline_gate_flag_backfill`.
-- One file, two versions in list_migrations — that is expected, not a gap.
--
-- The Media Mixology Product Specification Pack v1.5 (September 2026) as a
-- pipeline template. Its "12 Month Rollout" tab is the generic annual plan:
-- what runs when, for any school. This migration turns that tab plus the Item
-- Register into rows the planner already knows how to seed.
--
-- ONE NEW CONCEPT: THE OVERLAY.
--
-- 0150's template is keyed on theme, and every month gets exactly ONE theme.
-- That shape carries the campaign spine perfectly — the open day cycles are
-- floating and role-driven, which is the whole reason it was built that way —
-- but it cannot say the two things the workbook is mostly made of:
--
--   * "every month"  — the engines' standing rhythm. Nine units run in all
--     twelve months (A2, A7, A8, A10, I1, P1-P4). Duplicating them into every
--     theme is 100-odd rows saying the same thing, and every edit becomes
--     eleven edits: the second-copy-is-a-second-truth defect this codebase
--     has already audited itself for.
--   * "these months" — the quarterly meeting and fee benchmark, the April and
--     October guide cycles, the hub's quarterly Core Web Vitals check. Which
--     THEME lands on a school's month 3 is not knowable in advance (it depends
--     on where their open days fall), so a theme-keyed template cannot express
--     "every third month" at all.
--
-- So a theme may now be an OVERLAY: role = 'overlay', with a `months` array
-- saying which of the twelve it applies to. Overlays take no slot — they are
-- seeded ON TOP of whatever theme the month resolved to, which is what lets
-- April be both "the month after the open day" and "the month the choosing
-- guide publishes". The month list is DATA, exactly as the role column is
-- data (0150: "the role column is why the derivation is not literals"), so
-- moving the fee benchmark to every fourth month is an array edit, not a
-- deploy.
--
-- The slot machinery is untouched. deriveMonths never asks for an overlay
-- because it only ever assigns the roles it names; seedTasks is the one
-- function that grew.
--
-- WHAT IS DELIBERATELY NOT HERE:
--   * est_hours. The workbook counts effort in "units" (A8 = 2 u/mo, a guide
--     = 10 u) and never says what a unit is in hours. A guessed number that
--     sums into a month header is worse than a blank one — 0150's own rule —
--     so every row is null and one UPDATE fills them in once somebody decides.
--   * The optional engines. Presence (R10 000/mo, all or nothing) and
--     Intelligence (R10 000/mo) are separate overlays for exactly this reason:
--     a school that has not bought one has a single named block to delete,
--     not tasks interleaved through twelve months. The real fix is an engine
--     flag plus a planning answer that filters at seed; this is the version
--     that needs no schema.
--   * A prize/competition theme. Workbook decision 3 killed it.
--   * The old template's enrolment-cycle spine (Offers go out / Acceptances
--     land / Fill the gaps / Close the year out). v1.5 has no counterpart and
--     inventing months the spec does not describe is not building the spec.
--
-- The previous template row STAYS. Kings College and Little Flock were planned
-- from it, seeding copies rows rather than pointing at them, and school_years
-- .template_id is ON DELETE RESTRICT — so it is the record of what those two
-- years actually are. Only the default pointer moves.

-- ===========================================================================
-- 1. A theme may be an overlay
-- ===========================================================================
alter table public.pipeline_template_themes
  drop constraint if exists pipeline_template_themes_role_chk;
alter table public.pipeline_template_themes
  add constraint pipeline_template_themes_role_chk
  check (role in ('spine', 'open_day_before', 'open_day', 'open_day_after', 'prize', 'filler', 'overlay'));

alter table public.pipeline_template_themes
  add column if not exists months int[];

-- An overlay is DEFINED by its month list and nothing else is, the same
-- biconditional shape pinned_month already uses for spine.
alter table public.pipeline_template_themes
  drop constraint if exists pipeline_template_themes_months_chk;
alter table public.pipeline_template_themes
  add constraint pipeline_template_themes_months_chk
  check ((role = 'overlay') = (months is not null));

-- An empty overlay is a theme that applies nowhere, and a month 13 is a month
-- no school has. Both are typos, and both are cheaper to reject here than to
-- find on a board.
alter table public.pipeline_template_themes
  drop constraint if exists pipeline_template_themes_months_range_chk;
alter table public.pipeline_template_themes
  add constraint pipeline_template_themes_months_range_chk
  check (months is null or (array_length(months, 1) between 1 and 12
                            and months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]));

-- "Exactly one theme per non-spine role, or 'which theme is the open day
-- month' has no answer" still holds for the five slot roles. It cannot hold
-- for overlays: a plan needs many, and they compete for nothing.
drop index if exists pipeline_template_themes_role_idx;
create unique index if not exists pipeline_template_themes_role_idx
  on public.pipeline_template_themes (template_id, role)
  where role not in ('spine', 'overlay');

comment on column public.pipeline_template_themes.months is
  'Overlay themes only: which of the twelve months this theme''s tasks are seeded into, on top of the month''s own theme. Null on the six slot roles, whose month is decided by the derivation instead.';

-- ===========================================================================
-- 2. The workbook, as a template
-- ===========================================================================
do $seed$
declare
  v_tpl uuid;
  v_th  uuid;
  v_dep uuid;
  r     record;
begin
  if exists (select 1 from pipeline_templates where name = 'Schools — Media Mixology v1.5') then
    return;
  end if;

  insert into pipeline_templates (name, notes)
  values ('Schools — Media Mixology v1.5',
          'MM Product Specification Pack v1.5, September 2026. Acquisition engine (A1-A12) is never unbundled; '
          'Presence (P1-P4) and Intelligence (I1-I2) are optional — delete their every-month overlay for a school '
          'that has not bought them. Open day cycles float onto the school''s own locked dates; the guide cycle, '
          'the quarterly rhythm and the annual review are overlays on fixed months. Effort is left unestimated: '
          'the workbook counts units, not hours.')
  returning id into v_tpl;

  update settings set default_pipeline_template_id = v_tpl where id = 1;

  -- ---------------------------------------------------------------------
  -- Themes. Six slot themes shape the months; eleven overlays land on top.
  -- ---------------------------------------------------------------------
  for r in
    select * from (values
      ('Set the year up',                    'spine',           1,    null::int[],                          1),
      ('Build the open day machine',         'open_day_before', null, null::int[],                          2),
      ('Open day runs',                      'open_day',        null, null::int[],                          3),
      ('Convert the interest',               'open_day_after',  null, null::int[],                          4),
      ('Steady state',                       'filler',          null, null::int[],                          5),
      ('Annual review and renewal',          'spine',           11,   null::int[],                          6),
      ('School onboarding — first year only','overlay',         null, array[1],                             7),
      ('Choosing guide — production',        'overlay',         null, array[3],                             8),
      ('Choosing guide — publish',           'overlay',         null, array[4],                             9),
      ('Fees guide — production',            'overlay',         null, array[9],                            10),
      ('Fees guide — publish',               'overlay',         null, array[10],                           11),
      ('Hub health check',                   'overlay',         null, array[1,4,7,10],                     12),
      ('Every quarter',                      'overlay',         null, array[3,6,9,12],                     13),
      ('Between the quarters',               'overlay',         null, array[1,2,4,5,7,8,10,11],            14),
      ('Acquisition engine — every month',   'overlay',         null, array[1,2,3,4,5,6,7,8,9,10,11,12],   15),
      ('Intelligence engine — every month',  'overlay',         null, array[1,2,3,4,5,6,7,8,9,10,11,12],   16),
      ('Presence engine — every month',      'overlay',         null, array[1,2,3,4,5,6,7,8,9,10,11,12],   17)
    ) as v(theme, role, pinned_month, months, ordinal)
  loop
    insert into pipeline_template_themes (template_id, theme, role, pinned_month, months, ordinal)
    values (v_tpl, r.theme, r.role, r.pinned_month, r.months, r.ordinal);
  end loop;

  -- ---------------------------------------------------------------------
  -- Tasks. Departments are resolved BY NAME and a miss raises, so a renamed
  -- department fails the migration instead of silently seeding 96 unrouted
  -- rows — the rule create-procedure already follows for the MCP.
  --
  -- Ordinal bands, so a month card reads distinctive work first and the
  -- standing rhythm last: 1-19 the month's own theme · 20-29 the guide cycle ·
  -- 30-59 onboarding · 60-64 hub health · 65-74 the quarterly rhythm ·
  -- 80-89 Acquisition monthly · 90-94 Intelligence monthly · 95-99 Presence.
  -- ---------------------------------------------------------------------
  for r in
    select * from (values
      -- A10/A4/A7 + the four inputs the year cannot start without.
      ('Set the year up','Annual calendar issued — open days, guide dates, quarterly meetings, T-minus chase dates','us','Project Management',1,false),
      ('Set the year up','Nurture sequence copy refreshed for the year','us','Content & Copywriting',2,false),
      ('Set the year up','Always-on search live, seasonal lead set to the choosing guide','us','Paid Media',3,false),
      ('Set the year up','Open day dates locked for the whole year — at least eight weeks before each launch','school',null,4,false),
      ('Set the year up','Targets for the year confirmed in writing','school',null,5,false),
      ('Set the year up','One named point of contact who approves everything','school',null,6,false),

      -- A5, the run-up. Every cycle adapts the kit; no cycle reruns the last
      -- one's creative unchanged (catchment audiences saturate fast).
      ('Build the open day machine','Guide live and converting before PMax goes up — the warm-account prerequisite','us','Paid Media',1,false),
      ('Build the open day machine','Ad creative set adapted from the kit — multiple concepts, rotation built in','us','Creative Production',2,false),
      ('Build the open day machine','PMax asset set from the Figma kit','us','Creative Production',3,false),
      ('Build the open day machine','Open day landing page built on the hub and tested','us','Development',4,false),
      ('Build the open day machine','Granite booking form and event pipeline cloned for the cycle','us','Development',5,false),
      ('Build the open day machine','Emailer to the school''s base and WhatsApp blast written','us','Content & Copywriting',6,false),
      ('Build the open day machine','Facebook and PMax campaigns built in Slate — ready, not live','us','Paid Media',7,false),
      ('Build the open day machine','Retargeting audiences refreshed for the cycle','us','Paid Media',8,false),
      ('Build the open day machine','Web banner and Facebook cover from the kit','us','Creative Production',9,false),
      ('Build the open day machine','Event details, and scholarship mechanics if the school offers them','school',null,10,false),
      ('Build the open day machine','Creative approved — the hard deadline','school',null,11,true),
      ('Build the open day machine','Photography for the cycle from the school''s library','school',null,12,false),

      ('Open day runs','Campaign live on the T-minus schedule','us','Paid Media',1,false),
      ('Open day runs','Bookings flowing into Granite daily, every one attributed','us','Project Management',2,false),
      ('Open day runs','Follow-up firing automatically, reminder sequence in the final week','us','Content & Copywriting',3,false),
      ('Open day runs','Live posts on the day','us','Social Media',4,false),
      ('Open day runs','Attendance recorded against bookings','us','Project Management',5,false),
      ('Open day runs','Campaign feedback report within ten working days — bookings, cost per booking, traced','us','Project Management',6,false),
      ('Open day runs','Attendance list on the day','school',null,7,false),
      ('Open day runs','Approvals inside five working days','school',null,8,false),

      ('Convert the interest','Post-open-day nurture running for every booked family','us','Content & Copywriting',1,false),
      ('Convert the interest','Application prompts to everyone who attended','us','Content & Copywriting',2,false),
      ('Convert the interest','Reviews requested from attending families','us','Project Management',3,false),
      ('Convert the interest','Pipeline review — who is stuck, and why','us','Project Management',4,false),
      ('Convert the interest','Application process and deadlines confirmed','school',null,5,false),

      -- A12, month 11 of the contract year. The tracker holds it like a
      -- publish date: a review skipped is a renewal walked into unarmed.
      ('Annual review and renewal','Every unit scored on its own attribution data — replace / refine / repeat in 1-3-1','us','Project Management',1,false),
      ('Annual review and renewal','One ADD promoted from the phase-two shelf','us','Strategy',2,false),
      ('Annual review and renewal','Renewal pack with year-on-year proof on every headline number','us','Project Management',3,false),
      ('Annual review and renewal','Next year''s annual calendar issued','us','Project Management',4,false),
      ('Annual review and renewal','Cost per unit for the school-year logged','us','Project Management',5,false),
      ('Annual review and renewal','New school-year photo set','school',null,6,false),
      ('Annual review and renewal','Next year''s open day dates confirmed','school',null,7,false),
      ('Annual review and renewal','Renewal meeting — head and point of contact attend','school',null,8,false),

      -- A6, April edition. Six weeks brief to publish, so production starts
      -- the month before the publish month.
      ('Choosing guide — production','"Choosing a school in [catchment]" production starts — six weeks brief to publish','us','Content & Copywriting',20,false),
      ('Choosing guide — production','Guide layout from the Figma master, brand variables applied','us','Creative Production',21,false),
      ('Choosing guide — production','Draft sign-off — single gate, ten working days','school',null,22,false),
      ('Choosing guide — production','Photography from the school''s library — twenty working days','school',null,23,false),

      ('Choosing guide — publish','Choosing guide published on the hub, gated, form tested end to end','us','Development',20,false),
      ('Choosing guide — publish','Search campaign live within three days of publish','us','Paid Media',21,false),
      ('Choosing guide — publish','Structured data and crawlability checked — the AI-search standard','us','SEO',22,false),
      ('Choosing guide — publish','Bot FAQ content refreshed from the new guide','us','Content & Copywriting',23,false),
      ('Choosing guide — publish','FAQ social post set cut from the guide','us','Content & Copywriting',24,false),

      -- A6, October edition. The fee table is the highest-intent content in
      -- the market and the fee schedule is the input that gates it.
      ('Fees guide — production','"Private school fees [year+1]" production starts — six weeks brief to publish','us','Content & Copywriting',20,false),
      ('Fees guide — production','Guide layout from the Figma master, brand variables applied','us','Creative Production',21,false),
      ('Fees guide — production','Fee schedule confirmed — fifteen working days before publish','school',null,22,false),
      ('Fees guide — production','Draft sign-off — single gate, ten working days','school',null,23,false),

      ('Fees guide — publish','Fees guide published on the hub — the same URL as the previous edition','us','Development',20,false),
      ('Fees guide — publish','Search campaign live within three days of publish','us','Paid Media',21,false),
      ('Fees guide — publish','Structured data and crawlability checked — the AI-search standard','us','SEO',22,false),
      ('Fees guide — publish','Bot FAQ content refreshed from the new guide','us','Content & Copywriting',23,false),
      ('Fees guide — publish','Ranking positions for the target cluster recorded','us','SEO',24,false),
      ('Fees guide — publish','Enablement pack masters refreshed','us','Content & Copywriting',25,false),

      -- A1. Speed is a media-economics line, not a tech feature, so the
      -- comparison against the school''s own site is the artifact, quarterly.
      ('Hub health check','Core Web Vitals green; PageSpeed comparison against the school''s own site refreshed','us','Development',60,false),

      ('Every quarter','Quarterly feedback meeting — thirty minutes, five timed items, report sent forty-eight hours before','us','Client Meeting',65,false),
      ('Every quarter','Quarterly fee benchmark — every figure sourced and dated','us','Project Management',66,false),
      ('Every quarter','Local Falcon local-pack scan','us','SEO',67,false),
      ('Every quarter','NPS survey sent, then every respondent invited to review','us','Project Management',68,false),
      ('Every quarter','Next three-month social cycle approved in Quartz','school',null,69,false),

      ('Between the quarters','Written update sent — generated, reviewed before it goes','us','Project Management',65,false),

      ('Acquisition engine — every month','Pipeline administered and monitored — first-response SLA and stage ageing reviewed','us','Project Management',80,false),
      ('Acquisition engine — every month','Always-on search optimisation pass logged; creative fatigue signals checked','us','Paid Media',81,false),
      ('Acquisition engine — every month','Monthly enrolment report delivered by working day five','us','Project Management',82,false),
      ('Acquisition engine — every month','Tracker updated; next month''s client inputs chased at their T-minus dates','us','Project Management',83,false),

      ('Intelligence engine — every month','Flint trend analysis reviewed and placed in the monthly report','us','Project Management',90,false),

      ('Presence engine — every month','Five social posts published — two brand, two brag, one FAQ from the current guide','us','Social Media',95,false),
      ('Presence engine — every month','Google Business Profile post and profile hygiene','us','Social Media',96,false),
      ('Presence engine — every month','New Trustpilot reviews answered within five working days','us','Content & Copywriting',97,false),
      ('Presence engine — every month','Ad hoc queue worked — up to four items, three working day turnaround','us','Social Media',98,false),

      -- Once per school, ever. It seeds into month 1 of every year because the
      -- template cannot know which year this is; on a renewal plan it is one
      -- named block to delete.
      ('School onboarding — first year only','Enrolment Hub stood up on the school''s own subdomain','us','Development',30,false),
      ('School onboarding — first year only','Header and footer matched to the school''s site','us','Development',31,false),
      ('School onboarding — first year only','GA4 and Ads conversion wiring verified with a live submission','us','Development',32,false),
      ('School onboarding — first year only','Granite enquiry, guide-download and ad hoc upload forms live','us','Development',33,false),
      ('School onboarding — first year only','Granite pipeline configured — stages, grade and intake-year tags, automations, attribution','us','Development',34,false),
      ('School onboarding — first year only','Setup training held; one real lead traced end to end','us','Project Management',35,false),
      ('School onboarding — first year only','Granite bot live on the hub and WhatsApp; after-hours flow verified','us','Development',36,false),
      ('School onboarding — first year only','Nurture sequence built and firing — five steps','us','Content & Copywriting',37,false),
      ('School onboarding — first year only','Enablement pack delivered — best practice, referral and feeder playbooks','us','Content & Copywriting',38,false),
      ('School onboarding — first year only','Trustpilot profile created and response templates loaded','us','Content & Copywriting',39,false),
      ('School onboarding — first year only','PageSpeed comparison captured — the hub against the school''s own site','us','Development',40,false),
      ('School onboarding — first year only','DNS CNAME record actioned by the school''s IT — ten working days','school',null,41,false),
      ('School onboarding — first year only','Header and footer look-match signed off','school',null,42,false),
      ('School onboarding — first year only','GA4 and Google Ads access granted','school',null,43,false),
      ('School onboarding — first year only','Link to the hub added to the school''s main site navigation','school',null,44,false),
      ('School onboarding — first year only','A named salesperson, and a first-response SLA they adopt','school',null,45,false),
      ('School onboarding — first year only','WhatsApp Business number verified','school',null,46,false),
      ('School onboarding — first year only','Bot FAQ and qualifying content signed off','school',null,47,false),
      ('School onboarding — first year only','Nurture sequence copy approved','school',null,48,false),
      ('School onboarding — first year only','Google Business Profile access granted','school',null,49,false),
      ('School onboarding — first year only','Photography library for the year','school',null,50,false),
      ('School onboarding — first year only','Playbook owners named at the school','school',null,51,false)
    ) as v(theme, label, side, dept, ordinal, is_gate)
  loop
    select id into v_th from pipeline_template_themes
     where template_id = v_tpl and theme = r.theme;
    if v_th is null then
      raise exception 'seed: no theme named % in the new template', r.theme;
    end if;

    v_dep := null;
    if r.dept is not null then
      select id into v_dep from departments where name = r.dept;
      if v_dep is null then
        raise exception 'seed: no department named % — resolve the name before seeding', r.dept;
      end if;
    end if;

    insert into pipeline_template_tasks (theme_id, label, side, department_id, ordinal, is_gate)
    values (v_th, r.label, r.side, v_dep, r.ordinal, r.is_gate);
  end loop;
end;
$seed$;

-- ===========================================================================
-- 3. The gate flag never reached the years already planned
-- ===========================================================================
-- 0151 added is_gate and set it on the TEMPLATE, but the two years already
-- seeded from the old template were copied before the column existed, so every
-- one of their rows is false. Both readers of the flag — schedule_school_year_
-- month's v_gate and (from this change) sixWeekBreach — therefore see no gate
-- task at all: the school's creative approval would fall due at month end
-- instead of six weeks before the day, and the board's breach banner would
-- never fire. Matched on the label because that is what those rows were seeded
-- with; nothing new is ever matched that way.
update public.school_tasks t
   set is_gate = true
  from public.school_year_months m
 where m.year_id = t.year_id
   and m.month_no = t.month_no
   and m.role = 'open_day_before'
   and t.label = 'Creative approved — the hard deadline'
   and not t.is_gate;
