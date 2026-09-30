-- 0193_plan_review_changes.sql
--
-- Decisions from the Kings College offering review (2026-09-29), applied to
-- the Media Mixology v1.5 template and both schools together.
--
--  1. Ad hoc requests are no longer offered.
--  2. Blog posts and Prize-giving leave Year results: Ultimate guides are the
--     content, and prize-giving is an event only if one comes up. Removed
--     only where the row holds no entries and no task links.
--  3. January gets its every-month work. The template's acquisition,
--     presence and intelligence overlays already list month 1, but both live
--     years were seeded before those overlays existed, so posts, the Business
--     Profile post, review replies and the rest start in February. Filled in
--     where missing.
--  4. Forms become their own channel (Campaigns › Forms): every form we build
--     feeds the enquiry pipeline, so they are tracked as one thing.
--  5. The step after applications comes back: offers go out the month after
--     "Convert the interest", places are confirmed the month after that.
--     Months 5/11 and 6/12 follow both schools' open days in 3 and 9.
--
-- plan_group/plan_row/description/is_deliverable on inserted school tasks
-- come from the template through tg_school_tasks_inherit_deliverable (0185).

-- 1
delete from public.school_tasks t
 where t.label = 'Ad hoc queue worked'
   and t.brief_id is null and t.client_approval_id is null
   and not exists (select 1 from public.results_task_links l where l.school_task_id = t.id);
delete from public.pipeline_template_tasks where label = 'Ad hoc queue worked';

-- 2
delete from public.results_rows r
 where r.name in ('Blog posts', 'Prize-giving')
   and not exists (select 1 from public.results_entries e where e.row_id = r.id)
   and not exists (select 1 from public.results_task_links l where l.row_id = r.id);

-- 3
insert into public.school_tasks (year_id, month_no, label, side, department_id, est_hours, ordinal, source)
select y.id, 1, p.label, p.side, p.department_id, p.est_hours, 100 + p.ordinal, 'template'
  from public.school_years y
  join public.pipeline_template_themes th on th.template_id = y.template_id
  join public.pipeline_template_tasks p on p.theme_id = th.id
  join public.school_year_months m on m.year_id = y.id and m.month_no = 1 and m.closed_at is null
 where th.role = 'overlay' and 1 = any (th.months)
   and th.theme in ('Acquisition engine — every month', 'Presence engine — every month', 'Intelligence engine — every month')
   and not exists (select 1 from public.school_tasks t where t.year_id = y.id and t.month_no = 1 and t.label = p.label);

-- 4
update public.pipeline_template_tasks set plan_group = 'Campaigns', plan_row = 'Forms'
 where label in ('Booking form cloned', 'Granite forms live', 'Booking forms feeding Granite');
update public.school_tasks set plan_group = 'Campaigns', plan_row = 'Forms'
 where label in ('Booking form cloned', 'Granite forms live', 'Booking forms feeding Granite');

-- 5
insert into public.pipeline_template_themes (template_id, theme, role, months, ordinal)
select t.id, v.theme, 'overlay', v.months, v.ord
  from public.pipeline_templates t,
       (values ('Offers go out', array[5, 11], 90), ('Places confirmed', array[6, 12], 91)) v(theme, months, ord)
 where t.name = 'Schools — Media Mixology v1.5'
   and not exists (select 1 from public.pipeline_template_themes x where x.template_id = t.id and x.theme = v.theme);

insert into public.pipeline_template_tasks (theme_id, label, side, ordinal, description, plan_group, plan_row, is_deliverable)
select th.id, v.label, v.side, v.ord, v.descr, 'Campaigns', 'Intake', v.deliv
  from public.pipeline_template_themes th
  join public.pipeline_templates t on t.id = th.template_id and t.name = 'Schools — Media Mixology v1.5'
  join (values
    ('Offers go out', 'Offer list shared', 'school', 1, 'Which families were offered a place, so follow-up and tracking match.', false),
    ('Offers go out', 'Offers sent', 'school', 2, 'The school sends offers to the families it accepts.', false),
    ('Offers go out', 'Offer follow-up running', 'us', 3, 'Emails to every family with an offer: what happens next and the deposit date.', true),
    ('Places confirmed', 'Places confirmed', 'school', 1, 'Acceptances and deposits in, per family.', false),
    ('Places confirmed', 'Undecided families chased', 'us', 2, 'A last personal nudge to every family yet to accept.', true),
    ('Places confirmed', 'Enrolments recorded', 'us', 3, 'Accepted places logged against where each family came from.', false)
  ) v(theme, label, side, ord, descr, deliv) on v.theme = th.theme
 where not exists (select 1 from public.pipeline_template_tasks x where x.theme_id = th.id and x.label = v.label);

insert into public.school_tasks (year_id, month_no, label, side, ordinal, source)
select y.id, mo, p.label, p.side, 100 + p.ordinal, 'template'
  from public.school_years y
  join public.pipeline_template_themes th on th.template_id = y.template_id and th.theme in ('Offers go out', 'Places confirmed')
  join public.pipeline_template_tasks p on p.theme_id = th.id
  cross join lateral unnest(th.months) mo
  join public.school_year_months m on m.year_id = y.id and m.month_no = mo and m.closed_at is null
 where not exists (select 1 from public.school_tasks t where t.year_id = y.id and t.month_no = mo and t.label = p.label);
