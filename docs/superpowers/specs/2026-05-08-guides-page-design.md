# Guides Page — Design Spec
**Date:** 2026-05-08  
**Status:** Approved

---

## Overview

Add a top-level **Guides** page (`/guides`) to cc-service-calculator that documents every feature in the tool — both page-level features and non-page functionality (edge functions, AI flows, integrations). Modelled on the Granite `FeatureGuides` component structure (deck picker + expandable step cards with Why / Prerequisites / Playbook / Actions).

---

## Goals

- Every team member can self-serve answers about how the tool works.
- New team members can follow the Intake → Configuration flow top-to-bottom as onboarding.
- Each guide includes a direct action button linking to the relevant page.

---

## Architecture

### New files

| File | Purpose |
|---|---|
| `src/data/guides.ts` | All guide content as typed data (`Deck[]`) |
| `src/pages/GuidesPage.tsx` | Pure rendering component — reads guides.ts, renders UI |

### Changed files

| File | Change |
|---|---|
| `src/App.tsx` | Add `/guides` route → `<GuidesPage />` |
| `src/components/Layout.tsx` (sidebar) | Add "Guides" nav item above Settings |

### Data model (`src/data/guides.ts`)

```ts
export type StepAction = {
  label: string
  href: string
}

export type Step = {
  key: string
  title: string
  subtitle: string        // one-liner shown in collapsed card
  icon: string            // lucide-react icon name
  gradient: [string, string]  // two hex colours for badge + callout
  estMinutes: number
  whyItMatters: string
  prerequisites: string[]
  playbook: string[]
  actions: StepAction[]
}

export type Deck = {
  key: string
  label: string
  icon: string            // lucide-react icon name (e.g. 'Inbox', 'Search', 'DollarSign')
  steps: Step[]
}

export const decks: Deck[]
```

---

## UI / Rendering (`src/pages/GuidesPage.tsx`)

### Layout

Two-column layout inside the existing sidebar shell:

- **Left column (180 px, sticky):** Deck picker — one button per deck. Active deck highlighted with `bg-primary/10 text-primary font-semibold`. Inactive: `text-muted-foreground hover:bg-accent`.
- **Right column (flex-1):** Numbered step cards. Each card is a shadcn `Collapsible`. One card can be open at a time.

### Collapsed card

- Gradient badge (number), title, subtitle, estimated read time, chevron.

### Expanded card

1. **"Why This Matters" callout** — left border using gradient colour, `bg-gradient-to-r` from the step's two colours at 10% opacity, lightbulb icon, body text.
2. **Prerequisites** — `CheckCircle` icon header, `<ul>` list.
3. **Best-Practice Playbook** — `FileText` icon header, `<ol>` list.
4. **Action buttons** — `<Button>` with gradient background, `useNavigate()` for internal links.

### Tailwind / token conventions

- Gradient badge: inline `style={{ background: \`linear-gradient(135deg, ${step.gradient[0]}, ${step.gradient[1]})\` }}`
- Callout background: inline style for gradient tint, border-left 3px solid first gradient colour
- Typography: `text-sm`, `text-xs`, `font-semibold`, `text-muted-foreground` per app convention
- Card border: `border border-border rounded-lg` collapsed; active `border-primary` when open
- Spacing: `p-4` cards, `gap-2` list, `gap-3` expanded sections

---

## Content Plan

### Deck 1 — Intake
*Covers how work enters the system.*

| # | Title | Subtitle | Est |
|---|---|---|---|
| 1 | Inbox | The hub for all incoming briefs — your work queue. | 4 min |
| 2 | New Brief (manual) | Create a brief by hand when no email relay is set up. | 3 min |
| 3 | Gmail Relay | Pipe labelled Gmail threads straight into the Inbox automatically. | 5 min |
| 4 | Brief Status Lifecycle | How a brief moves from New → Triaged → Scoped → Quoted → Accepted. | 4 min |
| 5 | File Attachments | Attach supporting files to a brief for the scoper to reference. | 3 min |

### Deck 2 — Scoping
*Covers turning raw brief text into a locked scope.*

| # | Title | Subtitle | Est |
|---|---|---|---|
| 1 | Scope Editor | The four-panel markdown editor: enhanced prose, in-scope, out-of-scope, open questions. | 5 min |
| 2 | AI Scope Drafting | How the AI auto-drafts your scope from raw brief text — and how to re-draft with nudges. | 5 min |
| 3 | Open Questions | Track clarification items that need client answers before quoting. | 3 min |
| 4 | Locking Scope | When to lock, what it prevents, and how it advances to the quote builder. | 3 min |

### Deck 3 — Quoting
*Covers building and finalising a quote.*

| # | Title | Subtitle | Est |
|---|---|---|---|
| 1 | Project Builder | The main quoting interface — services, totals, margin, and the SOW. | 6 min |
| 2 | Service Picker | Adding services to a quote and understanding bundle vs checklist behaviour. | 4 min |
| 3 | Line-Item Editing | Overriding qty, allocation %, and hours per line; adding notes. | 4 min |
| 4 | AI Service Suggestions | Let Claude propose which services to include based on the locked scope. | 4 min |
| 5 | SOW Editor | Draft and edit the HTML statement of work; use AI to generate a first draft. | 5 min |
| 6 | Recurrence | Set per-service or project-wide recurring schedules for retainer work. | 4 min |

### Deck 4 — Delivery
*Covers everything that happens after a quote is finalised.*

| # | Title | Subtitle | Est |
|---|---|---|---|
| 1 | Quote Detail & PDF | Review the finalised quote and download a client-ready PDF. | 3 min |
| 2 | Sending a Quote | Compose the covering email and send via your default email client. | 3 min |
| 3 | Accepting a Quote | Mark a quote accepted and trigger automatic ClickUp task creation. | 4 min |
| 4 | Quote Lifecycle | Draft → Sent → Accepted / Rejected / Revised — what each status means. | 4 min |

### Deck 5 — Projects
*Covers tracking delivery after acceptance.*

| # | Title | Subtitle | Est |
|---|---|---|---|
| 1 | Projects List | See all in-progress briefs and active projects in one view. | 3 min |
| 2 | Project Detail | Planned vs actual hours, metadata, and the project code badge. | 4 min |
| 3 | Burn Chart | Visualise actual vs planned hours by department as work progresses. | 4 min |
| 4 | ClickUp Actuals Sync | Pull completed task hours back from ClickUp into the burn chart. | 4 min |
| 5 | Recurring Tasks | How the calculator recreates ClickUp task hierarchies on a schedule. | 5 min |

### Deck 6 — Configuration
*Covers the setup that makes everything else work.*

| # | Title | Subtitle | Est |
|---|---|---|---|
| 1 | Services & Pricing | Create and edit services with fixed, hourly, or percentage pricing models. | 5 min |
| 2 | Bundles & Checklists | Compose child services into parent bundles; save checklist allocations. | 4 min |
| 3 | Process Steps & AI | Build service process flows step by step — or let Claude generate them. | 5 min |
| 4 | Allocation Rules | Department-percentage templates that auto-split hours across the team. | 4 min |
| 5 | Departments & Rates | Define your teams, their sell rates, and cost rates per hour. | 4 min |
| 6 | Team Members | Add team members, assign departments, set skills and cost rates. | 3 min |
| 7 | Clients | Manage client records and link them to ClickUp folders. | 3 min |
| 8 | Settings & Integrations | Configure ClickUp, Anthropic model selection, and Gmail relay tokens. | 5 min |

**Total: 32 guides across 6 decks.**

---

## Colour palette (gradients per deck)

| Deck | Gradient |
|---|---|
| Intake | `#3b82f6` → `#06b6d4` (blue → cyan) |
| Scoping | `#8b5cf6` → `#6366f1` (violet → indigo) |
| Quoting | `#f59e0b` → `#f97316` (amber → orange) |
| Delivery | `#10b981` → `#3b82f6` (emerald → blue) |
| Projects | `#ec4899` → `#8b5cf6` (pink → violet) |
| Configuration | `#6b7280` → `#374151` (slate → dark) |

Individual steps within each deck get a unique colour variation cycling through the deck's range.

---

## Routing

```tsx
// App.tsx
<Route path="/guides" element={<GuidesPage />} />
```

Route is protected by `<RequireAuth>` like all other internal routes.

---

## Sidebar

Add nav item in `Layout.tsx` (or equivalent):

```tsx
{ path: '/guides', label: 'Guides', icon: BookOpen }
```

Positioned between Team and Settings in the nav list.

---

## Out of scope

- Search across guides.
- Marking guides as "read" / progress tracking.
- Editing guide content from the UI.
- Per-user guide visibility.
