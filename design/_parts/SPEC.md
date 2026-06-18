# Services list redesign — shared spec for option builders

You are building ONE design option as a self-contained HTML fragment that will be
concatenated into `design/services-list-options.html` alongside other options.
The page already has Inter + JetBrains Mono loaded and the CSS variables below
defined at `:root`. Do NOT emit `<html>/<head>/<body>` — emit ONE `<article>` only.

## Context — what's wrong today

The Services page is a 139-row spreadsheet-style table:
`Group | Code | Name | Rule | Price | <one column per department × 8> | Total | Actions`.

It feels chaotic because:
1. The **Group column** holds pill badges with long names ("Software / Spend /
   Pass-Through / Non-Delivery", "Video / 3D / Motion Production") that wrap to
   3–5 lines, making row heights wildly uneven (one row is 40px, the next 130px).
2. The **Rule column** shows rule names that are usually the *same taxonomy* as the
   group ("Video / 3D / Motion Production") truncated mid-word ("o / 3D / Motio…").
   Reads as duplicate noise.
3. **8 department hour columns**, where ~70% of services have `0` in every cell —
   a wall of italic grey zeros.
4. The table scrolls horizontally; price/total live far from the name.

## Functionality that MUST survive (visible or one interaction away)

- Header: "Services" title, count line ("139 services" / "12 of 139"), hint text,
  **+ New service** button.
- Toolbar: search by name/code (works live in the mockup), Rule select,
  Status select (Active default), Group multi-select, "Clear filters" appears when active.
- Per service: group (primary department), monospace code, name (links to detail),
  `bundle · N` badge for compound services, `checklist` badge, rule name
  (with "(fallback)" suffix when a checklist overrides it; "custom" badge when no rule;
  "—" when derived from bundle children), price in ZAR or `10%` for percentage pricing.
- **Inline hours editing per department** (step 0.25): editing marks the row dirty
  (amber tint), shows live total hours + % of price, and Save / Cancel buttons.
  Saving creates a checklist override (toast: "Saved as checklist for {name}").
- Checklist rows and bundle rows are **read-only** in the grid — their hours link
  to the detail page; checklist rows get a **Revert** action (confirm → falls back to rule).
- Status badge (active green / draft grey / archived grey) when row is clean.
- Inherited (rule-derived, untouched) hours display *italic/grey*; overridden hours medium weight.

In the mockup, make at minimum: live search filtering, the edit→dirty→Save/Cancel
flow on at least the editable rows, and your option's signature interaction
(expand, popover, panel select, …) actually work in vanilla JS. Selects can be
non-functional chrome. `confirm()`/toasts can be simulated with a small inline
snackbar div — do not use `alert()`.

## Shared sample data (use exactly this, in this order)

Departments (8) — name, short label, rate R/hr:
1. Project Management · PM · 850
2. Strategy · Strat · 1100
3. Development · Dev · 1075
4. SEO · SEO · 650
5. Paid Media · Media · 700
6. Creative Production · Creative · 750
7. Social Media · Social · 600
8. Video / 3D / Motion Production · Video/3D · 900

Services (16). Format: code · name · rule/genre · price · hours{dept:h} · flags
1.  046 · 3D Configurator · Video / 3D / Motion Production · R 16 500 · {PM:0.25, Video/3D:12} · CHECKLIST (read-only, Revert; rule shows "(fallback)")
2.  3D0102 · 3D Rendering — High Res Still · Video / 3D / Motion Production · R 280 · {Video/3D:0.25} · editable
3.  3D0101 · 3D Rendering — High Res Video · Video / 3D / Motion Production · R 660 · {} (all zero) · editable
4.  3D002 · 4K High Res Rendering · Video / 3D / Motion Production · R 1 200 · {} · editable
5.  013 · Ad Account Creation · Paid Media · R 1 980 · {Media:2, PM:0.5} · editable
6.  10111 · Annual Website Hosting · Software / Spend / Pass-Through / Non-Delivery · R 1 960 · {} · editable, group=Uncategorized
7.  026 · SEO Competitor Audit · SEO · R 27 500 · {SEO:16, Strat:4, PM:2} · editable
8.  002 · Full Website Build Page — Development, No SEO · Development · R 5 500 · {Dev:4, Creative:1, PM:0.5} · editable
9.  038 · Social Media Plan (3 month) · Social Media · R 13 200 · {Social:12, Strat:6, PM:1.5} · editable
10. 044 · Campaign Strategy · Creative Production · R 7 200 · {Strat:5.5, PM:0.75} · editable
11. 100 · Paid Media · Paid Media · 10% (percentage pricing, price col shows "10%") · {Media:1} · editable
12. 1003 · Campaign Creation & Complete Creative Solutions · Paid Media · R 65 100 · {Media:8, Creative:14, Strat:4, PM:3} · BUNDLE (6 children, read-only, rule col "—" derived)
13. 007 · Emailer — Creative only · Creative Production · R 3 300 · {Creative:3, PM:0.25} · editable
14. 062 · SEO:Services · (no rule → "custom" badge) · R 1 075 · {SEO:1} · editable
15. 031 · SEO Reporting · SEO · R 495 · {SEO:0.5} · editable, status=draft
16. 10 · Chatbot Set Up · Development · R 1 150 · {Dev:1} · editable

Group (primary department) = dept with most hours; zero-hour services → "Uncategorized".
Pretend the full list is 139 services; your mockup shows these 16 (count line may read
"16 of 139 shown — sample" or similar).

## Visual language — match the product

CSS variables available (already defined; do not redefine at :root):
--primary:#7C3AED; --on-primary:#fff; --primary-container:#EDE9FE; --on-primary-container:#4C1D95;
--surface:#fff; --on-surface:#0A0A0B; --on-surface-variant:#5B5273;
--surface-container:#F6F4FF; --surface-container-high:#EDE9FE; --surface-container-highest:#E4DEFC;
--outline:#C4B5FD; --outline-variant:#EDE9FE;
--error:#DC2626; --error-container:#FEE2E2; --on-error-container:#991B1B;
--tertiary:#0891B2; --tertiary-container:#CFFAFE; --on-tertiary-container:#164E63;
--amber:#F59E0B; --amber-soft:#FEF3C7; --amber-deep:#B45309;
--green:#22C55E; --green-soft:#F0FDF4; --green-deep:#15803D;

Fonts: `'Inter',system-ui,sans-serif` body; `'JetBrains Mono',monospace` for codes
and tabular figures (`font-variant-numeric: tabular-nums` on all numbers).
Currency format: `R 16 500` (space thousands separator, no decimals).
Aesthetic: calm, light, lots of white, hairline `var(--outline-variant)` borders,
radius 8–12px, elevation only on overlays. The whole point is LESS visual noise —
zeros must never read as a wall; long taxonomy names must never wrap badges.
Uniform row heights. This is a refinement exercise, not a maximalist one.

## Output contract — STRICT

Write your fragment to the file you were given. Structure:

```html
<article class="opt" id="opt{N}">
  <div class="opt-head"><span class="opt-num">OPTION {N}</span><h2>{Title}</h2></div>
  <p class="opt-tagline">{One sentence: the core idea.}</p>
  <div class="frame">
    <section class="o{N}-root">
      <style> /* every selector scoped under .o{N}-root, every class prefixed o{N}- */ </style>
      …your mockup markup…
    </section>
  </div>
  <div class="opt-notes">
    <div><h3>Why it's calmer</h3><p>…</p></div>
    <div><h3>Trade-offs</h3><p>…</p></div>
  </div>
  <script>(function(){ /* all ids prefixed o{N}-, query inside #opt{N} only */ })();</script>
</article>
```

`.opt`, `.opt-head`, `.opt-num`, `.opt-tagline`, `.frame`, `.opt-notes` are provided
by the parent page — use them, don't restyle them. EVERYTHING else you create must be
prefixed `o{N}-` (classes, ids, keyframes) to avoid collisions with sibling options.
No external dependencies, no images, no alert(). Inline SVG for icons is fine
(search, plus, chevron, rotate-ccw). Keep the fragment under ~700 lines.
Test your JS mentally — it runs as-is in the assembled page.
