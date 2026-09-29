-- 0184_task_plan_group.sql
--
-- Where a task sits on the planner is part of the plan, not a side effect of
-- Year results. plan_group / plan_row name the group and row a task belongs
-- to (Paid media › PMax, Running the account › Reporting), and the planner
-- organises by them. They are names, not ids: results groups belong to one
-- client, the template belongs to every school, and the planner lines the two
-- up by name so a group that also exists in Year results takes its colour.
--
-- A results_task_links row (0180) still wins over plan_row: it is the
-- explicit "this task feeds that number" and the planner shows it there.
--
-- The template carries the default; school_tasks copies it on insert through
-- the same trigger 0183 added, now covering both facts.

alter table public.pipeline_template_tasks
  add column if not exists plan_group text,
  add column if not exists plan_row text;
alter table public.school_tasks
  add column if not exists plan_group text,
  add column if not exists plan_row text;

create temporary table plan_seed(label text, grp text, row_name text) on commit drop;
insert into plan_seed values
    ($q$Always-on search optimisation pass logged; creative fatigue signals checked$q$, $q$Paid media$q$, $q$Google Search$q$),
    ($q$Campaign live on the T-minus schedule$q$, $q$Paid media$q$, null),
    ($q$Facebook and PMax campaigns built in Slate — ready, not live$q$, $q$Paid media$q$, null),
    ($q$Guide live and converting before PMax goes up — the warm-account prerequisite$q$, $q$Paid media$q$, $q$PMax$q$),
    ($q$Retargeting audiences refreshed for the cycle$q$, $q$Paid media$q$, $q$Meta ads$q$),
    ($q$Search campaign live within three days of publish$q$, $q$Paid media$q$, $q$Google Search$q$),
    ($q$Always-on search live$q$, $q$Paid media$q$, $q$Google Search$q$),
    ($q$Five social posts published — two brand, two brag, one FAQ from the current guide$q$, $q$Social media$q$, null),
    ($q$Google Business Profile post and profile hygiene$q$, $q$Social media$q$, null),
    ($q$Live posts on the day$q$, $q$Events$q$, $q$OD$q$),
    ($q$FAQ social post set cut from the guide$q$, $q$Social media$q$, null),
    ($q$Next three-month social cycle approved in Quartz$q$, $q$Social media$q$, null),
    ($q$"Choosing a school in [catchment]" production starts — six weeks brief to publish$q$, $q$Content$q$, $q$Ultimate guides$q$),
    ($q$"Private school fees [year+1]" production starts — six weeks brief to publish$q$, $q$Content$q$, $q$Ultimate guides$q$),
    ($q$Guide layout from the Figma master, brand variables applied$q$, $q$Content$q$, $q$Ultimate guides$q$),
    ($q$Choosing guide published on the hub, gated, form tested end to end$q$, $q$Content$q$, $q$Ultimate guides$q$),
    ($q$Fees guide published on the hub — the same URL as the previous edition$q$, $q$Content$q$, $q$Ultimate guides$q$),
    ($q$Draft sign-off — single gate, ten working days$q$, $q$Content$q$, $q$Ultimate guides$q$),
    ($q$Photography from the school's library — twenty working days$q$, $q$Content$q$, $q$Ultimate guides$q$),
    ($q$Fee schedule confirmed — fifteen working days before publish$q$, $q$Content$q$, $q$Ultimate guides$q$),
    ($q$Ultimate guides refreshed$q$, $q$Content$q$, $q$Ultimate guides$q$),
    ($q$Bot FAQ content refreshed from the new guide$q$, $q$Content$q$, null),
    ($q$Enablement pack masters refreshed$q$, $q$Content$q$, null),
    ($q$Ad creative set adapted from the kit — multiple concepts, rotation built in$q$, $q$Events$q$, $q$OD$q$),
    ($q$PMax asset set from the Figma kit$q$, $q$Events$q$, $q$OD$q$),
    ($q$Web banner and Facebook cover from the kit$q$, $q$Events$q$, $q$OD$q$),
    ($q$Open day landing page built on the hub and tested$q$, $q$Events$q$, $q$OD$q$),
    ($q$Granite booking form and event pipeline cloned for the cycle$q$, $q$Events$q$, $q$OD$q$),
    ($q$Emailer to the school's base and WhatsApp blast written$q$, $q$Events$q$, $q$OD$q$),
    ($q$Follow-up firing automatically, reminder sequence in the final week$q$, $q$Events$q$, $q$OD$q$),
    ($q$Bookings flowing into Granite daily, every one attributed$q$, $q$Events$q$, $q$OD$q$),
    ($q$Attendance recorded against bookings$q$, $q$Events$q$, $q$OD$q$),
    ($q$Campaign feedback report within ten working days — bookings, cost per booking, traced$q$, $q$Events$q$, $q$OD$q$),
    ($q$Event details, and scholarship mechanics if the school offers them$q$, $q$Events$q$, $q$OD$q$),
    ($q$Creative approved — the hard deadline$q$, $q$Events$q$, $q$OD$q$),
    ($q$Photography for the cycle from the school's library$q$, $q$Events$q$, $q$OD$q$),
    ($q$Attendance list on the day$q$, $q$Events$q$, $q$OD$q$),
    ($q$Open day dates for the whole year$q$, $q$Events$q$, null),
    ($q$School calendar published$q$, $q$Events$q$, null),
    ($q$Next year's open day dates confirmed$q$, $q$Events$q$, null),
    ($q$Post-open-day nurture running for every booked family$q$, $q$Campaigns$q$, $q$Grade 8 · 2028 intake$q$),
    ($q$Application prompts to everyone who attended$q$, $q$Campaigns$q$, $q$Grade 8 · 2028 intake$q$),
    ($q$Reviews requested from attending families$q$, $q$Campaigns$q$, $q$Grade 8 · 2028 intake$q$),
    ($q$Pipeline review — who is stuck, and why$q$, $q$Campaigns$q$, $q$Grade 8 · 2028 intake$q$),
    ($q$Application process and deadlines confirmed$q$, $q$Campaigns$q$, $q$Grade 8 · 2028 intake$q$),
    ($q$Monthly enrolment report delivered by working day five$q$, $q$Running the account$q$, $q$Reporting$q$),
    ($q$Flint trend analysis reviewed and placed in the monthly report$q$, $q$Running the account$q$, $q$Reporting$q$),
    ($q$Written update sent — generated, reviewed before it goes$q$, $q$Running the account$q$, $q$Reporting$q$),
    ($q$Pipeline administered and monitored — first-response SLA and stage ageing reviewed$q$, $q$Running the account$q$, $q$Pipeline & tracker$q$),
    ($q$Tracker updated; next month's client inputs chased at their T-minus dates$q$, $q$Running the account$q$, $q$Pipeline & tracker$q$),
    ($q$Ad hoc queue worked — up to four items, three working day turnaround$q$, $q$Running the account$q$, $q$Pipeline & tracker$q$),
    ($q$New Trustpilot reviews answered within five working days$q$, $q$Running the account$q$, $q$Reviews & reputation$q$),
    ($q$NPS survey sent, then every respondent invited to review$q$, $q$Running the account$q$, $q$Reviews & reputation$q$),
    ($q$Quarterly feedback meeting — thirty minutes, five timed items, report sent forty-eight hours before$q$, $q$Running the account$q$, $q$Client relationship$q$),
    ($q$Quarterly fee benchmark — every figure sourced and dated$q$, $q$Running the account$q$, $q$Client relationship$q$),
    ($q$Approvals inside five working days$q$, $q$Running the account$q$, $q$Client relationship$q$),
    ($q$Local Falcon local-pack scan$q$, $q$Running the account$q$, $q$Site & search$q$),
    ($q$Core Web Vitals green; PageSpeed comparison against the school's own site refreshed$q$, $q$Running the account$q$, $q$Site & search$q$),
    ($q$Structured data and crawlability checked — the AI-search standard$q$, $q$Running the account$q$, $q$Site & search$q$),
    ($q$Ranking positions for the target cluster recorded$q$, $q$Running the account$q$, $q$Site & search$q$),
    ($q$SEO health check, and fix what it finds$q$, $q$Running the account$q$, $q$Site & search$q$),
    ($q$Tracking verified with a live submission$q$, $q$Running the account$q$, $q$Site & search$q$),
    ($q$Signed KPI sheet$q$, $q$Running the account$q$, $q$Year setup$q$),
    ($q$A named content owner, not five people$q$, $q$Running the account$q$, $q$Year setup$q$),
    ($q$Cost per unit for the school-year logged$q$, $q$Running the account$q$, $q$Annual review$q$),
    ($q$Every unit scored on its own attribution data — replace / refine / repeat in 1-3-1$q$, $q$Running the account$q$, $q$Annual review$q$),
    ($q$Renewal pack with year-on-year proof on every headline number$q$, $q$Running the account$q$, $q$Annual review$q$),
    ($q$Next year's annual calendar issued$q$, $q$Running the account$q$, $q$Annual review$q$),
    ($q$One ADD promoted from the phase-two shelf$q$, $q$Running the account$q$, $q$Annual review$q$),
    ($q$Renewal meeting — head and point of contact attend$q$, $q$Running the account$q$, $q$Annual review$q$),
    ($q$New school-year photo set$q$, $q$Running the account$q$, $q$Annual review$q$);

-- The open day row is per open day. The template says "Open day"; a school's
-- own task gets the term its month falls in, matching the Year results rows.
update public.pipeline_template_tasks p
   set plan_group = s.grp,
       plan_row   = case when s.row_name = 'OD' then 'Open day' else s.row_name end
  from plan_seed s
 where p.label = s.label;

update public.school_tasks t
   set plan_group = s.grp,
       plan_row   = case when s.row_name = 'OD'
                         then case when t.month_no <= 6 then 'Open Day · Term 1' else 'Open Day · Term 3' end
                         else s.row_name end
  from plan_seed s
 where t.label = s.label;

-- ponytail: matched by label, like 0183 — school_tasks has no template_task_id.
create or replace function public.tg_school_tasks_inherit_deliverable()
returns trigger
language plpgsql
as $$
declare
  v_deliverable boolean;
  v_group text;
  v_row text;
begin
  select bool_or(p.is_deliverable), max(p.plan_group), max(p.plan_row)
    into v_deliverable, v_group, v_row
    from public.pipeline_template_tasks p
   where p.label = new.label;

  if not new.is_deliverable then
    new.is_deliverable := coalesce(v_deliverable, false);
  end if;
  if new.plan_group is null then
    new.plan_group := v_group;
    new.plan_row   := coalesce(new.plan_row, v_row);
  end if;
  return new;
end;
$$;
