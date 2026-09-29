-- 0185_task_title_description.sql
--
-- A pipeline task's label was one sentence carrying the outcome, the rule and
-- the reason ("Draft sign-off — single gate, ten working days"). It is now a
-- short TITLE, and the rest moves into DESCRIPTION.
--
-- Title convention (see CLAUDE.md "Pipeline task titles"):
--   the thing, then its state: "Guide draft signed off", "Landing page built".
--   2 to 5 words, sentence case, no full stop, no dash. Never the client, the
--   month, the cadence or the channel; the row, the column and the card's
--   icons already say those. The finish line goes in the description.
--
-- label stays the column name (it is the title everywhere it is read,
-- including the client's own calendar via client_pipeline_schedule), so
-- nothing that selects it changes. Template and school rows are renamed
-- together, so 0183/0184's label match keeps working.

alter table public.pipeline_template_tasks add column if not exists description text;
alter table public.school_tasks add column if not exists description text;

create temporary table rename_seed(old_label text, title text, description text) on commit drop;
insert into rename_seed values
    ($q$Always-on search optimisation pass logged; creative fatigue signals checked$q$, $q$Search optimisation pass logged$q$, $q$Keeps the always-on account efficient between campaigns. Pass logged; creative fatigue signals checked.$q$),
    ($q$Campaign live on the T-minus schedule$q$, $q$Open day campaign live$q$, $q$The open day campaign goes live across PMax and Meta. Live on the T-minus schedule.$q$),
    ($q$Facebook and PMax campaigns built in Slate — ready, not live$q$, $q$Open day campaigns built$q$, $q$Facebook and PMax campaigns built in Slate ahead of launch. Ready in Slate, not live.$q$),
    ($q$Guide live and converting before PMax goes up — the warm-account prerequisite$q$, $q$PMax account warmed$q$, $q$PMax needs converting traffic before it goes up. Guide live and converting before PMax launches.$q$),
    ($q$Retargeting audiences refreshed for the cycle$q$, $q$Retargeting audiences refreshed$q$, $q$Refreshed for this cycle.$q$),
    ($q$Search campaign live within three days of publish$q$, $q$Guide search campaign live$q$, $q$Drives search traffic to the newly published guide. Live within 3 days of the guide publishing.$q$),
    ($q$Always-on search live$q$, $q$Always-on search live$q$, $q$Live before month 2.$q$),
    ($q$Five social posts published — two brand, two brag, one FAQ from the current guide$q$, $q$Social posts published$q$, $q$Two brand, two brag and one FAQ post from the current guide. Five posts out.$q$),
    ($q$Google Business Profile post and profile hygiene$q$, $q$Google Business Profile post published$q$, $q$One Google Business Profile post, and the profile details checked.$q$),
    ($q$Live posts on the day$q$, $q$Live posts published$q$, $q$Posted during the open day.$q$),
    ($q$FAQ social post set cut from the guide$q$, $q$FAQ post set cut$q$, $q$Set cut from the published guide.$q$),
    ($q$Next three-month social cycle approved in Quartz$q$, $q$Next social cycle approved$q$, $q$The school signs off the next three months of posts. Approved in Quartz.$q$),
    ($q$"Choosing a school in [catchment]" production starts — six weeks brief to publish$q$, $q$Choosing guide in production$q$, $q$"Choosing a school in [catchment]" edition. 6 weeks from brief to publish.$q$),
    ($q$"Private school fees [year+1]" production starts — six weeks brief to publish$q$, $q$Fees guide in production$q$, $q$"Private school fees [year+1]" edition. 6 weeks from brief to publish.$q$),
    ($q$Guide layout from the Figma master, brand variables applied$q$, $q$Guide laid out$q$, $q$From the Figma master. Brand variables applied.$q$),
    ($q$Choosing guide published on the hub, gated, form tested end to end$q$, $q$Choosing guide published$q$, $q$Gated on the hub. Form tested end to end.$q$),
    ($q$Fees guide published on the hub — the same URL as the previous edition$q$, $q$Fees guide published$q$, $q$Keeps the ranking the old edition earned. Same URL as the previous edition.$q$),
    ($q$Draft sign-off — single gate, ten working days$q$, $q$Guide draft signed off$q$, $q$One approval gate for the school. Within 10 working days.$q$),
    ($q$Photography from the school's library — twenty working days$q$, $q$Guide photography supplied$q$, $q$From the school's library. Within 20 working days.$q$),
    ($q$Fee schedule confirmed — fifteen working days before publish$q$, $q$Fee schedule confirmed$q$, $q$The fees guide cannot publish without it. 15 working days before publish.$q$),
    ($q$Ultimate guides refreshed$q$, $q$Ultimate guides refreshed$q$, null),
    ($q$Bot FAQ content refreshed from the new guide$q$, $q$Bot FAQ refreshed$q$, $q$Updated from the new guide.$q$),
    ($q$Enablement pack masters refreshed$q$, $q$Enablement pack refreshed$q$, $q$Masters updated.$q$),
    ($q$Ad creative set adapted from the kit — multiple concepts, rotation built in$q$, $q$Ad creative adapted$q$, $q$Adapted from the kit. Several concepts, rotation built in.$q$),
    ($q$PMax asset set from the Figma kit$q$, $q$PMax asset set built$q$, $q$From the Figma kit. Full PMax asset set.$q$),
    ($q$Web banner and Facebook cover from the kit$q$, $q$Web banner and Facebook cover made$q$, $q$From the kit.$q$),
    ($q$Open day landing page built on the hub and tested$q$, $q$Landing page built$q$, $q$Built on the hub. Built and tested.$q$),
    ($q$Granite booking form and event pipeline cloned for the cycle$q$, $q$Booking form cloned$q$, $q$Granite form and event pipeline cloned. Cloned for this cycle.$q$),
    ($q$Emailer to the school's base and WhatsApp blast written$q$, $q$Emailer and WhatsApp blast written$q$, $q$Goes to the school's own base. Both written.$q$),
    ($q$Follow-up firing automatically, reminder sequence in the final week$q$, $q$Booking follow-up automated$q$, $q$Reminder sequence runs in the final week.$q$),
    ($q$Bookings flowing into Granite daily, every one attributed$q$, $q$Bookings attributed$q$, $q$Into Granite daily, every booking attributed.$q$),
    ($q$Attendance recorded against bookings$q$, $q$Attendance recorded$q$, $q$Recorded against bookings.$q$),
    ($q$Campaign feedback report within ten working days — bookings, cost per booking, traced$q$, $q$Feedback report sent$q$, $q$Bookings and cost per booking, traced. Within 10 working days.$q$),
    ($q$Event details, and scholarship mechanics if the school offers them$q$, $q$Event details supplied$q$, $q$Include scholarship mechanics if offered.$q$),
    ($q$Creative approved — the hard deadline$q$, $q$Creative approved$q$, $q$This is the hard deadline for the cycle.$q$),
    ($q$Photography for the cycle from the school's library$q$, $q$Photography supplied$q$, $q$From the school's library.$q$),
    ($q$Attendance list on the day$q$, $q$Attendance list supplied$q$, $q$Supplied on the day.$q$),
    ($q$Open day dates for the whole year$q$, $q$Open day dates set$q$, $q$Every open day date for the year.$q$),
    ($q$School calendar published$q$, $q$School calendar published$q$, null),
    ($q$Next year's open day dates confirmed$q$, $q$Next year's open day dates set$q$, null),
    ($q$Post-open-day nurture running for every booked family$q$, $q$Nurture sequence running$q$, $q$Running for every booked family.$q$),
    ($q$Application prompts to everyone who attended$q$, $q$Application prompts sent$q$, $q$Sent to everyone who attended.$q$),
    ($q$Reviews requested from attending families$q$, $q$Reviews requested$q$, $q$Asked of every attending family.$q$),
    ($q$Pipeline review — who is stuck, and why$q$, $q$Applicant pipeline reviewed$q$, $q$Who is stuck, and why.$q$),
    ($q$Application process and deadlines confirmed$q$, $q$Application deadlines confirmed$q$, null),
    ($q$Monthly enrolment report delivered by working day five$q$, $q$Enrolment report delivered$q$, $q$Delivered by working day 5.$q$),
    ($q$Flint trend analysis reviewed and placed in the monthly report$q$, $q$Flint trends reviewed$q$, $q$Feeds the monthly report. Reviewed and placed in the report.$q$),
    ($q$Written update sent — generated, reviewed before it goes$q$, $q$Written update sent$q$, $q$Generated, then reviewed. Reviewed before it is sent.$q$),
    ($q$Pipeline administered and monitored — first-response SLA and stage ageing reviewed$q$, $q$Enrolment pipeline monitored$q$, $q$First-response SLA and stage ageing reviewed.$q$),
    ($q$Tracker updated; next month's client inputs chased at their T-minus dates$q$, $q$Tracker updated$q$, $q$Chases next month's school inputs. Inputs chased at their T-minus dates.$q$),
    ($q$Ad hoc queue worked — up to four items, three working day turnaround$q$, $q$Ad hoc queue worked$q$, $q$Up to 4 items, 3 working day turnaround.$q$),
    ($q$New Trustpilot reviews answered within five working days$q$, $q$Trustpilot reviews answered$q$, $q$New reviews answered within 5 working days.$q$),
    ($q$NPS survey sent, then every respondent invited to review$q$, $q$NPS survey sent$q$, $q$Every respondent invited to review.$q$),
    ($q$Quarterly feedback meeting — thirty minutes, five timed items, report sent forty-eight hours before$q$, $q$Feedback meeting held$q$, $q$30 minutes, 5 timed items. Report sent 48 hours before.$q$),
    ($q$Quarterly fee benchmark — every figure sourced and dated$q$, $q$Fee benchmark done$q$, $q$Every figure sourced and dated.$q$),
    ($q$Approvals inside five working days$q$, $q$Approvals turned around$q$, $q$A standing rule the school keeps. Within 5 working days.$q$),
    ($q$Local Falcon local-pack scan$q$, $q$Local-pack scan run$q$, $q$Run in Local Falcon.$q$),
    ($q$Core Web Vitals green; PageSpeed comparison against the school's own site refreshed$q$, $q$Core Web Vitals checked$q$, $q$Includes the PageSpeed comparison with the school's site. All vitals green.$q$),
    ($q$Structured data and crawlability checked — the AI-search standard$q$, $q$Structured data checked$q$, $q$Holds the site to the AI-search standard. Structured data and crawlability pass.$q$),
    ($q$Ranking positions for the target cluster recorded$q$, $q$Rankings recorded$q$, $q$Target cluster positions logged.$q$),
    ($q$SEO health check, and fix what it finds$q$, $q$SEO health check done$q$, $q$Fix what it finds.$q$),
    ($q$Tracking verified with a live submission$q$, $q$Tracking verified$q$, $q$Verified with a live submission.$q$),
    ($q$Signed KPI sheet$q$, $q$KPI sheet signed$q$, null),
    ($q$A named content owner, not five people$q$, $q$Content owner named$q$, $q$One person, not five.$q$),
    ($q$Cost per unit for the school-year logged$q$, $q$Cost per unit logged$q$, $q$Logged for the school year.$q$),
    ($q$Every unit scored on its own attribution data — replace / refine / repeat in 1-3-1$q$, $q$Units scored$q$, $q$Replace, refine or repeat, in a 1-3-1. Each scored on its own attribution data.$q$),
    ($q$Renewal pack with year-on-year proof on every headline number$q$, $q$Renewal pack sent$q$, $q$Year-on-year proof on every headline number.$q$),
    ($q$Next year's annual calendar issued$q$, $q$Next year's calendar issued$q$, null),
    ($q$One ADD promoted from the phase-two shelf$q$, $q$ADD promoted$q$, $q$One item from the phase-two shelf.$q$),
    ($q$Renewal meeting — head and point of contact attend$q$, $q$Renewal meeting held$q$, $q$Head and point of contact attend.$q$),
    ($q$New school-year photo set$q$, $q$New photo set supplied$q$, $q$For the next school year.$q$);

update public.pipeline_template_tasks p
   set label = s.title, description = s.description
  from rename_seed s
 where p.label = s.old_label;

update public.school_tasks t
   set label = s.title, description = s.description
  from rename_seed s
 where t.label = s.old_label;

-- ponytail: still matched by label (no template_task_id on school_tasks).
create or replace function public.tg_school_tasks_inherit_deliverable()
returns trigger
language plpgsql
as $$
declare
  v_deliverable boolean;
  v_group text;
  v_row text;
  v_description text;
begin
  select bool_or(p.is_deliverable), max(p.plan_group), max(p.plan_row), max(p.description)
    into v_deliverable, v_group, v_row, v_description
    from public.pipeline_template_tasks p
   where p.label = new.label;

  if not new.is_deliverable then
    new.is_deliverable := coalesce(v_deliverable, false);
  end if;
  if new.plan_group is null then
    new.plan_group := v_group;
    new.plan_row   := coalesce(new.plan_row, v_row);
  end if;
  if new.description is null then
    new.description := v_description;
  end if;
  return new;
end;
$$;

-- The Media Mixology v1.5 template's own tasks no school year has used yet
-- (first-year onboarding, and the year-setup set 0157 seeded): same title
-- rule, and their group, row and deliverable flag (0183/0184) set here since
-- the label match above cannot reach them. The superseded "Schools — 12
-- month year" template is left as it was.
create temporary table template_seed(old_label text, title text, description text, grp text, row_name text, deliverable boolean) on commit drop;
insert into template_seed values
    ($q$Enrolment Hub stood up on the school's own subdomain$q$, $q$Enrolment Hub live$q$, $q$Stood up on the school's own subdomain.$q$, $q$Running the account$q$, $q$Site & search$q$, true),
    ($q$Header and footer matched to the school's site$q$, $q$Hub header and footer matched$q$, $q$Matched to the school's own site.$q$, $q$Running the account$q$, $q$Site & search$q$, true),
    ($q$GA4 and Ads conversion wiring verified with a live submission$q$, $q$Conversion tracking verified$q$, $q$GA4 and Ads conversions, verified with a live submission.$q$, $q$Running the account$q$, $q$Site & search$q$, false),
    ($q$Granite enquiry, guide-download and ad hoc upload forms live$q$, $q$Granite forms live$q$, $q$Enquiry, guide download and ad hoc upload forms.$q$, $q$Running the account$q$, $q$Pipeline & tracker$q$, true),
    ($q$Granite pipeline configured — stages, grade and intake-year tags, automations, attribution$q$, $q$Granite pipeline configured$q$, $q$Stages, grade and intake-year tags, automations and attribution.$q$, $q$Running the account$q$, $q$Pipeline & tracker$q$, false),
    ($q$Setup training held; one real lead traced end to end$q$, $q$Setup training held$q$, $q$One real lead traced end to end.$q$, $q$Running the account$q$, $q$Client relationship$q$, false),
    ($q$Granite bot live on the hub and WhatsApp; after-hours flow verified$q$, $q$Granite bot live$q$, $q$On the hub and WhatsApp. After-hours flow verified.$q$, $q$Running the account$q$, $q$Pipeline & tracker$q$, true),
    ($q$Nurture sequence built and firing — five steps$q$, $q$Nurture sequence built$q$, $q$Five steps, firing automatically.$q$, $q$Campaigns$q$, null, true),
    ($q$Enablement pack delivered — best practice, referral and feeder playbooks$q$, $q$Enablement pack delivered$q$, $q$Best practice, referral and feeder playbooks.$q$, $q$Content$q$, null, true),
    ($q$Trustpilot profile created and response templates loaded$q$, $q$Trustpilot profile created$q$, $q$Response templates loaded.$q$, $q$Running the account$q$, $q$Reviews & reputation$q$, false),
    ($q$PageSpeed comparison captured — the hub against the school's own site$q$, $q$PageSpeed comparison captured$q$, $q$The hub against the school's own site.$q$, $q$Running the account$q$, $q$Site & search$q$, false),
    ($q$DNS CNAME record actioned by the school's IT — ten working days$q$, $q$DNS record added$q$, $q$The CNAME record, actioned by the school's IT. Within 10 working days.$q$, $q$Running the account$q$, $q$Site & search$q$, false),
    ($q$Header and footer look-match signed off$q$, $q$Hub look signed off$q$, $q$The header and footer match, signed off by the school.$q$, $q$Running the account$q$, $q$Site & search$q$, false),
    ($q$GA4 and Google Ads access granted$q$, $q$Analytics access granted$q$, $q$GA4 and Google Ads.$q$, $q$Running the account$q$, $q$Site & search$q$, false),
    ($q$Link to the hub added to the school's main site navigation$q$, $q$Hub linked from school site$q$, $q$Added to the main site navigation.$q$, $q$Running the account$q$, $q$Site & search$q$, false),
    ($q$A named salesperson, and a first-response SLA they adopt$q$, $q$Salesperson named$q$, $q$One named salesperson, who adopts the first-response SLA.$q$, $q$Running the account$q$, $q$Year setup$q$, false),
    ($q$WhatsApp Business number verified$q$, $q$WhatsApp number verified$q$, $q$The WhatsApp Business number.$q$, $q$Running the account$q$, $q$Pipeline & tracker$q$, false),
    ($q$Bot FAQ and qualifying content signed off$q$, $q$Bot content signed off$q$, $q$The FAQ and qualifying questions.$q$, $q$Content$q$, null, false),
    ($q$Nurture sequence copy approved$q$, $q$Nurture copy approved$q$, null, $q$Campaigns$q$, null, false),
    ($q$Google Business Profile access granted$q$, $q$Business Profile access granted$q$, null, $q$Social media$q$, null, false),
    ($q$Photography library for the year$q$, $q$Photo library supplied$q$, $q$Photography for the year.$q$, $q$Running the account$q$, $q$Year setup$q$, false),
    ($q$Playbook owners named at the school$q$, $q$Playbook owners named$q$, $q$One owner at the school per playbook.$q$, $q$Running the account$q$, $q$Year setup$q$, false),
    ($q$Annual calendar issued — open days, guide dates, quarterly meetings, T-minus chase dates$q$, $q$Annual calendar issued$q$, $q$Open days, guide dates, quarterly meetings and T-minus chase dates.$q$, $q$Running the account$q$, $q$Year setup$q$, true),
    ($q$Nurture sequence copy refreshed for the year$q$, $q$Nurture copy refreshed$q$, $q$Refreshed for the year.$q$, $q$Campaigns$q$, null, false),
    ($q$Always-on search live, seasonal lead set to the choosing guide$q$, $q$Always-on search live$q$, $q$Seasonal lead set to the choosing guide.$q$, $q$Paid media$q$, $q$Google Search$q$, true),
    ($q$Open day dates locked for the whole year — at least eight weeks before each launch$q$, $q$Open day dates set$q$, $q$Every open day for the year. At least 8 weeks before each launch.$q$, $q$Events$q$, null, false),
    ($q$Targets for the year confirmed in writing$q$, $q$Targets confirmed$q$, $q$Confirmed in writing.$q$, $q$Running the account$q$, $q$Year setup$q$, false),
    ($q$One named point of contact who approves everything$q$, $q$Point of contact named$q$, $q$One person who approves everything.$q$, $q$Running the account$q$, $q$Year setup$q$, false);

update public.pipeline_template_tasks p
   set label = s.title, description = s.description, plan_group = s.grp, plan_row = s.row_name, is_deliverable = s.deliverable
  from template_seed s, public.pipeline_template_themes th, public.pipeline_templates tpl
 where p.label = s.old_label
   and p.theme_id = th.id and th.template_id = tpl.id
   and tpl.name = 'Schools — Media Mixology v1.5';
