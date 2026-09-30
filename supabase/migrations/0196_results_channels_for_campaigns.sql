-- 0196_results_channels_for_campaigns.sql
--
-- Year results channels for the campaigns 0195 added, on every client that
-- already has the matching results group, so their numbers have a place:
-- Campaigns › Most loved school and Feeder and referral (Campaign template:
-- enquiries, tours), Social media › Audience builder (Social template: posts,
-- reach, engagement). A client with no such group is left alone; its Year
-- results are set up from the standard groups first.

insert into public.results_rows (group_id, name, ordinal)
select g.id, v.row_name, v.ord
  from public.results_groups g
  join (values ('Campaigns', 'Most loved school', 10), ('Campaigns', 'Feeder and referral', 11), ('Social media', 'Audience builder', 10))
    v(grp, row_name, ord) on v.grp = g.name
 where not exists (select 1 from public.results_rows r where r.group_id = g.id and r.name = v.row_name);
