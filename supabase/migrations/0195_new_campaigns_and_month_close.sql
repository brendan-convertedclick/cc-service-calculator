-- 0195_new_campaigns_and_month_close.sql
--
-- Four additions from the Kings College offering review (2026-09-29), to the
-- Media Mixology v1.5 template and both schools:
--
--  * Feeder and referral (Campaigns): a referral drip to current parents
--    before each open day and after Most loved school, a feeder pack to the
--    primaries that send Grade 8s, a feeder visit, and a referral form that
--    feeds Granite like every other form.
--  * Most loved school (Campaigns): a competition in May to July whose entries
--    are reviews and votes. Fills the quiet months between intakes.
--  * Audience builder (Social media): a follow-and-sign-up prize draw in
--    October to December, so the next February build has a bigger audience.
--  * Month close (Account owner › Reporting): one task a month; the
--    description is the checklist. close_school_year_month already refuses a
--    month with unfinished tasks, so step 1 is enforced.
--
-- Each new piece is an overlay theme with its own months, so a new school
-- year planned from the template gets it. Existing school years get the same
-- tasks inserted into their open months where the title is not already there.

create temporary table add_seed (
  theme text, months int[], label text, side text, dept text, grp text, row_name text,
  deliv boolean, descr text, ord int
) on commit drop;

insert into add_seed values
  -- Feeder and referral
  ('Referral drip', array[2, 7, 8], 'Referral ask sent', 'us', 'Content & Copywriting', 'Campaigns', 'Feeder and referral', true,
   'Email and WhatsApp to current parents: know a family who should see us? Links to the referral form.', 1),
  ('Feeder schools', array[2, 8], 'Feeder pack sent', 'us', 'Content & Copywriting', 'Campaigns', 'Feeder and referral', true,
   'A letter from the head, the open day invite and the Choosing guide, for each feeder school''s Grade 7 families.', 1),
  ('Feeder visit', array[5], 'Feeder visit held', 'school', null, 'Campaigns', 'Feeder and referral', false,
   'The school visits or hosts its main feeder primaries.', 1),
  ('Feeder and referral setup', array[1], 'Feeder school list agreed', 'school', null, 'Campaigns', 'Feeder and referral', false,
   'The primaries that send the most Grade 8s, with a contact at each.', 1),
  ('Feeder and referral setup', array[1], 'Referral form live', 'us', 'Development', 'Campaigns', 'Forms', true,
   'Refer-a-family form on the hub. Feeds Granite, tagged as a referral so it enters the same nurture.', 2),
  -- Most loved school
  ('Most loved school: set up', array[5], 'Competition mechanics set', 'us', 'Strategy', 'Campaigns', 'Most loved school', false,
   'Prize, how to enter, how votes and reviews count. Terms written.', 1),
  ('Most loved school: set up', array[5], 'Prize and terms confirmed', 'school', null, 'Campaigns', 'Most loved school', false,
   'The school signs off the prize and the terms.', 2),
  ('Most loved school: set up', array[5], 'Competition page built', 'us', 'Development', 'Campaigns', 'Forms', true,
   'On the hub, with the entry form and tracking.', 3),
  ('Most loved school: set up', array[5], 'Competition creative made', 'us', 'Creative Production', 'Campaigns', 'Most loved school', true,
   'Posts, emailer and WhatsApp message.', 4),
  ('Most loved school: live', array[6], 'Competition live', 'us', 'Social Media', 'Campaigns', 'Most loved school', true,
   'Launched across social, email and WhatsApp. Runs four weeks.', 1),
  ('Most loved school: live', array[6], 'Parent base invited', 'school', null, 'Campaigns', 'Most loved school', false,
   'The school sends the invite to every current family.', 2),
  ('Most loved school: live', array[6], 'Entries and reviews tracked', 'us', 'Project Management', 'Campaigns', 'Most loved school', false,
   'Weekly count of entries, votes and new reviews.', 3),
  ('Most loved school: results', array[7], 'Winner announced', 'us', 'Social Media', 'Campaigns', 'Most loved school', true,
   'Announced on social, the hub and to parents.', 1),
  ('Most loved school: results', array[7], 'Competition results reported', 'us', 'Project Management', 'Campaigns', 'Most loved school', true,
   'Reviews gained, entries and reach, into the monthly report.', 2),
  -- Audience builder
  ('Audience builder: set up', array[10], 'Audience draw mechanics set', 'us', 'Strategy', 'Social media', 'Audience builder', false,
   'Follow and sign up to enter. Terms written.', 1),
  ('Audience builder: set up', array[10], 'Draw prize confirmed', 'school', null, 'Social media', 'Audience builder', false,
   'The school signs off the prize.', 2),
  ('Audience builder: set up', array[10], 'Sign-up page built', 'us', 'Development', 'Campaigns', 'Forms', true,
   'On the hub, feeding the nurture list.', 3),
  ('Audience builder: live', array[11], 'Audience draw live', 'us', 'Social Media', 'Social media', 'Audience builder', true,
   'Launched on social, email and WhatsApp. Runs three weeks.', 1),
  ('Audience builder: live', array[11], 'Share pack sent to the school', 'us', 'Social Media', 'Social media', 'Audience builder', true,
   'Ready-made posts and messages for staff and parents to share.', 2),
  ('Audience builder: live', array[11], 'Sign-ups and followers tracked', 'us', 'Project Management', 'Social media', 'Audience builder', false,
   'Weekly count of new followers and sign-ups.', 3),
  ('Audience builder: results', array[12], 'Draw winner announced', 'us', 'Social Media', 'Social media', 'Audience builder', true,
   'Before the school closes for the year.', 1),
  ('Audience builder: results', array[12], 'Audience results reported', 'us', 'Project Management', 'Social media', 'Audience builder', true,
   'Followers gained and sign-ups added to the nurture list. Load the list into PMax before the February build.', 2),
  -- Month close
  ('Month close', array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'Month closed', 'us', 'Account Owner', 'Account owner', 'Reporting', false,
   'The account owner closes the month: 1. Every task done, or moved with a reason. 2. The month''s numbers in Year results: bookings, attendance, applications, enrolments, reviews, followers. 3. The enrolment report sent. 4. Granite response times reviewed: time waiting on the school and time waiting on parents. 5. Next month''s school inputs confirmed or chased. 6. The month closed in Conductor.', 99);

insert into public.pipeline_template_themes (template_id, theme, role, months, ordinal)
select distinct on (s.theme) t.id, s.theme, 'overlay', s.months, 100
  from add_seed s, public.pipeline_templates t
 where t.name = 'Schools — Media Mixology v1.5'
   and not exists (select 1 from public.pipeline_template_themes x where x.template_id = t.id and x.theme = s.theme);

insert into public.pipeline_template_tasks (theme_id, label, side, ordinal, department_id, description, plan_group, plan_row, is_deliverable)
select th.id, s.label, s.side, s.ord, d.id, s.descr, s.grp, s.row_name, s.deliv
  from add_seed s
  join public.pipeline_template_themes th on th.theme = s.theme
  join public.pipeline_templates t on t.id = th.template_id and t.name = 'Schools — Media Mixology v1.5'
  left join public.departments d on d.name = s.dept
 where not exists (select 1 from public.pipeline_template_tasks x where x.theme_id = th.id and x.label = s.label);

insert into public.school_tasks (year_id, month_no, label, side, department_id, ordinal, source)
select y.id, mo, p.label, p.side, p.department_id, 200 + p.ordinal, 'template'
  from public.school_years y
  join public.pipeline_template_themes th on th.template_id = y.template_id
  join add_seed s on s.theme = th.theme
  join public.pipeline_template_tasks p on p.theme_id = th.id and p.label = s.label
  cross join lateral unnest(th.months) mo
  join public.school_year_months m on m.year_id = y.id and m.month_no = mo and m.closed_at is null
 where not exists (select 1 from public.school_tasks t where t.year_id = y.id and t.month_no = mo and t.label = p.label);
