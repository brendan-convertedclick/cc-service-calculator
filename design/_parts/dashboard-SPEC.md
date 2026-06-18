# Dashboard restructure — shared spec for option builders

You are building ONE design option as a self-contained HTML fragment that will be
concatenated into `design/dashboard-options.html` alongside other options.
The page already has Inter + JetBrains Mono loaded and the CSS variables below
defined at `:root`. Do NOT emit `<html>/<head>/<body>` — emit ONE `<article>` only.

## Context — what the dashboard is today

The dashboard (route `/`, `DashboardShell`) is a **3-pane app shell**:

1. **Icon rail** (56px) — vertical app navigation, icons only.
2. **Project tree** (~240px) — "Projects" header + a "Completed" toggle, a live
   filter input, three scope-filter pills (`14 on track` / `5 attention` /
   `2 overdue`), then collapsible **client groups**, each listing its active
   projects as rows (status dot · client — project name).
3. **Main pane** — shows **Operations overview** until a project is clicked, then
   swaps the WHOLE pane for that project's detail view.

The Operations overview (the part people mean by "the dashboard") is a flat
top-to-bottom scroll of FIVE stacked blocks:

1. Header: "Operations overview" + date + "21 active projects across 9 clients".
2. **A row of 6 metric cards**, all the same size, mixing two different kinds of
   thing: three are *clickable scope-status filters* (On track 14, Needs attention 5,
   Overdue 2) and three are *passive KPIs* (642h burned this month, 86% on-time
   delivery, 4.2d avg brief→DFT). Every card has a thin gradient hairline on top.
3. **"⚡ Needs your attention"** — a flat list of project rows.
4. **"Recent projects"** — another flat list of identical-looking project rows.
5. **"Client margin — rolling 30 days"** — a 5-column table.
6. A faint **AI prompt panel** ("Generate health narrative").

## Why it reads as a poor layout (the problems to solve)

1. **No focus / no hierarchy.** Everything is the same weight in one long scroll.
   There is no answer to "what do I do right now" — the two things that need action
   (overdue, attention) look identical to the five that don't.
2. **The 6 metric cards conflate two semantics** — interactive filters vs passive
   KPIs — in one undifferentiated row. You can't tell which cards *do* something.
3. **Two near-identical flat lists** (Attention, Recent) repeat the same row design;
   the eye can't tell them apart at a glance.
4. **The margin table is buried** at the bottom below the fold, even though margin
   is a headline business signal.
5. **Lots of vertical scroll, little density.** On a wide monitor the right pane is
   a narrow column of stacked sections with huge empty gutters.

## Functionality that MUST survive (visible or one interaction away)

- The **6 metrics**: On track (14), Needs attention (5), Overdue (2) — these three
  are clickable and **filter the project list**; Burned this month (642h),
  On-time delivery (86%, 32/37), Avg brief→DFT (4.2d, 18 projects).
- **Project rows**: status dot (on_track=teal, needs_attention=amber, overdue=red),
  `Client — Project name`, an italic reason line, a scope-status badge, and an
  engagement-type label (retainer / fixed / project). Clicking a row **opens that
  project** (in the mockup: highlight it + show a small snackbar "Opening {name}…").
- The **Needs-attention** group and the **Recent** group of projects.
- The **Client margin** table: RAG dot, client, revenue, cost, margin %, vs-target.
- The **project-tree sidebar**: client groups, filter, scope pills, completed toggle.
  You MAY keep, restructure, fold-away, or replace the sidebar as your concept
  dictates — but the dashboard must read as a complete app, not a floating widget.
- The **AI "health narrative"** affordance (a button is enough; can be chrome).

In the mockup make AT MINIMUM these work in vanilla JS: (a) the three scope-status
controls filter which projects show, (b) clicking a project shows the snackbar, and
(c) your option's signature interaction (lane collapse, segmented swap, tile filter,
sort, snooze, …). Selects/search inputs can be non-functional chrome. Use a small
inline snackbar div for feedback — never `alert()`.

## Shared sample data — use EXACTLY this (same numbers across all options)

Today: **Tuesday, 10 June 2026**. Active: **21 projects across 9 clients**.
Health: On track **14** · Needs attention **5** · Overdue **2** ·
Burned this month **642h** · On-time delivery **86%** (32/37) · Avg brief→DFT **4.2d** (18 projects).

### Needs attention (5) — client · project · engagement · status · reason
1. Sasol · Q3 Brand Refresh · retainer · needs_attention · "3 briefs awaiting scope · oldest 6 days"
2. Woolworths · Loyalty App Launch · fixed · overdue · "DFT 6 days past due"
3. Discovery · Vitality Always-On · retainer · needs_attention · "burn 92% · 2 weeks left in cycle"
4. Nando's · Winter Menu Push · project · overdue · "milestone slipped twice"
5. Capitec · Always-On Social · retainer · needs_attention · "no activity in 9 days"

### Recent projects (5) — client · project · engagement · status · reason
1. Takealot · Black Friday Creative · project · on_track · "DFT approved today"
2. MTN · 5G Awareness · retainer · on_track · "brief scoped 2h ago"
3. Standard Bank · Wealth Microsite · fixed · on_track · "quote accepted yesterday"
4. Clicks · Health Content Hub · retainer · on_track · "12 tasks completed this week"
5. Tiger Brands · Packaging Refresh · project · on_track · "kickoff Monday"

### Client margin — rolling 30 days — client · revenue · cost · margin% · target35% · rag
- Takealot · R 510 000 · R 306 000 · 40.0% · +5.0pp · green
- Sasol · R 388 500 · R 233 100 · 40.0% · +5.0pp · green
- Discovery · R 412 000 · R 286 000 · 30.6% · −4.4pp · amber
- MTN · R 264 000 · R 171 600 · 35.0% · 0.0pp · green
- Capitec · R 198 000 · R 148 500 · 25.0% · −10.0pp · red
- Woolworths · R 295 000 · R 224 200 · 24.0% · −11.0pp · red

### Project tree (clients → active projects, for the sidebar)
- Sasol — Q3 Brand Refresh (attn), Retail POS Toolkit (on_track)
- Woolworths — Loyalty App Launch (overdue), Festive Catalogue (on_track)
- Discovery — Vitality Always-On (attn), Health Rewards Email (on_track)
- Nando's — Winter Menu Push (overdue), Peri Social (on_track)
- Capitec — Always-On Social (attn)
- Takealot — Black Friday Creative (on_track), Marketplace SEO (on_track)
- MTN — 5G Awareness (on_track)
- Standard Bank — Wealth Microsite (on_track)
- Clicks — Health Content Hub (on_track)
- Tiger Brands — Packaging Refresh (on_track)
(That's 17 visible; "21 active" — a few more exist off-sample. Fine.)

Engagement labels: `retainer` / `fixed` / `project`. Currency: `R 510 000` (space
thousands separator, no decimals). Numbers use `font-variant-numeric: tabular-nums`.

## Visual language — match the product (Material 3, purple brand)

CSS variables available (already defined at :root — DO NOT redefine):
--primary:#7C3AED; --on-primary:#fff; --primary-container:#EDE9FE; --on-primary-container:#4C1D95;
--surface:#fff; --on-surface:#0A0A0B; --on-surface-variant:#5B5273;
--surface-container-low:#FBFAFF; --surface-container:#F6F4FF; --surface-container-high:#EDE9FE; --surface-container-highest:#E4DEFC;
--outline:#C4B5FD; --outline-variant:#EDE9FE;
--error:#DC2626; --on-error:#fff; --error-container:#FEE2E2; --on-error-container:#991B1B;
--tertiary:#0891B2; --tertiary-container:#CFFAFE; --on-tertiary-container:#164E63;
--amber:#F59E0B; --amber-soft:#FEF3C7; --amber-deep:#B45309;
--green:#22C55E; --green-soft:#F0FDF4; --green-deep:#15803D;
--gradient-brand: linear-gradient(135deg,#7C3AED 0%,#A855F7 50%,#EC4899 100%);

Status colors: on_track → tertiary (teal); needs_attention → amber; overdue → error (red).
Fonts: `'Inter',system-ui,sans-serif` body; `'JetBrains Mono',monospace` for numbers/codes.
Aesthetic: calm, light, lots of white, hairline `var(--outline-variant)` borders,
radius 10–16px, elevation only on cards/overlays (`0 1px 2px rgba(0,0,0,.04)` resting,
`0 8px 24px rgba(76,29,149,.12)` on hover/overlay). The brand gradient is a thin
accent (top hairline, active states) — never a big fill. The point is to ADD focus
and hierarchy, not noise.

Render the option inside the `.frame` as a **complete app viewport**, min-height
~640px, with the left navigation context present (icon rail + project tree, or your
restructured equivalent). Differentiation lives in how the main pane is organised.

## Output contract — STRICT

Write your fragment to the file path you were given. Structure exactly:

```html
<article class="opt" id="opt{N}">
  <div class="opt-head"><span class="opt-num">OPTION {N}</span><h2>{Title}</h2></div>
  <p class="opt-tagline">{One sentence: the core idea.}</p>
  <div class="frame">
    <section class="o{N}-root">
      <style> /* every selector scoped under .o{N}-root, every class/id/keyframe prefixed o{N}- */ </style>
      …your mockup markup (the full app viewport)…
    </section>
  </div>
  <div class="opt-notes">
    <div><h3>Why it's better</h3><p>…</p></div>
    <div><h3>Trade-offs</h3><p>…</p></div>
  </div>
  <script>(function(){ /* all ids/queries scoped within #opt{N} only */ })();</script>
</article>
```

`.opt`, `.opt-head`, `.opt-num`, `.opt-tagline`, `.frame`, `.opt-notes` are provided
by the parent page — use them, don't restyle them. EVERYTHING else you create MUST be
prefixed `o{N}-` (classes, ids, keyframes) and CSS scoped under `.o{N}-root` to avoid
collisions with sibling options. No external deps, no images, no `alert()`. Inline SVG
for icons is fine. Keep the fragment under ~680 lines. Mentally run your JS — it runs
as-is in the assembled page, so a stray global selector or duplicate id breaks siblings.
