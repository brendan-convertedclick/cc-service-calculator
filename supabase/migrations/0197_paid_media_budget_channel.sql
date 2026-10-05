-- 0197_paid_media_budget_channel.sql
--
-- A "Budget" channel at the top of every Paid media group in Year results:
-- the month's budget for all paid media together, what was actually spent
-- across every channel, and the leads it bought. The per-channel rows
-- (Google Search, PMax) keep their own spend; this is the total the school
-- agreed to and the one number the monthly report leads with.
--
-- It gets its own template, "Paid budget", rather than the Paid channel one,
-- because the channel template asks what we will run, target leads and
-- clicks, none of which mean anything for a total. Spend is paired with
-- Budget as its target, so the card reads "spent of budget".

insert into public.results_templates (name) values ('Paid budget')
on conflict (name) do nothing;

insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
select t.id, v.label, v.short_label, v.type, v.phase, v.star, v.ord
  from public.results_templates t,
       (values ('Budget', 'budget', 'money', 'plan', false, 0),
               ('Spend', 'spent', 'money', 'result', true, 1),
               ('Leads', 'leads', 'number', 'result', true, 2),
               ('What we''d change', null, 'text', 'result', false, 3)) v(label, short_label, type, phase, star, ord)
 where t.name = 'Paid budget'
   and not exists (select 1 from public.results_template_fields f where f.template_id = t.id and f.label = v.label);

update public.results_template_fields s
   set target_field_id = b.id
  from public.results_template_fields b, public.results_templates t
 where t.name = 'Paid budget'
   and s.template_id = t.id and s.label = 'Spend'
   and b.template_id = t.id and b.label = 'Budget'
   and s.target_field_id is null;

insert into public.results_rows (group_id, name, template_id, ordinal)
select g.id, 'Budget', t.id, -1
  from public.results_groups g, public.results_templates t
 where g.name = 'Paid media' and t.name = 'Paid budget'
   and not exists (select 1 from public.results_rows r where r.group_id = g.id and r.name = 'Budget');
