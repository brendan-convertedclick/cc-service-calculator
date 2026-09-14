-- Three of the four lists had no task catalog at all, so picking them on the
-- Live tasks page showed "Tasks (0)" and the whole feature looked broken.
-- Only Non-Billable was ever seeded (0048).
--
-- A live task is work nobody has to assign: it stays open forever and people
-- log time against it. That is the test each row below has to pass, which is
-- why "Ad Hoc Requests" is here and "Build the September campaign" is not.
-- One-off work is a brief; this table is only for the standing buckets.
--
-- `billable` is the load-bearing column. get-productivity assumes an entry is
-- billable unless its task is in ongoing_tasks, so these flags are the only
-- thing that lets non-billable time show up as non-billable. The split below
-- is the ordinary agency one: talking to the client and doing their work is
-- chargeable, running their account internally is not. Edit any of it in
-- Settings -> Task catalog; nothing downstream keys off these label_keys.

insert into time_categories (label_key, label, description, group_id, billable, display_order)
select v.label_key, v.label, v.description, tg.id, v.billable, v.display_order
  from (values
    ('account-admin',     'Account Admin',      'Filing, invoicing, internal setup for this client', 'administration', false, 110),
    ('client-comms',      'Client Comms',       'Emails and calls with the client',                  'administration', true,  120),
    ('ad-hoc-requests',   'Ad Hoc Requests',    'Small reactive requests outside a brief',           'delivery',       true,  210),
    ('amends-revisions',  'Amends & Revisions', 'Changes to work already delivered',                 'delivery',       true,  220),
    ('client-meeting',    'Client Meeting',     'Calls and reviews with the client',                 'meetings',       true,  310),
    ('internal-planning', 'Internal Planning',  'Planning this client''s work among ourselves',      'meetings',       false, 320)
  ) as v(label_key, label, description, group_key, billable, display_order)
  join task_groups tg on tg.label_key = v.group_key
 where not exists (
   select 1 from time_categories tc where tc.label_key = v.label_key
 );
