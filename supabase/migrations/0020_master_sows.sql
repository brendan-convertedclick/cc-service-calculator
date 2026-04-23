-- 0020_master_sows.sql
-- Apply via mcp__cc-supabase__apply_migration (name: master_sows)
--
-- Move master SOW templates server-side. Today src/data/master-sows.json is
-- bundled into the browser, imported by ProjectBuilder, and forwarded as a
-- POST body to draft-sow on every quote draft (~80 KB round-trip + visible
-- to the client). They live in the DB now; draft-sow reads directly.
--
-- Initial seed inlines the current JSON content so the migration is
-- self-sufficient. Future updates flow through scripts/sync-sows.ts which
-- upserts into this table.

create table if not exists public.master_sows (
  slug text primary key,
  title text not null,
  body_md text not null,
  updated_at timestamptz not null default now()
);

alter table public.master_sows enable row level security;
drop policy if exists master_sows_authed_all on public.master_sows;
create policy master_sows_authed_all
  on public.master_sows for all to authenticated
  using (true) with check (true);

drop trigger if exists trg_master_sows_touch on public.master_sows;
create trigger trg_master_sows_touch before update on public.master_sows
  for each row execute function public.tg_touch_updated_at();

insert into public.master_sows (slug, title, body_md) values
  ('analytics-tracking', 'Analytics and Tracking Implementation — Master Scope of Work', $sow$---
type: sow
tier: master
service: analytics-tracking
title: Analytics and Tracking Implementation
status: draft
version: 1.0
created: 2026-04-20
updated: 2026-04-20
tags: [sow, analytics, tracking, master]
---

# Analytics and Tracking Implementation — Master Scope of Work

## Overview

One-off implementation of web and campaign analytics infrastructure: Google Analytics 4, Google Tag Manager, conversion goal setup, and linkage to Google Search Console and paid-media platforms. This is a **setup scope**, not an ongoing reporting retainer — once deployed, ongoing insight and reporting sit under [[seo-content]] (for organic) or [[paid-media-management]] (for paid). This SoW fills the gap called out as "out of scope" in both of those masters.

## Standard Deliverables

- **GA4 account creation** — new GA4 property configured against the client's domain, with correct timezone, currency, and industry category
- **Google Tag Manager container** — new GTM container created, installed on the site, and configured with base tags (page view, scroll, outbound click)
- **GA4 ↔ GTM wiring** — GA4 configuration tag deployed via GTM; data stream verified and receiving events
- **Conversion goals** — up to 3 agreed conversion events (e.g. form submit, button click, phone click) configured as GA4 events and marked as conversions
- **Search Console linkage** — GSC property verified (if not already) and linked to GA4 for integrated query data
- **Cross-platform linkage** — optional: link GA4 to Google Ads for import of conversions and audiences (requires Ads account access)

## Optional Add-Ons (quoted separately)

- Additional conversion events beyond the included 3
- Enhanced e-commerce tracking (item list views, add-to-cart, purchase events with item-level data)
- Server-side tagging (GTM server container)
- Meta Pixel / LinkedIn Insight Tag / TikTok Pixel installation alongside GTM
- Consent Mode v2 implementation for EU compliance
- Custom dashboards (Looker Studio or equivalent)
- CRM / Pipedrive / HubSpot event pass-through
- Call-tracking provider integration

Each of the above is scoped as a discrete line item with its own brief and estimate.

## Standard Exclusions

- **Ongoing reporting or insight analysis** — covered under [[seo-content]] or [[paid-media-management]] as retainer deliverables
- **CRM implementation** — partial integrations available as add-ons; full CRM build-out is a separate engagement
- **Data warehousing or BigQuery export** — separate scope
- **Historical data import** — GA4 starts from install date; migration of UA history is out of scope
- **Legal / privacy advice** — cookie banner, privacy policy, and consent strategy are client's legal responsibility
- **Third-party tool subscriptions** — SaaS licences (Hotjar, Mixpanel, etc.) are client-funded

## Standard Terms

- **Billing type**: fixed-price project. See [[commercials#5-payment-terms]].
- **Timeline**: typical delivery 3–5 business days from kickoff once access is granted.
- **Revisions**: 1 round of verification revisions included; structural changes to the tracking plan billed at `hourly.dev`.
- **Access requirements**: Google account with sufficient permissions, CMS / hosting access for GTM snippet install, Ads account access (if linking), domain DNS access (if domain verification needed).
- **Documentation**: short handover document listing the events tracked, their triggers, and where they surface in GA4.
- **Ownership**: all accounts (GA4, GTM, GSC) are created under client's Google account. Converted-Click has user-level access only.
- **Post-go-live**: 30-day verification window included — any configuration errors discovered in-platform during this window are fixed at no extra cost. Changes requested in the window (new events, etc.) are scoped as add-ons.

## Mapped Xero Products

See [[xero-products-2026-04-20]] for pricing.

| Code | Item | Use |
|---|---|---|
| 009 | Google Analytics Account Creation | Core fixed-price setup (GA4 + GTM + 3 goals + GSC link) |

Line items for add-ons (pixels, server-side, consent, dashboards) do not yet exist in Xero — quote as adhoc `hourly.dev` against a written estimate, or add discrete Xero items as they crystallise.

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-20 | v1.0 — Initial draft. Setup-only scope (not ongoing reporting). Fills the "tracking setup" exclusion called out in paid-media and SEO masters. Add-ons listed but not yet productised in Xero. | Brendan Gunn |
$sow$),
  ('creative-production', 'Creative Production — Master Scope of Work', $sow$---
type: sow
tier: master
service: creative-production
title: Creative Production
status: draft
version: 1.1
created: '2026-04-20'
updated: '2026-04-20'
tags:
  - sow
  - creative
  - master
---
# Creative Production — Master Scope of Work

## Overview

Design and production of digital creative assets for advertising, social media, and brand communications. Covers concept development through to final production-ready files. Engagements are scoped per brief as either a fixed-deliverable package or at an hourly rate against a quoted hours estimate.

## Standard Deliverables

- **Creative brief** — written brief documenting the objective, audience, messaging, format specs, and reference examples; signed off by client before production begins
- **Concept development** — 2–3 distinct creative directions per brief, presented as mood boards or rough layouts for client selection
- **Design production** — production of selected concept(s) into final artwork; includes specified format sizes
- **Revision rounds** — 2 rounds of client-requested changes per deliverable on the fixed-deliverable stream (see terms)
- **Final asset delivery** — production-ready files in agreed formats (PNG, MP4, PDF, etc.) delivered via shared drive or direct upload

## Standard Exclusions

- Photography or videography shoots — requires separate shoot brief and budget
- 3D rendering or CGI — scoped separately
- Copywriting beyond basic ad headlines/CTAs (long-form copy = separate scope)
- Brand identity or logo design — separate engagement
- Print production management (print-ready file prep is included; liaising with printers is not)
- Platform publishing or scheduling (creative is delivered as files; publishing is part of paid media or social management)
- Image sourcing — client supplies required images by default (see Terms for alternatives)

## Standard Terms

- **Billing type**: two streams —
    - **(a) Fixed-deliverable per brief** (e.g. mailer design, social media design) at a fixed cost
    - **(b) Hourly rate** against a quoted hours estimate

  Stream selection depends on the product/service being delivered.
- **Revision rounds**:
    - Fixed-deliverable stream: **2 revision rounds included** per deliverable; any revisions beyond the 2nd round roll onto the hourly rate
    - Hourly stream: all revisions billed at the hourly rate
- **Image sourcing**: client supplies required images. If the client cannot supply images, Converted-Click may (a) use its free stock library at no extra cost, or (b) purchase paid stock on the client's behalf with the cost passed through to the client. Image sourcing method must be agreed before production starts.
- **Approval turnaround**: client provides feedback within 3 business days per round; delays shift delivery
- **Kickoff requirement**: approved brief + brand guidelines + all required assets (logos, photography, copy) before production starts
- **File formats**: delivery in formats specified in brief; source files (Figma/AI/PSD) delivered only if explicitly agreed

## Mapped Xero Products

See [[xero-products-2026-04-20]] for pricing and [[commercials]] for rates/fees.

| Code | Item | Stream |
|---|---|---|
| 007 | Emailer — Creative only | Fixed — email design |
| 008 | Emailer — Creative and Development | Fixed — email design + dev |
| 022 | GDN Banners — Creative and Content | Fixed — 16 ad-size variations |
| 039 | Brochure Design | Fixed — brochure / catalog |
| 040 | Infographic | Fixed — infographic |
| 125 | Logo and Corporate Identity Creation | Fixed — brand / CI |
| 103 / 104 | Facebook Static — Design / Design+Copy | Fixed — paid-ad creative |
| 105 / 106 | Facebook Video — Design / Design+Copy | Fixed — paid-ad creative |
| 107 / 108 | Facebook Carousel — Design / Design+Copy | Fixed — paid-ad creative |
| 109 / 110 | Instagram Static — Design / Design+Copy | Fixed — paid-ad creative |
| 112 | Instagram Video — Design+Copy | Fixed — paid-ad creative |
| 113 / 114 | Instagram Carousel — Design / Design+Copy | Fixed — paid-ad creative |
| 115 / 116 | YouTube Static — Design / Design+Copy | Fixed — paid-ad creative |
| 117 / 118 | YouTube Video — Design / Design+Copy | Fixed — paid-ad creative |
| 119 / 120 | LinkedIn Static — Design / Design+Copy | Fixed — paid-ad creative |
| 121 / 122 | LinkedIn Video — Design / Design+Copy | Fixed — paid-ad creative |
| 123 / 124 | LinkedIn Carousel — Design / Design+Copy | Fixed — paid-ad creative |
| 126 | Creative Production (Adhoc) | Hourly — adhoc creative |

## Rates and Terms

All rates, revision policies, payment terms, kickoff requirements, image sourcing policy, meeting cadences, and out-of-scope defaults inherit from [[commercials]].

## Change Log

| Date | Change | Author |
|---|---|---|
| 2026-04-20 | v1.1 — Clarified billing model (fixed-deliverable with 2-revision cap before hourly overflow, or pure hourly). Removed retainer mention (retainers scoped under social-media-production SoW). Added image sourcing policy (client supplies / free library / paid stock pass-through). | Brendan Gunn |
| 2026-04-20 | v1.2 — Added Mapped Xero Products table and Rates and Terms section linking to [[commercials]] shared reference. | Brendan Gunn |
$sow$),
  ('email-marketing', 'Email Marketing — Master Scope of Work', $sow$---
type: sow
tier: master
service: email-marketing
title: Email Marketing
status: draft
version: 1
created: '2026-04-20'
updated: '2026-04-20'
tags:
  - sow
  - email
  - master
---
# Email Marketing — Master Scope of Work

## Overview

HTML email template development, campaign deployment, and transactional/sequence email production. Covers the build-and-deploy pipeline from an approved static mailer mock-up through to scheduled sends, test-send QC, and form-triggered sequences. Distinct from [[creative-production]] (static mailer design only, Xero 007) and from [[marketing-automation]] (chatbot + bundled automation-retainer plans). This SoW is the email-specific delivery layer that sits between them.

## Streams

### Stream 1 — Template build (per mailer)

- **Static mock-up approval** — inbound dependency from [[creative-production]] (Xero 007). Build work does not start without approved mock-up.
- **HTML build** — responsive HTML + inline CSS, dark-mode aware, accessibility pass (alt text, semantic headings)
- **Client-specific template customisation** — brand colours, logos, footer, unsubscribe wiring, per-ESP quirks
- **Test send QC** — inbox-rendering checks (Gmail, Outlook, iOS, Android), link and UTM verification, spam-score review

### Stream 2 — Campaign deployment (per send)

- **List prep** — audience upload/selection in the ESP; segmentation against agreed criteria
- **Schedule and send** — deploy at agreed send window; monitor initial delivery
- **Post-send check** — bounce/complaint review within 24h; report flag-worthy issues
- **Web banner production** — optional: matching banner set for on-site promo alignment (desktop + mobile variants)

### Stream 3 — Sequence / onboarding programs

- **Sequence design** — map out multi-step email flows (welcome, onboarding, mid-phase check-in, confirmation, reminder, feedback-request)
- **Copy deck → HTML → deploy** per step, coordinated with [[content]] for copy and [[creative-production]] for visuals
- **Trigger wiring** — form-submit → sequence-entry via [[marketing-automation]] or [[development]] depending on stack

## Standard Deliverables

- Approved HTML mailer (responsive, inbox-tested) per build
- Test send to agreed seed list before deploy
- Scheduled deploy at agreed window
- Post-deploy status (delivered, bounced, complaint summary) within 24h
- For sequences: a numbered delivery log showing which step fired, to whom, when

## Standard Exclusions

- **Static mailer design / mock-up** — covered under [[creative-production]] (Xero 007)
- **ESP subscription / licence fees** — client-funded pass-through (Mailchimp, Campaign Monitor, Klaviyo, etc.)
- **List acquisition or lead-generation** — client owns the list; agency does not source contacts
- **POPIA / GDPR consent strategy** — client's legal responsibility; agency implements mechanics only
- **Deliverability remediation beyond standard checks** — domain authentication (SPF/DKIM/DMARC) setup is scoped as a one-off under [[website-build]] or [[development]]
- **Ongoing list hygiene / deep segmentation strategy** — covered under [[marketing-automation]] bundled plans
- **SMS or WhatsApp broadcast** — separate scope; WhatsApp auto-response sits under [[marketing-automation]]
- **A/B testing programs beyond single-variant subject-line tests** — scoped separately

## Standard Terms

- **Billing type**: per-mailer fixed-price (build + deploy) or hourly for adhoc dev work against a quoted estimate
- **Revisions**: 1 round of HTML build revisions included (matching the approved mock-up); further revisions bill at `hourly.dev`. Design revisions route back to [[creative-production]].
- **Approval turnaround**: test-send approval expected within 1 business day before scheduled deploy; late approval shifts the send
- **Kickoff requirement**: approved mock-up, approved copy, final CTA URLs, ESP access, agreed send window and audience
- **Ownership**: HTML templates and client-customised assets are client-owned; reusable frameworks remain agency IP

## Mapped Xero Products

See [[xero-products-2026-04-20]] for pricing and [[commercials]] for rates/fees.

| Code | Item | Stream |
|---|---|---|
| 008 | Emailer — Creative and Development | Stream 1 — build (design+dev bundle) |
| 007 | Emailer — Creative only | Cross-ref: design-only route, under [[creative-production]] |

Note: deploy, test send, sequence wiring, and web banners do not yet have discrete Xero codes. Quote as `hourly.dev` against a written estimate, or add discrete Xero items as they crystallise.

## Rates and Terms

All rates, revision policies, payment terms, kickoff requirements, meeting cadences, and out-of-scope defaults inherit from [[commercials]].

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-20 | v1.0 — Initial draft. Fills the gap between creative-production (design mock-up) and marketing-automation (bundled retainers). Three streams: template build, campaign deploy, sequence programs. Xero mapping acknowledges sparse productisation of deploy/sequence work. | Brendan Gunn |
$sow$),
  ('local-seo', 'Local SEO and Google My Business — Master Scope of Work', $sow$---
type: sow
tier: master
service: local-seo
title: Local SEO and Google My Business
status: draft
version: 1
created: '2026-04-20'
updated: '2026-04-20'
tags:
  - sow
  - seo
  - local
  - gmb
  - master
---
# Local SEO and Google My Business — Master Scope of Work

## Overview

Local-search optimisation focused on Google Business Profile (GMB), map-pack ranking, review generation, and local citations. Extracts GMB-specific work from [[seo-content]] and [[social-media-management]] into a single master, reflecting programs like Trellidor's "GMB Strategy 2026" where GMB is a standalone initiative across a multi-branch footprint.

## Streams

### Stream 1 — Local SEO pack (setup)

- **GMB profile audit** — one-time review of existing listings per location
- **Listing optimisation** — categories, services, attributes, hours, description, photos
- **Map-pack ranking plan** — local keyword set, geo-grid baseline, quarterly targets
- **Review baseline** — review count, rating, response-rate audit

### Stream 2 — GMB posts (ongoing)

- **GMB post production** — promotions, events, offers, updates (image + copy + link)
- **AI-generated creative** — branded GMB post creative at scale across franchise/branch networks
- **Scheduling** — per-branch scheduling across the client's footprint (e.g. × 63 Trellidor franchises)

### Stream 3 — Review and citation management

- **Review generation prompts** — agreed touchpoint triggers to request reviews
- **Review response templates** — agency-drafted response copy, client-approved, deployed against incoming reviews
- **Local citation audit** — NAP (name/address/phone) consistency across major directories

## Standard Deliverables

- GMB audit report (per location or franchise batch)
- GMB optimisation completion (optimised profile per location)
- Monthly GMB post schedule at agreed volume (per branch × posts/month)
- Monthly local-search performance snapshot (rankings, map-pack visibility, review metrics)
- Review response rollout at agreed cadence

## Standard Exclusions

- **Organic site SEO** — covered under [[seo-content]]
- **Paid local campaigns (Google Local Services Ads, Performance Max for stores)** — covered under [[paid-media-management]]
- **Physical signage, in-store collateral, print** — out of scope
- **Client-side review replies requiring legal input** — disputes, defamation, legal escalation handled by client
- **Directory paid submissions** — pass-through cost if any premium listing fee applies
- **Franchise or branch data collection** — client supplies per-location data (addresses, hours, photos, services)

## Standard Terms

- **Billing type**:
    - Setup pack (Stream 1): fixed-price per location or batch
    - Ongoing (Streams 2 & 3): monthly retainer, priced per location and post volume
- **Per-location pricing**: setup and ongoing fees scale with branch count; multi-branch engagements apply a per-branch unit rate agreed in the project SoW
- **Approval turnaround**: monthly post schedule approved within 3 business days; review-response templates approved once at kickoff
- **Revisions**: 1 round of post-creative revisions per month included; further revisions bill at `hourly.creative`
- **Access requirements**: GBP / Google Business Profile Manager access per location, franchise coordination point-of-contact if multi-branch
- **Kickoff requirement**: per-location data sheet (NAP, hours, services, photos), brand guidelines, review-response tone of voice, approved creative template

## Mapped Xero Products

See [[xero-products-2026-04-20]] for pricing and [[commercials]] for rates/fees.

| Code | Item | Stream |
|---|---|---|
| 00111 / 111 | Local SEO Pack | Stream 1 — setup + map-rank + reviews |
| 34 | Google My Business Optimization | Stream 1 — GMB profile optimisation (hourly) |
| 033 | Google My Business Post | Stream 2 — per-post creation + schedule |

## Rates and Terms

All rates, revision policies, payment terms, kickoff requirements, meeting cadences, and out-of-scope defaults inherit from [[commercials]].

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-20 | v1.0 — Initial draft. Extracted GMB-focused work from [[seo-content]] and [[social-media-management]] into a dedicated master, driven by Trellidor GMB Strategy 2026 and similar multi-branch local-search programs. | Brendan Gunn |
$sow$),
  ('marketing-automation', 'Marketing Automation and Chatbots — Master Scope of Work', $sow$---
type: sow
tier: master
service: marketing-automation
title: Marketing Automation and Chatbots
status: draft
version: 1.0
created: 2026-04-20
updated: 2026-04-20
tags: [sow, automation, chatbot, master]
---

# Marketing Automation and Chatbots — Master Scope of Work

## Overview

Setup and ongoing operation of website chatbots, marketing automation workflows, and bundled "business plan" packages that combine automation with creative, content, paid media, and CRM integration. Two delivery modes: (a) **discrete automation setup** (chatbot or single automation workflow) and (b) **bundled retainer plans** which package automation alongside other Converted-Click services (SEO, ads, creative, social, CRM).

Bundled plans are orchestration contracts — they pull deliverables from other master SoWs ([[seo-content]], [[paid-media-management]], [[creative-production]], [[social-media-management]]) and layer automation + CRM on top. Each bundled plan's project SoW must enumerate which underlying master-SoW deliverables are included at what volume.

## Streams

### Stream 1 — Chatbot setup

- **Discovery** — identify the chatbot's purpose, surface location, and success metric
- **Platform selection** — recommend the best-fit platform (ManyChat / Intercom / Tidio / etc.) against the client's stack
- **Conversation design** — flow design in the chosen editor, tone and copy aligned with brand
- **Integration** — install on the website or messaging surface
- **Testing and training** — QA across happy-path and edge cases; initial training against FAQ content
- **Monitoring and tuning** — first-30-day analytics review; recommendations for iteration

### Stream 2 — Automation software subscription

Per the Xero line `1000 — Automation Software` (currently 250 conversations / 2,000 visitors per month). Includes platform access and baseline configuration. Volume upgrades priced separately.

### Stream 3 — Bundled retainer plans

Three productised tiers, each with escalating scope:

- **Business Plan — Marketing Automation** (Xero 1001) — Ultimate guides + Web Stories + SEO + Google Ads management + automation + email + PM + monthly feedback
- **Marketing Automation & Social Media** (Xero 1002) — everything in 1001 + social media management + Pipedrive CRM integration
- **Campaign Creation & Complete Creative Solutions** (Xero 1003) — everything in 1002 + full tailored campaign creation (strategy, ads, emails, landing pages) with full creative support

Each tier is a **packaged retainer** — the project SoW must cross-reference the underlying master SoWs and lock the monthly deliverable volume per service.

## Standard Deliverables (bundled plans)

Per monthly retainer cycle, a bundled plan delivers:

- A single **monthly plan document** showing what's being produced across every included service that month
- **Automation workflows** configured and maintained (lead-capture, nurture, re-engagement as agreed)
- **CRM integration** (Pipedrive or equivalent) — web-form-to-CRM pass-through, lead-status automation, basic reporting
- Underlying service deliverables per their respective master SoWs ([[seo-content]], [[paid-media-management]], [[creative-production]], [[social-media-management]])
- **Single monthly feedback session** — consolidated across all streams; additional meetings bill at `hourly.account`
- **Monthly performance report** — consolidated across all streams

## Standard Exclusions

- **CRM build-out beyond Pipedrive integration** — custom Salesforce / HubSpot / Zoho builds are separate
- **Custom automation beyond the agreed workflows** — e.g. bespoke segmentation engines, transactional email platforms, multi-brand orchestration
- **Third-party subscriptions** — Pipedrive, chatbot platform, email-send platform, automation tool licences are all client-funded pass-through
- **Data migration or CRM hygiene** — cleaning existing client data before the automation is scoped separately
- **Volume over the agreed tier** — exceeding conversation / visitor / lead limits triggers an upgrade and a revised retainer
- **Sales work** — Converted-Click does not handle lead qualification, sales calls, or closing on behalf of the client
- **Legal / compliance** — POPIA / GDPR strategy and consent-banner decisions are client responsibility
- **Changes to underlying master-SoW scope** — bundled plans inherit the exclusions of the underlying masters (see [[seo-content#standard-exclusions]], [[paid-media-management#standard-exclusions]], etc.)

## Standard Terms

- **Billing type**:
    - Chatbot setup (10): fixed-price project. See [[commercials#5-payment-terms]].
    - Automation software subscription (1000): monthly in advance.
    - Bundled plans (1001 / 1002 / 1003): monthly retainer, billed in advance.
- **Tier upgrades**: upgrading plans (1001 → 1002 → 1003) is mid-cycle pro-rated; downgrades take effect at next billing cycle.
- **Underlying-service volumes**: the project SoW must specify monthly deliverable volume per included service (e.g. "8 articles", "12 social posts", "R25k managed media spend"). Without this, the bundled retainer is ambiguous.
- **Media spend (1001 / 1002 / 1003)**: advertising budget is additional to the retainer; 15% optimisation fee applies per [[commercials#2-standard-fees]].
- **Third-party pass-throughs**: itemised on invoices at cost; no mark-up.
- **Approval turnaround**: monthly plan approval expected within 3 business days. Delayed approval compresses downstream stream schedules.
- **Reporting**: 1 × consolidated monthly report; stream-level deep-dives billed separately.
- **Revisions**: applied at the stream level per each underlying master's revision policy. See [[commercials#3-revision-policy]].
- **Kickoff requirement**: see [[commercials#6-standard-kickoff-requirements]]. Additionally: CRM access, automation platform access, existing lead data audit, consent policy alignment.
- **Exit**: automation workflows, CRM configuration, and chatbot conversations are client-owned and handed over on disengagement. Third-party subscriptions transfer to the client's billing account.

## Mapped Xero Products

See [[xero-products-2026-04-20]] for pricing.

| Code | Item | Stream |
|---|---|---|
| 10 | Chatbot Set Up | Stream 1 — Chatbot |
| 1000 | Automation Software | Stream 2 — Platform subscription |
| 1001 | Business Plan — Marketing Automation | Stream 3 — Bundled retainer (tier 1) |
| 1002 | Marketing Automation & Social Media | Stream 3 — Bundled retainer (tier 2) |
| 1003 | Campaign Creation & Complete Creative Solutions | Stream 3 — Bundled retainer (tier 3) |

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-20 | v1.0 — Initial draft. Three-stream structure (chatbot setup, automation subscription, bundled retainer plans). Explicitly models 1001/1002/1003 as orchestration contracts that inherit from other master SoWs, requiring project SoWs to lock per-stream deliverable volumes. | Brendan Gunn |
$sow$),
  ('paid-media-management', 'Paid Media Management — Master Scope of Work', $sow$---
type: sow
tier: master
service: paid-media-management
title: Paid Media Management
status: draft
version: 1.1
created: '2026-04-20'
updated: '2026-04-20'
tags:
  - sow
  - paid-media
  - master
---
# Paid Media Management — Master Scope of Work

## Overview

Ongoing management and optimisation of paid advertising campaigns across LinkedIn, Google, Facebook, and Instagram. Includes weekly and monthly optimisation, a monthly performance report, and a 30-minute monthly feedback session. Campaign creative is supplied by the client (or briefed as a separate Creative Production project). Monthly retainer priced as a percentage of managed media spend, with a minimum floor.

## Channels Covered

- LinkedIn Ads
- Google Ads (Search, Display, YouTube, Shopping — as agreed per project)
- Meta — Facebook and Instagram

Media buying on channels not listed above (e.g., TikTok, Pinterest, Snapchat, X/Twitter, programmatic DSPs) is out of scope unless added via amendment.

## Standard Deliverables

- **Weekly campaign optimisation** — bid adjustments, budget pacing, audience refinement, keyword and negative-keyword management (Google), A/B test monitoring, performance tuning
- **Monthly campaign optimisation** — strategic review, audience and placement restructuring, performance trend analysis
- **Monthly performance report** — spend, ROAS/CPA and key channel metrics, insights and recommendations
- **Monthly 30-minute feedback session** — one 30-minute meeting per month; client input captured and fed back into the optimisation cycle
- **Google Ads copy** — copy generation as part of ongoing optimisation; for new campaigns the client approves copy under agency direction
- **Creative implementation** — loading client-supplied creative variations into the ad platforms and managing rotation
- **Ad account access management** — ongoing Business Manager / Campaign Manager access, billing configuration verification

## Standard Exclusions

- **Creative production** — photography, video, graphic design, and all ad creative variations must be supplied by the client or briefed as a separate Creative Production project. Copy for non-Google channels is out of scope.
- **New campaign launches** — setup of new campaigns is a separate project line item, not part of the optimisation retainer
- **New ad account setup** — creating new ad accounts, Business Manager, LinkedIn Campaign Manager, or Google Ads account creation is a separate project line item
- **Analytics and tracking implementation** — pixel installation, conversion event setup, GA4 configuration, Tag Manager work, server-side tracking, UTM strategy — out of scope and billed separately
- **Additional meetings** — any meeting beyond the monthly 30-minute feedback session is charged separately at hourly rate
- **Ad-hoc / custom reporting** — reports outside the standard monthly report are billed separately
- **Ad policy disputes and account recovery** — appeals for disapproved ads or suspended accounts handled on a best-effort basis; complex or prolonged disputes may be billed separately
- **Third-party tool subscriptions** — call-tracking platforms, reporting tools, CRO platforms, etc. — client pays vendors directly
- **Landing page or website changes** — billed separately under Website Build SoW
- **SEO or organic content** — separate service
- **Email, SMS, CRM, influencer, affiliate marketing** — separate services
- **Media spend** — advertising budget is client-side and billed directly by the platforms

## Pricing Model

- **Management fee**: 15% of managed monthly media spend
- **Minimum monthly retainer**: R3,500 (applied when 15% of spend falls below this threshold)
- **Media spend**: billed directly to client by the platforms; not included in the management fee

## Standard Terms

- **Billing type**: monthly retainer
- **Meeting cadence**: 1 × 30-minute feedback session per month; additional meetings billed separately
- **New campaigns**: scoped and quoted separately from the retainer
- **Creative**: client-supplied (or briefed via separate Creative Production project); agency implements received creative into the platforms
- **Copy approval (new campaigns)**: client approves ad copy with agency direction before launch
- **Reporting cadence**: 1 × monthly report; ad-hoc reports billed separately
- **Approval turnaround**: client feedback within 5 business days; delays may shift delivery timelines
- **Ad account ownership**: client owns all ad accounts and retains access if the engagement ends
- **Kickoff requirement**: ad account access, brand assets, agreed monthly budget, initial creative variations, and working tracking/analytics must be in place before campaign activity commences

## Mapped Xero Products

See [[xero-products-2026-04-20]] for pricing and [[commercials]] for rates/fees.

| Code | Item | Stream |
|---|---|---|
| 013 | Ad Account Creation | Setup — new ad account |
| 014 | Google Search Campaign Creation | Setup — new campaign (Search) |
| 015 | Google GDN Campaign Creation | Setup — new campaign (Display) |
| 16 | Google Discovery Campaign Creation | Setup — new campaign (Discovery) |
| 017 | LinkedIn Campaign Creation | Setup — new campaign (LinkedIn) |
| 018 / 18 | Facebook Campaign Creation | Setup — new campaign (Meta) |
| 019 / 19 | Twitter Campaign Creation | Setup — new campaign (X) — outside default channel set |
| 075 | YouTube Campaign Setup | Setup — new campaign (YouTube) |
| 051 | LinkedIn Campaign Set Up | Setup — alt / legacy line |
| 102 / 21 | Google Search Ad Copy / Content Creation | Ongoing — ad copy |
| 020 / 20 | Campaign Optimization and Reporting | Ongoing — optimisation (hourly) |
| 023 | Audience Targeting Research | Ongoing — audience research (hourly) |
| 100 / 134 / 140 | Paid Media / Optimisation Fee | Ongoing — 15% media optimisation fee (see [[commercials#2-standard-fees]]) |
| 132 | LinkedIn Media Spend | Pass-through — client budget |
| 133 | Google Media Spend | Pass-through — client budget |
| 139 | Paid Media Spend | Pass-through — bundled media budget |
| 050 / 50 | LinkedIn Ad Spend | Pass-through — legacy |
| 076 | YouTube Campaign Spend | Pass-through — YouTube budget |

## Rates and Terms

All rates (hourly, minimum retainer, media optimisation fee), revision policies, payment terms, kickoff requirements, meeting cadences, and out-of-scope defaults inherit from [[commercials]].

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-20 | Initial draft | Brendan Gunn |
| 2026-04-20 | v1.2 — Added Mapped Xero Products table and Rates and Terms section linking to [[commercials]] shared reference. | Brendan Gunn |
| 2026-04-20 | Pricing model added (15% / R3,500 min); channels corrected to LinkedIn + Google + Meta; deliverables restructured (weekly + monthly optimisation, 30-min monthly feedback, Google Ads copy, creative implementation); exclusions added (new campaigns, new accounts, tracking setup, extra meetings); research-based additions (ad policy disputes, tool subs, account ownership, kickoff requirements) | Brendan Gunn |
$sow$),
  ('seo-content', 'SEO and Content — Master Scope of Work', $sow$---
type: sow
tier: master
service: seo-content
title: SEO and Content
status: draft
version: 1
created: '2026-04-20'
updated: '2026-04-20'
tags:
  - sow
  - seo
  - content
  - master
---
# SEO and Content — Master Scope of Work

## Overview

Search engine optimisation and content marketing services to grow organic visibility and traffic. Can be scoped as a one-off audit/project or as an ongoing monthly retainer. Covers technical SEO, on-page optimisation, and content creation.

## Standard Deliverables

- **SEO audit** — technical audit covering crawlability, indexation, site speed, Core Web Vitals, on-page factors, backlink profile; delivered as a prioritised action list
- **Keyword research** — target keyword set mapped to site pages and content opportunities; delivered as a spreadsheet with search volume and difficulty data
- **On-page optimisation** — updates to meta titles, descriptions, headings, internal linking, and image alt tags for agreed pages
- **Content brief(s)** — written content brief(s) per agreed topic, including target keyword, outline, word count, and reference sources
- **Content production** — written articles or page copy per agreed brief (word count and quantity specified per project)
- **Monthly SEO report** — keyword ranking movements, organic traffic summary, completed actions, next-month plan (retainer cadence)

## Standard Exclusions

- Paid search (Google Ads) — covered under Paid Media Management SoW
- Link building or digital PR campaigns — scoped separately
- Website development changes required to implement technical SEO fixes — billed under Website Build SoW if significant
- Social media content or scheduling
- Video production or podcast content
- Translation or multilingual SEO

## Standard Terms

- **Billing type**: fixed (audit/project) or monthly retainer (ongoing)
- **Revision rounds**: 1 round per piece of written content; additional rounds billed at hourly rate
- **Approval turnaround**: client provides feedback within 5 business days; content goes live only on client approval
- **Kickoff requirement**: Google Search Console and Analytics access required before audit; CMS access required for on-page implementation
- **Content ownership**: all content produced is client-owned on delivery; Converted-Click retains no licence

## Mapped Xero Products

See [[xero-products-2026-04-20]] for pricing and [[commercials]] for rates/fees.

| Code | Item | Stream |
|---|---|---|
| 24 | SEO Onboarding | Fixed — project setup |
| 25 | SEO Audit | Fixed — technical audit |
| 26 | SEO Competitor Audit | Fixed — competitor analysis |
| 027 / 059 | SEO On Page | Hourly — on-page optimisation |
| 28 | SEO Off Page (per link) | Fixed — link building (per link) |
| 29 | SEO Redirect Mapping / 301 Migration | Fixed — migration plan |
| 030 / 068 | SEO Toxic Links Analysis | Fixed — backlink audit + disavow |
| 031 / 055 | SEO Reporting / Reporting | Hourly — reporting |
| 32 | Content Strategy (3 month) | Fixed — strategy + keyword portfolio |
| 34 | Google My Business Optimization | Hourly — GMB optimisation |
| 35 | Content Calendar (3 month) | Fixed — 16 articles/mo, 3-mo plan |
| 135 | Content Calendar | Hourly — content calendar adhoc |
| 36 | Article Creation | Fixed — 4 × 1000-word articles/mo |
| 137 | Content Creation | Fixed — bundled content retainer |
| 056 | Restore blog content and optimize | Hourly — content restoration |
| 00111 / 111 | Local SEO Pack | Fixed — GMB pack (listing + map rank + reviews) |
| 58 | Semantic Intelligence SEO Tool | Pass-through — tool licence |
| 060 | SEO:Research | Hourly — research adhoc |
| 061 / 062 | SEO:Services | Hourly — legacy / catch-all |

## Rates and Terms

All rates, revision policies, payment terms, kickoff requirements, meeting cadences, and out-of-scope defaults inherit from [[commercials]].

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-20 | v1.0 — Initial draft covering audit, keyword research, on-page, content briefs, content production, and monthly reporting. | Brendan Gunn |
| 2026-04-20 | v1.1 — Added Mapped Xero Products table and Rates and Terms section linking to [[commercials]] shared reference. | Brendan Gunn |
$sow$),
  ('social-media-management', 'Social Media Management — Master Scope of Work', $sow$---
type: sow
tier: master
service: social-media-management
title: Social Media Management
status: draft
version: 1.0
created: 2026-04-20
updated: 2026-04-20
tags: [sow, social, content, master]
---

# Social Media Management — Master Scope of Work

## Overview

Monthly management of organic social media presence across Facebook, Instagram, LinkedIn, and Google My Business. Covers strategy, monthly content calendar, post creation, scheduling, and reporting. Distinct from [[creative-production]] (which produces paid-ad creative) and from [[paid-media-management]] (which runs paid campaigns). This SoW is organic-only; paid amplification is scoped separately.

## Scope of Channels

- **Facebook** — page posts and scheduling
- **Instagram** — feed posts and scheduling (Reels and Stories optional, scoped per project)
- **LinkedIn** — company-page posts and scheduling
- **Google My Business** — GMB posts (promotions, events, offers, updates)

TikTok, YouTube (organic), X/Twitter, Pinterest, Snapchat, and Threads are **not included** unless added via amendment.

## Standard Deliverables

### Strategy

- **Monthly content calendar** — post themes, topics, channels, and publish dates, aligned with client marketing priorities
- **Digital / campaign strategy (optional retainer add-on)** — quarterly or monthly strategy document: audience, messaging pillars, KPIs, and content roll-out plan

### Production

- **Post creation** — copy + visual per post, aligned with the approved calendar. Standard post format is a single image + caption. Video, carousel, and Reels are scoped separately and priced against [[creative-production]].
- **GMB post creation** — posts with image, text, and link (promotions, highlights, offers, updates)
- **Scheduling** — posts loaded to the client's native scheduler or agreed third-party tool

### Community and reporting

- **Engagement monitoring** — monitoring for inbound comments, DMs, and queries; responses routed to the client within 1 business day (client handles responses unless a managed-response addendum is agreed)
- **Monthly performance report** — reach, engagement, follower growth, top posts, insights

## Standard Exclusions

- **Paid social advertising** — covered under [[paid-media-management]]. This SoW is organic-only.
- **Video production, Reels production, or motion creative** — covered under [[video-3d-production]] or [[creative-production]]
- **Influencer, affiliate, or PR outreach** — separate scope
- **Crisis communications or reputation management** — separate engagement
- **Managed community response / inbox management** — default is route-to-client; full managed response is a separate addendum
- **Email, SMS, WhatsApp marketing, push notifications** — separate channels, separate scope
- **Net-new channel launches** (e.g. launching a TikTok or YouTube channel) — scoped as a one-off setup project before it folds into the retainer
- **Photography / video shoots** — client-supplied or scoped under [[video-3d-production]]
- **Paid-ad creative variants** — covered under [[creative-production]]

## Standard Terms

- **Billing type**: monthly retainer (default) OR 3-month fixed content plan. See [[commercials]].
- **Content volume**: agreed per project SoW (e.g. "12 feed posts + 4 GMB posts / month"). Default package references Xero code 038 (3-month plan) or 037 (per post) depending on structure.
- **Approval turnaround**: monthly calendar approval expected within 3 business days of submission. Late approval shifts scheduling.
- **Revisions**: 1 round of revisions per post included; further revisions roll to `hourly.creative` per [[commercials#3-revision-policy]].
- **Meeting cadence**: see [[commercials#8-meeting-cadence-defaults]] — 1× monthly content planning call included.
- **Image sourcing**: see [[commercials#7-image-and-asset-sourcing-policy]]. Client supplies → free stock → paid stock pass-through.
- **Platform access**: client grants Converted-Click the necessary Business Manager / LinkedIn Page Admin / GMB Manager access. See [[commercials#6-standard-kickoff-requirements]].
- **Ownership**: all content, captions, and scheduling artifacts are client-owned on delivery.

## Mapped Xero Products

See [[xero-products-2026-04-20]] for pricing.

| Code | Item | Use |
|---|---|---|
| 037 | Social Media Post | Per-post line item (bundle to monthly quantity) |
| 038 | Social Media Plan (3 month) | 3-month organic plan (FB + IG + LinkedIn) |
| 033 | Google My Business Post | GMB post creation and scheduling |
| 043 | Digital Strategy | Strategy retainer add-on (full-service) |
| 044 | Campaign Strategy | Strategy + content + reporting (lighter tier) |
| 065 | Social Media | Legacy / placeholder — use 037 / 038 going forward |

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-20 | v1.0 — Initial draft. Organic-only scope (FB, IG, LinkedIn, GMB). Separated from Creative Production (paid-ad creative) and Paid Media Management (paid amplification). Default package = monthly retainer; 3-month fixed plan as alternative. | Brendan Gunn |
$sow$),
  ('video-3d-production', 'Video and 3D Production — Master Scope of Work', $sow$---
type: sow
tier: master
service: video-3d-production
title: Video and 3D Production
status: draft
version: 1.0
created: 2026-04-20
updated: 2026-04-20
tags: [sow, video, 3d, production, master]
---

# Video and 3D Production — Master Scope of Work

## Overview

Production of video, motion graphics, 3D modelling, AR content, and the full supporting stack (art direction, voiceover, audio, licensed music, post-processing). Engagements are scoped per brief as a fixed-price production with a line-itemised crew / service breakdown. Distinct from [[creative-production]] (static and animated social / ad creative without a shoot or full 3D pipeline).

## Production Streams

### Video production

- **Pre-production** — brief, storyboard, shot list, location and talent logistics
- **Video shooting** — on-location or studio shoot, agreed crew and equipment
- **Video editing** — cut, colour, motion titles, basic sound mix
- **Motion graphics and animation** — up to 60s motion graphics sequences per brief
- **High-res rendering** — 4K or lower-tier renders per brief

### 3D / AR production

- **3D modelling** — product or environment modelling, optimised for web, AR, and video use cases
- **Web AR / 3D configurator** — interactive, programmatically controlled AR experience embedded on a client site (uses [[website-build]] for any hosting integration)
- **3D rendering** — per-second (video) or per-frame (still) rendering at agreed resolution

### Supporting services

- **Art direction** — campaign ideation, artboards, visual reference
- **Voiceover** — talent performance fee, licence rights (usage-based), and booking
- **Audio studio** — VO recording, final mix, sound design
- **Production library music** — licensed music supplied
- **Post-processing** — colour, retouching, compositing touch-ups

## Standard Deliverables (per engagement)

Every production engagement delivers:

- **Signed creative brief + storyboard / treatment** before production begins
- **Production schedule** — shoot dates, render deadlines, review milestones
- **Dailies / work-in-progress cuts** at agreed checkpoints
- **Final master** in the agreed delivery format (MP4 / MOV / 3D asset bundle)
- **Derivative cuts** — up to 2 platform-specific derivative cuts per master (e.g. square, vertical) if agreed in brief

Exact deliverable quantities and durations are scoped in the project SoW.

## Standard Exclusions

- **Concept and scripting beyond agreed storyboard rounds** — major script changes after approval are paid revisions
- **Additional shoot days** beyond the quoted schedule — quoted as a line-item extension
- **Talent / model fees beyond the quoted VO line** — separate pass-through
- **Location fees and permits** — client-funded pass-through unless explicitly in the project SoW
- **Music licensing beyond the production library** — bespoke sync licences are separate
- **Actor / VO broadcast licence extensions** — VO licence is capped (see product line 3D006); broadcast or international extension is a separate purchase
- **Brand-identity or logo work** — covered under [[creative-production]]
- **Platform publishing / ad trafficking** — covered under [[paid-media-management]] and [[social-media-management]]
- **Paid media amplification** — separate scope
- **Storage of working files beyond 12 months** — archive beyond this window is client-managed

## Standard Terms

- **Billing type**: fixed-price project with a line-itemised breakdown. See [[commercials#5-payment-terms]].
- **Project management fee**: `fees.pm_percentage` (20%) applied to the production subtotal when the engagement exceeds a single deliverable. See [[commercials#2-standard-fees]].
- **Revisions**:
    - Storyboard / script: 2 rounds included
    - Work-in-progress edit: 2 rounds included
    - Final master: 1 round of tweaks included
    - Further revisions billed at `hourly.creative` or `hourly.dev` depending on task
- **Approval turnaround**: 3 business days per review round; shoot-dependent stages require faster approval and are flagged in the schedule.
- **Image / asset sourcing**: see [[commercials#7-image-and-asset-sourcing-policy]]. Product samples for 3D modelling are client-supplied.
- **Voiceover licensing**: default licence is 12 months SA social + web (product 3D006). International or broadcast usage is quoted separately.
- **Music**: licensed from Converted-Click's production library OR supplied by client. Bespoke sync licensing is separate.
- **Ownership**: delivered final masters and derivative cuts are client-owned. Working 3D scene files, project files (Premiere / After Effects), and raw footage are retained by Converted-Click unless explicitly released in the project SoW (additional fee applies).
- **Kickoff requirement**: see [[commercials#6-standard-kickoff-requirements]]. Additionally: brand / product assets, approved storyboard, agreed delivery formats, and signed talent / location releases where applicable.

## Mapped Xero Products

See [[xero-products-2026-04-20]] for pricing.

| Code | Item | Stream |
|---|---|---|
| 130 | Video Shooting | Video — production |
| 131 | Video Editing | Video — post |
| 3D001 | Motion Graphics & Animation | Video — motion |
| 3D002 | 4K High Res Rendering | Video — rendering |
| 011 | Web story development & set live | Video — AMP / Web Stories |
| 045 | Web AR / 3D Modeling | 3D / AR — modelling |
| 046 | 3D Configurator | 3D / AR — interactive |
| 063 | 3D modelling creative production | 3D / AR — modelling (legacy) |
| 3D0101 | 3D Rendering — High Res Video | 3D / AR — render (per sec) |
| 3D0102 | 3D Rendering — High Res Still | 3D / AR — render (per still) |
| 3D003 | Art Direction | Supporting — ideation |
| 3D004 | Post Processing | Supporting — post |
| 3D005 | Voice Over Artist | Supporting — VO performance |
| 3D006 | Voice Over Artist — License Rights | Supporting — VO licence |
| 3D007 | Voice Over Artist — Booking Fee | Supporting — VO booking |
| 3D008 | Audio Studio | Supporting — audio |
| 3D009 | Production Library Music | Supporting — music |
| 3D010 | Project Management Fee | Supporting — PM (% of subtotal) |

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-20 | v1.0 — Initial draft. Consolidates all video, 3D, AR, VO, audio, and music product lines into a single production master. Line-itemised quoting with 20% PM fee on multi-deliverable engagements. Explicit exclusions around licence extensions, additional shoot days, and working-file retention. | Brendan Gunn |
$sow$),
  ('website-build', 'Website Build — Master Scope of Work', $sow$---
type: sow
tier: master
service: website-build
title: Website Build
status: draft
version: 1.3
created: '2026-04-20'
updated: '2026-04-20'
tags:
  - sow
  - web-dev
  - master
---
# Website Build — Master Scope of Work

## Overview

Design and development of websites on WordPress or Shopify. Engagements follow one of two tracks — **new build** or **redesign of an existing website** — and are scoped as fixed-price projects priced per page and per section within each page. Delivery flows through debriefing → wireframe and section mapping → styling reference → design mockup → development.

## Delivery Process

1. **Debriefing session** — kickoff with the client to capture goals, audience, platform preference, and sitemap.
2. **Wireframe & section mapping (Excel)** — a light wireframe document mapping each page and the sections within each page. The quote is based on this page and section count. Client signs off the section map before design begins.
3. **Styling reference** — Converted-Click selects current live websites as styling references and presents them for client feedback on likes/dislikes.
4. **Design mockup (Adobe)** — the designer produces a high-fidelity mockup per page in Adobe and issues it to the client. Feedback is collected in rounds. At the end of each round Converted-Click asks the client to confirm the feedback is complete; once confirmed, the round is "frozen" and counts as one revision.
5. **Development** — once mockups are approved, the page is developed on the agreed platform (WordPress or Shopify). Minor copy changes during development are included; structural or design changes are treated as paid revisions.

## Standard Deliverables

- **Debriefing session** — kickoff workshop to agree goals, sitemap, and platform
- **Wireframe & section map (Excel)** — document defining each page and its sections; basis for the fixed-price quote
- **Styling reference selection** — curated references from existing live websites for client feedback
- **Design mockups (Adobe)** — high-fidelity mockups for each agreed page
- **Development** — build of approved mockups on WordPress or Shopify, with responsive layout
- **Minor copy updates during development** — included as part of the build

## Standard Exclusions

- **Copywriting** — client is responsible for all website copy
- **Creative images** — client is responsible for sourcing and the cost of all creative images. Converted-Click can source from a free stock library on request; anything beyond that (paid or licensed imagery) is client-funded
- **Image editing or image changes** — any edits to images, retouching, resizing beyond normal web optimisation, or other creative image work is a creative task quoted separately
- **Competitor or alternative research** — research into competitors, benchmarks, or alternative solutions is out of scope and quoted separately if required
- **Paid theme purchases** — if the client wants a paid theme, the theme cost is client-funded (same principle as paid plugins)
- **Custom or special functionality** — anything beyond a standard static website (calculators, quizzes, custom tools, booking logic, dynamic pricing, etc.) is a new scope / new project
- **Connected-account setup** — Cloudflare, email-marketing platforms (Mailchimp, Klaviyo), analytics accounts, and similar third-party account setup is a separate scope
- **Third-party platform integrations** — WhatsApp, CRMs, payment gateways beyond platform defaults, and any external platform connection is a separate scope / new project
- **Sections beyond the quoted count** — any additional section above the number quoted per page falls out of scope and is quoted separately
- **Major structural or design revisions after mockup approval** — e.g., redesigning a section or restructuring a page — billed as a paid revision
- **Revisions beyond the included 2 rounds per page**
- **Paid plugins or third-party subscriptions** — any paid plugin required for the site is billed to the client
- **Going live / production / deployment** — this SoW covers creation of the website only; production deployment and launch is handled as a separate production step
- **Ongoing maintenance, hosting, SEO, and content** — separate SoWs

## Standard Terms

- **Billing type**: fixed-price project
- **Tracks**: new build OR redesign of existing website
- **Platforms**: WordPress or Shopify
- **Quoting basis**: number of pages × number of sections per page. Any sections added beyond the quoted count are out of scope and quoted separately
- **Revision rounds**: 2 revisions per page on design. Each "freeze" (a feedback round the client confirms as complete) counts as one revision
- **During development**: minor copy changes included; structural or design changes billed as paid revisions
- **Content & media**: client supplies all copy and all creative images before build begins
- **Paid plugins**: covered by the client
- **Scope boundary**: SoW covers creation only. Going live / production is a separate step outside this scope
- **Payment schedule**: 50% upfront, 50% on approval of creation (project SoW may override)

### Pricing Model

- **In-scope work (fixed cost)**: the project is quoted as a fixed price calculated on a **per-page × per-section** basis, against Converted-Click's standard per-page and per-section rates.
- **Out-of-scope work (hourly)**: any work that falls outside the fixed-price boundary — additional sections beyond the quoted count, major structural revisions, creative / image work, research, custom functionality, third-party integrations, connected-account setup, meeting overages, etc. — is billed at Converted-Click's standard hourly rate.

### Meetings & Communication

- **Included meeting time**: up to 4 hours of scheduled meetings per project for a standard small build (≈5 pages). Larger builds allocate additional meeting time in the project SoW.
- **Indicative distribution**:
  - Debriefing / kickoff — up to 90 min
  - Section-map walkthrough — up to 30 min
  - Styling reference review — up to 30 min
  - Design mockup reviews — up to 2 × 45 min (one per "freeze" revision)
  - Development check-in — up to 30 min
- **Async-first feedback**: revision feedback should be captured asynchronously (email or ClickUp task comments) wherever possible. Meetings are reserved for stages that benefit from live discussion.
- **Overages**: meeting time beyond the included allowance is billed at Converted-Click's standard hourly rate.

## Mapped Xero Products

See [[xero-products-2026-04-20]] for pricing and [[commercials]] for rates/fees.

| Code | Item | Stream |
|---|---|---|
| 002 | Full Website Build Page — Development, No SEO | Fixed — per page (dev only) |
| 003 | Full Website Build Page — Full on-page SEO | Fixed — per page (with SEO) |
| 004 | Full Website Build Page — Development & SEO | Fixed — per page (variant pricing) |
| 005 | Landing Page Build — No SEO | Fixed — landing page (dev only) |
| 006 | Landing Page Build — Full SEO | Fixed — landing page (with SEO) |
| 047 | Landing Page Hosting | Pass-through — hosting addon |
| 048 | Landing Pages | Generic / legacy placeholder |
| 052 | Microsite | Fixed — microsite package |
| 053 | New Website Design & Build | Fixed — bundled new build |
| 20112 | CDN Implementation | Fixed — CDN setup (overlaps [[website-hosting-maintenance]]) |
| 000101 | Development | Hourly — `hourly.dev` |
| 66 | Testing | Hourly — QA / test |
| 69 | User Experience Design | Hourly — UX wireframes |
| 70 | User Interface Design | Hourly — UI design |
| 74 | Workshop Discovery Session & Site-mapping | Fixed — kickoff workshop |

## Rates and Terms

All rates, revision policies, payment terms, kickoff requirements, image sourcing policy, meeting cadences, and out-of-scope defaults inherit from [[commercials]].

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-20 | Restructured around Converted-Click's actual website-build process: two tracks (new build / redesign), debriefing kickoff, Excel wireframe/section mapping, quoting per page × per section, styling reference stage, Adobe mockup stage with 2 revisions per page via "freeze" confirmation, development-phase change policy (minor copy in / structural paid), WordPress/Shopify platforms. Going-live and paid plugins moved to exclusions. | Brendan Gunn |
| 2026-04-20 | Added exclusions: image editing, competitor research, paid theme purchases, custom/special functionality (calculators etc.), connected-account setup (Cloudflare, email marketing), third-party integrations (WhatsApp, CRMs). Added Meetings & Communication subsection with 4-hour scheduled-meeting cap for small builds, indicative distribution, async-first feedback preference, and hourly-rate overages. | Brendan Gunn |
| 2026-04-20 | Added Pricing Model subsection: fixed cost on a per-page × per-section basis for in-scope work; hourly rate for anything outside the fixed boundary. | Brendan Gunn |
| 2026-04-20 | v1.4 — Added Mapped Xero Products table and Rates and Terms section linking to [[commercials]] shared reference. | Brendan Gunn |
$sow$),
  ('website-hosting-maintenance', 'Website Hosting and Maintenance — Master Scope of Work', $sow$---
type: sow
tier: master
service: website-hosting-maintenance
title: Website Hosting and Maintenance
status: draft
version: 1.0
created: 2026-04-20
updated: 2026-04-20
tags: [sow, hosting, maintenance, master]
---

# Website Hosting and Maintenance — Master Scope of Work

## Overview

Ongoing hosting and maintenance of WordPress and Shopify websites. Two streams: (a) **annual hosting** — a fixed-fee hosting subscription providing the infrastructure, backups, and security baseline; (b) **adhoc maintenance** — hourly-billed work for bug fixes, plugin/theme updates, cache/security configuration, and general upkeep outside the hosting baseline. Engagements almost always pair a hosting tier with an adhoc maintenance allowance.

## Hosting Tiers

- **Standard Annual Hosting** — daily + on-demand backups, NVMe storage, WordPress vulnerability scanner, WP acceleration, enhanced DDoS protection. Suits small-to-medium brochure sites.
- **Enterprise Annual Hosting** — standard tier PLUS access to Converted-Click's licensed plugin suite, CDN integration, critical error notifications, and 1× monthly plugin upgrade cycle. Suits feature-heavy sites, e-commerce, or client-critical platforms.

Hosting is billed annually in advance at the rate defined in [[xero-products-2026-04-20]]. Mid-term upgrade from standard → enterprise is pro-rated.

## Standard Deliverables

### Hosting stream (annual subscription)

- **Infrastructure** — provisioning and ongoing operation of the agreed hosting tier
- **Backups** — daily automated + on-demand backups, retained per hosting policy
- **Security baseline** — WP vulnerability scanning, DDoS protection, SSL management
- **Uptime** — best-effort uptime monitoring; no contractual SLA unless written into the project SoW
- **Enterprise only** — licensed plugin suite access, CDN enabled, critical error notifications, monthly plugin upgrade cycle

### Maintenance stream (adhoc, hourly)

- **WordPress / Shopify bug fixes** — resolution of site errors, broken functionality, theme conflicts
- **Plugin and theme updates** — controlled updates outside the monthly enterprise cycle
- **Hosting / cPanel issues** — investigation and resolution of hosting-layer issues
- **Content and file uploads** — minor uploads, media management, small copy changes
- **Cache and performance configuration** — cache setup, speed tuning, minor Core Web Vitals fixes
- **Security response** — investigation and remediation of flagged vulnerabilities or incidents

## Standard Exclusions

- **New build or redesign work** — covered under [[website-build]]
- **Custom development or new features** — any net-new functionality (calculators, integrations, custom tools) is a new project scope
- **SEO work** — covered under [[seo-content]]; on-page SEO fixes requested through maintenance bill as adhoc SEO hours
- **Third-party account setup** — Cloudflare, email-marketing platforms, analytics — separate scope (see [[analytics-tracking]] and [[website-build]])
- **Paid plugin or theme licences** — client-funded pass-through; not included in hosting fees
- **Domain registration and renewal** — client-owned; Converted-Click manages only if explicitly agreed
- **Email hosting** — not provided; recommend dedicated email providers (Google Workspace, Microsoft 365)
- **Full site migrations from other hosts** — scoped and quoted separately as a migration project
- **Disaster recovery beyond the backup policy** — e.g. recovery from client-side deletion beyond retention window
- **Uptime SLAs / 24-7 on-call** — not included unless a bespoke SLA addendum is signed

## Standard Terms

- **Billing type**: annual hosting subscription (fixed) + adhoc maintenance (hourly). See [[commercials]].
- **Hourly rate**: `hourly.maintenance` — see [[commercials#1-hourly-rate-card]]
- **Maintenance pre-pay**: client may pre-purchase a block of maintenance hours at `hourly.maintenance` for priority scheduling. Unused hours do not roll past 12 months.
- **Response cadence**: best-effort acknowledgement within 1 business day. Critical outages prioritised.
- **Access requirements**: see [[commercials#6-standard-kickoff-requirements]]. Specifically: CMS admin access, hosting/cPanel access, DNS access for CDN/hosting changes.
- **Ownership**: see [[commercials#9-ownership-and-access]]. Client owns the domain, site content, and hosting account; Converted-Click manages on client's behalf.
- **Renewal**: hosting auto-renews annually unless cancelled 30 days before renewal date.
- **Exit**: on disengagement Converted-Click provides a full site backup and assists with migration to client's chosen host; migration work is billed hourly.

## Mapped Xero Products

See [[xero-products-2026-04-20]] for pricing.

| Code | Item | Stream |
|---|---|---|
| 10111 | Annual Website Hosting | Hosting — Standard tier |
| 10112 | Annual Website Hosting — Enterprise Plugins | Hosting — Enterprise tier (annual) |
| 20111 | Enterprise Website Hosting | Hosting — Enterprise tier (variant pricing) |
| 012 | Website Maintenance (Adhoc) | Maintenance — hourly |
| 071 | Website Cache & Security | Maintenance — cache / security |
| 072 | Website Technical | Maintenance — technical adhoc |
| 073 | Website uploads & maintenance | Maintenance — uploads / admin |

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-20 | v1.0 — Initial draft. Two-stream model (annual hosting subscription + adhoc hourly maintenance) based on Xero catalogue. Standard vs Enterprise tiers, exclusions for net-new builds / SEO / paid plugins / email hosting, and explicit non-SLA position. | Brendan Gunn |
$sow$)
on conflict (slug) do update set
  title = excluded.title,
  body_md = excluded.body_md,
  updated_at = now();
