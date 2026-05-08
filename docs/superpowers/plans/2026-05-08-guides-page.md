# Guides Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/guides` page to cc-service-calculator that documents every feature in the tool using a deck-picker + expandable-step-card structure modelled on the Granite `FeatureGuides` component.

**Architecture:** Two new files — `src/data/guides.ts` (all content as typed data) and `src/pages/GuidesPage.tsx` (pure rendering component) — plus a new route and sidebar nav item. The data file is the source of truth; the page just renders it.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, shadcn/ui, lucide-react, React Router v6, Vitest + React Testing Library (already installed).

---

## File Map

| Status | Path | Responsibility |
|---|---|---|
| Create | `src/data/guides.ts` | All guide content — types + 32 steps across 6 decks |
| Create | `src/pages/GuidesPage.tsx` | Deck picker + collapsible step cards UI |
| Create | `src/data/guides.test.ts` | Data shape validation |
| Create | `src/pages/GuidesPage.test.tsx` | Interactive behaviour (deck switch, expand/collapse) |
| Modify | `src/App.tsx` | Add lazy-loaded `/guides` route |
| Modify | `src/components/AppShell.tsx` | Add Guides nav item between Team and Settings |

---

## Task 1 — Types, data skeleton, and data tests

**Files:**
- Create: `src/data/guides.ts`
- Create: `src/data/guides.test.ts`

- [ ] **Step 1: Create `src/data/guides.ts` with types and empty array**

```ts
// src/data/guides.ts

export type StepAction = {
  label: string
  href: string
}

export type Step = {
  key: string
  title: string
  subtitle: string
  icon: string             // lucide-react icon name
  gradient: [string, string]  // two hex colours: badge bg + callout tint
  estMinutes: number
  whyItMatters: string
  prerequisites: string[]
  playbook: string[]
  actions: StepAction[]
}

export type Deck = {
  key: string
  label: string
  icon: string             // lucide-react icon name for deck picker tab
  steps: Step[]
}

export const decks: Deck[] = []
```

- [ ] **Step 2: Write failing data validation tests**

```ts
// src/data/guides.test.ts
import { describe, it, expect } from 'vitest'
import { decks } from './guides'

describe('guides data', () => {
  it('has all 6 decks', () => {
    expect(decks).toHaveLength(6)
  })

  it('every deck has at least one step', () => {
    decks.forEach((deck) => {
      expect(deck.steps.length).toBeGreaterThan(0)
    })
  })

  it('every step has required fields populated', () => {
    decks.forEach((deck) => {
      deck.steps.forEach((step) => {
        expect(step.key, `${deck.key}/${step.key} missing key`).toBeTruthy()
        expect(step.title, `${step.key} missing title`).toBeTruthy()
        expect(step.subtitle, `${step.key} missing subtitle`).toBeTruthy()
        expect(step.whyItMatters, `${step.key} missing whyItMatters`).toBeTruthy()
        expect(step.prerequisites.length, `${step.key} has no prerequisites`).toBeGreaterThan(0)
        expect(step.playbook.length, `${step.key} has no playbook`).toBeGreaterThanOrEqual(4)
        expect(step.gradient, `${step.key} bad gradient`).toHaveLength(2)
        expect(step.estMinutes, `${step.key} missing estMinutes`).toBeGreaterThan(0)
      })
    })
  })

  it('all action hrefs are internal paths starting with /', () => {
    decks.forEach((deck) => {
      deck.steps.forEach((step) => {
        step.actions.forEach((action) => {
          expect(action.href.startsWith('/'), `${step.key} action "${action.label}" href "${action.href}" is not internal`).toBe(true)
        })
      })
    })
  })
})
```

- [ ] **Step 3: Run tests — expect failures (decks is empty)**

```bash
npm test -- src/data/guides.test.ts
```

Expected output: `FAIL` — `"has all 6 decks"` fails with `expected 0 to equal 6`.

- [ ] **Step 4: Commit skeleton**

```bash
git add src/data/guides.ts src/data/guides.test.ts
git commit -m "feat(guides): types + empty deck array + data validation tests"
```

---

## Task 2 — Intake and Scoping deck content

**Files:**
- Modify: `src/data/guides.ts` (replace empty array with Intake + Scoping decks)

- [ ] **Step 1: Replace the empty `decks` array with Intake and Scoping data**

```ts
// src/data/guides.ts  — replace `export const decks: Deck[] = []` with:

export const decks: Deck[] = [
  {
    key: 'intake',
    label: 'Intake',
    icon: 'Inbox',
    steps: [
      {
        key: 'inbox',
        title: 'Inbox',
        subtitle: 'The hub for all incoming briefs — your work queue.',
        icon: 'Inbox',
        gradient: ['#3b82f6', '#06b6d4'],
        estMinutes: 4,
        whyItMatters:
          'All client work arrives here — Gmail-relayed threads and manually created briefs live in one place. Status columns show what is waiting versus in progress at a glance, so nothing slips through without action.',
        prerequisites: [
          'Signed in to the calculator',
          'At least one brief exists (via Gmail relay or manual entry)',
        ],
        playbook: [
          'Status columns show where each brief is: New → Awaiting client → In progress → Closed.',
          'Click "Continue" on any brief to pick up where you left off — the app knows which step it is on.',
          'Use "New brief" only for briefs that did not arrive via Gmail relay.',
          'Briefs do not auto-archive — move to Closed once work is delivered or rejected.',
          'The sender email shown is the From address from the original Gmail thread.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'new-brief',
        title: 'New Brief (manual)',
        subtitle: 'Create a brief by hand when no email relay is set up.',
        icon: 'FilePlus',
        gradient: ['#6366f1', '#3b82f6'],
        estMinutes: 3,
        whyItMatters:
          'Not every brief arrives via email. Walk-in requests, phone calls, and Slack messages all need a paper trail. Manual entry ensures every piece of work is tracked from the start.',
        prerequisites: [
          'Client record exists — create one in Clients first',
          'Signed in to the calculator',
        ],
        playbook: [
          "Fill the subject line with the client's own words — it becomes the quote title.",
          'Paste the raw brief text into the body — the AI scoper reads it verbatim.',
          'Attach any supporting files before saving — attachments cannot be added after creation.',
          'Set the client correctly; changing it later requires a database edit.',
          'Leave sender email blank if the brief did not arrive via email — it is optional.',
        ],
        actions: [{ label: 'New Brief', href: '/briefs/new' }],
      },
      {
        key: 'gmail-relay',
        title: 'Gmail Relay',
        subtitle: 'Pipe labelled Gmail threads straight into the Inbox automatically.',
        icon: 'Mail',
        gradient: ['#0ea5e9', '#10b981'],
        estMinutes: 5,
        whyItMatters:
          'Eliminating the copy-paste step from Gmail to the calculator saves minutes per brief and removes human error. Label a thread and the brief is created automatically with attachments, ready to scope.',
        prerequisites: [
          'Gmail account with Google Apps Script access',
          'Relay token generated in Settings → Gmail',
        ],
        playbook: [
          'Generate a relay token in Settings → Gmail first — each user has their own token.',
          'Create a Google Apps Script in your Gmail account using the setup instructions on the Gmail settings page.',
          'Set the three script properties: RELAY_URL, USER_EMAIL, and RELAY_TOKEN.',
          'Apply the label →Inbox/Push to any Gmail thread to create a new brief.',
          'Use →Inbox/Push-Sent on sent threads to capture outbound briefs too.',
          'Attachments are automatically uploaded to Supabase Storage — no separate upload step.',
        ],
        actions: [{ label: 'Configure Gmail Relay', href: '/settings/gmail' }],
      },
      {
        key: 'brief-status',
        title: 'Brief Status Lifecycle',
        subtitle: 'How a brief moves from New → Triaged → Scoped → Quoted → Accepted.',
        icon: 'GitBranch',
        gradient: ['#3b82f6', '#8b5cf6'],
        estMinutes: 4,
        whyItMatters:
          'Status drives which action buttons appear on each brief row and determines what the team should do next. Understanding the pipeline keeps everyone aligned on what needs attention.',
        prerequisites: ['None — no setup required'],
        playbook: [
          'New — brief just arrived, no action taken yet.',
          'Triaged — someone opened it and it is being reviewed. Set automatically when you start scoping.',
          'Scoped — scope is locked, ready for the quote builder.',
          'Quoted — quote has been finalised and sent to the client.',
          'Accepted — client confirmed; ClickUp tasks have been created.',
          'Archived — work delivered or rejected; brief removed from the active view.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'file-attachments',
        title: 'File Attachments',
        subtitle: 'Attach supporting files to a brief for the scoper to reference.',
        icon: 'Paperclip',
        gradient: ['#06b6d4', '#0284c7'],
        estMinutes: 3,
        whyItMatters:
          'Briefs often come with designs, spreadsheets, or reference documents. Attaching them at intake means the scoper has everything needed without hunting through email threads.',
        prerequisites: [
          'Brief not yet saved — attachments are set at creation time only',
        ],
        playbook: [
          'Upload files using the attachment panel on the New Brief form before clicking Save.',
          'Files are stored in Supabase Storage — download links appear on the brief detail.',
          'Gmail relay automatically attaches any inline or attached files from the original thread.',
          'Supabase Storage has a 50 MB per-file limit — split large files if needed.',
          'Attachments cannot be added to an existing brief — if needed, create a new brief or note the file URL in the scope body.',
        ],
        actions: [{ label: 'New Brief', href: '/briefs/new' }],
      },
    ],
  },
  {
    key: 'scoping',
    label: 'Scoping',
    icon: 'ScanSearch',
    steps: [
      {
        key: 'scope-editor',
        title: 'Scope Editor',
        subtitle: 'The four-panel markdown editor: enhanced prose, in-scope, out-of-scope, open questions.',
        icon: 'FileEdit',
        gradient: ['#8b5cf6', '#6366f1'],
        estMinutes: 5,
        whyItMatters:
          'The scope is the contract between you and the client. Getting it right before quoting prevents scope creep, budget blowouts, and revision requests after delivery.',
        prerequisites: [
          'Brief exists in Inbox',
          'Scope page opened via "Start scope" or "Continue" on the brief row',
        ],
        playbook: [
          'The editor has four panels: Enhanced Prose, In-Scope, Out-of-Scope, and Open Questions.',
          'Enhanced Prose is a narrative summary — use client-facing language, not internal bullet points.',
          'In-Scope and Out-of-Scope use markdown — bullet lists work best for these.',
          'Open Questions is a living list of items needing client clarification before you can quote.',
          'All four panels save on blur — no explicit save button needed.',
          'Only lock scope once Open Questions is empty and the client has confirmed the scope.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'ai-scope-drafting',
        title: 'AI Scope Drafting',
        subtitle: 'How the AI auto-drafts your scope from raw brief text — and how to re-draft with nudges.',
        icon: 'Sparkles',
        gradient: ['#7c3aed', '#a21caf'],
        estMinutes: 5,
        whyItMatters:
          'Staring at a blank scope editor for a three-line brief is painful. The AI reads the raw brief and produces a first-draft scope in seconds — you edit instead of writing from scratch.',
        prerequisites: [
          'Brief has body text',
          'Anthropic integration enabled in Settings',
        ],
        playbook: [
          'The scope is auto-drafted the first time you open the scope page for a brief.',
          'The ai_drafted flag is set so the team knows the content has not been human-verified yet.',
          'Always read the AI draft before locking — it can propose scope items that are irrelevant.',
          'To re-draft, click "Re-draft" and optionally add a nudge (e.g. "focus on the SEO work only").',
          'The AI uses the Anthropic model configured in Settings — switch to Opus 4.7 for complex briefs.',
          'AI drafts consume API credits — avoid re-drafting repeatedly for minor tweaks.',
        ],
        actions: [{ label: 'Settings', href: '/settings' }],
      },
      {
        key: 'open-questions',
        title: 'Open Questions',
        subtitle: 'Track clarification items that need client answers before quoting.',
        icon: 'HelpCircle',
        gradient: ['#6366f1', '#4f46e5'],
        estMinutes: 3,
        whyItMatters:
          'Unanswered questions at quote time become change requests after the client signs. Capturing them in the scope editor ensures nothing slips through and the client has formally agreed to scope boundaries.',
        prerequisites: ['Scope page open for the brief'],
        playbook: [
          'Write each open question as a single bullet in the Open Questions panel.',
          "Send the questions to the client before locking scope — don't lock with unresolved items.",
          'Once each question is answered, delete it from the list and update the relevant scope section.',
          'An empty Open Questions panel is the signal that scope is ready to lock.',
          "If the client answers via email, paste the answer into the enhanced prose — don't just delete the question.",
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'locking-scope',
        title: 'Locking Scope',
        subtitle: 'When to lock, what it prevents, and how it advances to the quote builder.',
        icon: 'Lock',
        gradient: ['#a855f7', '#7c3aed'],
        estMinutes: 3,
        whyItMatters:
          "Locking prevents accidental changes to scope the client has already reviewed. It is the formal handoff from discovery to quoting, and records who locked it and when for the audit trail.",
        prerequisites: [
          'All four scope panels completed',
          'Open Questions panel is empty',
          'Client has verbally or in writing confirmed the scope',
        ],
        playbook: [
          'Click "Lock scope" at the bottom of the scope page.',
          'The lock records who locked it and when — visible in the brief audit trail.',
          'Locking advances the brief status to "Scoped" and enables the "Build quote" button.',
          'You can unlock scope if the client requests changes — this resets status back to Triaged.',
          'Avoid locking just to advance the workflow — locking should mean the client has signed off.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
    ],
  },
  // Quoting, Delivery, Projects, Configuration decks added in subsequent tasks
]
```

- [ ] **Step 2: Run tests — 1 still fails, 3 pass**

```bash
npm test -- src/data/guides.test.ts
```

Expected: `"has all 6 decks"` still fails (only 2 decks). All other tests pass for the 2 decks present.

- [ ] **Step 3: Commit**

```bash
git add src/data/guides.ts
git commit -m "feat(guides): add Intake and Scoping deck content"
```

---

## Task 3 — Quoting and Delivery deck content

**Files:**
- Modify: `src/data/guides.ts` (replace the `// Quoting, Delivery…` comment with the two decks)

- [ ] **Step 1: Replace the trailing comment with Quoting and Delivery decks**

Replace the line `// Quoting, Delivery, Projects, Configuration decks added in subsequent tasks` with:

```ts
  {
    key: 'quoting',
    label: 'Quoting',
    icon: 'DollarSign',
    steps: [
      {
        key: 'project-builder',
        title: 'Project Builder',
        subtitle: 'The main quoting interface — services, totals, margin, and the SOW.',
        icon: 'Hammer',
        gradient: ['#f59e0b', '#f97316'],
        estMinutes: 6,
        whyItMatters:
          'The builder is where scope turns into money. It assembles service line items, calculates department hours, applies margin, and generates the statement of work — all in one place before anything goes to the client.',
        prerequisites: [
          'Scope is locked',
          'At least one active service exists in the catalogue',
        ],
        playbook: [
          'Open the builder via "Build quote" on the scoped brief row.',
          'The left sidebar shows the locked scope — use it as a reference while picking services.',
          'The centre pane is where you add and configure service line items.',
          'The footer shows running totals, margin slider, and discount controls.',
          'Click "Finalise quote" when all lines are confirmed — this locks the quote.',
          'You can create multiple quote versions per brief — use "Revise" on an existing quote.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'service-picker',
        title: 'Service Picker',
        subtitle: 'Adding services to a quote and understanding bundle vs checklist behaviour.',
        icon: 'Search',
        gradient: ['#f97316', '#ef4444'],
        estMinutes: 4,
        whyItMatters:
          'The picker is the only way to add services to a quote. It filters out already-added services and exposes bundle contents upfront so you do not accidentally double-count child services.',
        prerequisites: ['At least one active service exists in the catalogue'],
        playbook: [
          'Click "Add service" in the builder to open the picker combobox.',
          'Type to filter by service name or code — partial matches work.',
          'Bundle services show a "bundle" badge — adding them automatically adds all child services.',
          'Checklist services show a "checklist" badge — they use a saved or default department allocation.',
          'Already-added services are excluded from the picker automatically.',
          'Add services one at a time — bulk add is not supported.',
        ],
        actions: [{ label: 'Services', href: '/services' }],
      },
      {
        key: 'line-item-editing',
        title: 'Line-Item Editing',
        subtitle: 'Overriding qty, allocation %, and hours per line; adding notes.',
        icon: 'SlidersHorizontal',
        gradient: ['#eab308', '#f59e0b'],
        estMinutes: 4,
        whyItMatters:
          'Every project is different. Line-item overrides let you adjust hours, allocation, and quantity per brief without touching the master service definition — keeping the catalogue clean while quoting flexibly.',
        prerequisites: ['Service added to the quote'],
        playbook: [
          'Click the edit icon on a line item to open the inline editor.',
          'Qty multiplies the base price and hours — use it for "3× landing pages".',
          'Allocation override replaces the service rule for this quote only.',
          'Hours override sets a fixed hours figure, ignoring the allocation-derived amount.',
          'Notes field is internal only — use it for brief-specific context for the team.',
          'Changes save inline — no separate save button.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'ai-suggestions',
        title: 'AI Service Suggestions',
        subtitle: 'Let Claude propose which services to include based on the locked scope.',
        icon: 'Wand2',
        gradient: ['#f97316', '#ec4899'],
        estMinutes: 4,
        whyItMatters:
          'Missed services mean missed revenue. Claude reads the locked scope and your current line items, then proposes additions you have not added yet based on what the brief is actually asking for.',
        prerequisites: [
          'Scope is locked',
          'At least one service exists in the catalogue',
          'Anthropic integration enabled in Settings',
        ],
        playbook: [
          'Click "AI suggest" in the builder toolbar to open the suggestion modal.',
          'The AI reads the locked scope and current line items, then proposes new additions.',
          'Toggle each suggestion on or off — only toggled-on items are added when you confirm.',
          'Review suggestions critically — the AI sometimes proposes services that are out of scope.',
          'Run AI suggestions once per quote — repeated runs cost credits without adding new insight.',
          'After accepting, review and adjust each new line item qty and notes.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'sow-editor',
        title: 'SOW Editor',
        subtitle: 'Draft and edit the HTML statement of work; use AI to generate a first draft.',
        icon: 'FileText',
        gradient: ['#d97706', '#b45309'],
        estMinutes: 5,
        whyItMatters:
          'The statement of work is the document the client receives alongside the quote. Vague SOWs lead to disputes about what was agreed — a clear SOW is your best protection.',
        prerequisites: ['Quote has at least one service line item'],
        playbook: [
          'Open the SOW panel in the builder right sidebar.',
          'Click "Draft SOW" to let Claude generate an HTML statement of work from your line items.',
          'The draft uses service scope definitions and quote metadata — review it carefully.',
          'Edit the HTML directly in the editor if the draft needs refinement.',
          'The SOW is included in the PDF when the quote is finalised.',
          'Remove any internal notes from the SOW before finalising — it is client-facing.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'recurrence',
        title: 'Recurrence',
        subtitle: 'Set per-service or project-wide recurring schedules for retainer work.',
        icon: 'RefreshCw',
        gradient: ['#f59e0b', '#84cc16'],
        estMinutes: 4,
        whyItMatters:
          'Retainer clients should not require manual re-quoting every month. Setting up recurrence at quote time automates ClickUp task creation on a schedule, so delivery stays on track without admin overhead.',
        prerequisites: [
          'Quote has line items',
          'ClickUp integration configured in Settings',
        ],
        playbook: [
          'Use the Recurrence panel in the builder to set the mode: None, Per-service, or Project-wide.',
          'Per-service lets you set a different schedule per line item (e.g. weekly SEO, monthly reporting).',
          'Project-wide applies one schedule to the whole quote — simpler for uniform retainers.',
          'Supported schedules: weekly, bi-weekly, monthly, quarterly.',
          'On acceptance the first ClickUp task set is created immediately; subsequent sets fire on schedule.',
          'Changing recurrence after acceptance requires editing the project record directly.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
    ],
  },
  {
    key: 'delivery',
    label: 'Delivery',
    icon: 'Send',
    steps: [
      {
        key: 'quote-detail',
        title: 'Quote Detail & PDF',
        subtitle: 'Review the finalised quote and download a client-ready PDF.',
        icon: 'FileCheck',
        gradient: ['#10b981', '#3b82f6'],
        estMinutes: 3,
        whyItMatters:
          'The quote detail is the final review before anything goes to the client. The PDF download is how you actually send the quote — it includes the SOW, line items, totals, and the project code.',
        prerequisites: ['Quote has been finalised in the Project Builder'],
        playbook: [
          'Navigate to a quote via the brief row\'s "View quote" button or the Inbox Quoted column.',
          'Review the version number — V1 is the first quote, V2 onwards are revisions.',
          'Click "Download PDF" to generate and download the client-ready quote document.',
          'The PDF includes the SOW, line items, totals, and project code.',
          'Click "Revise" if the quote needs changes — this creates V2 without losing V1.',
          'Mark as Accepted only once the client confirms in writing.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'sending-quote',
        title: 'Sending a Quote',
        subtitle: 'Compose the covering email and send via your default email client.',
        icon: 'SendHorizontal',
        gradient: ['#059669', '#0ea5e9'],
        estMinutes: 3,
        whyItMatters:
          'The send page pre-fills the covering email so you spend thirty seconds reviewing, not five minutes composing. It also keeps brief status in sync so the Inbox always reflects current state.',
        prerequisites: ['Quote is finalised'],
        playbook: [
          'Click "Send quote" on the quote detail page.',
          'The To, Subject, and Body fields are pre-populated from the brief and quote metadata.',
          'Download the PDF first — the email launcher asks you to attach it manually.',
          'Click "Open email + download PDF" to launch your default email client with fields pre-filled.',
          'Click "Mark as sent" after sending — this updates the brief status to Quoted.',
          'The Xero push button is a Phase 2 placeholder and is not functional in V1.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'accepting-quote',
        title: 'Accepting a Quote',
        subtitle: 'Mark a quote accepted and trigger automatic ClickUp task creation.',
        icon: 'CheckCircle2',
        gradient: ['#34d399', '#6366f1'],
        estMinutes: 4,
        whyItMatters:
          'Acceptance is the trigger for ClickUp task creation. Everything downstream — delivery, tracking, and invoicing — depends on this step being done correctly and only once.',
        prerequisites: [
          'Client has confirmed acceptance in writing',
          'ClickUp integration is configured in Settings',
          'Client has a ClickUp folder linked in Clients',
        ],
        playbook: [
          'Click "Mark accepted" on the quote detail page.',
          'This triggers push-to-clickup, which creates the full task hierarchy under the client ClickUp folder.',
          'A project record is created automatically with the project code from the quote.',
          'If the ClickUp push fails, a "Retry" button appears — fix the integration config first.',
          'The brief status moves to Accepted and the brief appears in Projects.',
          'Mark accepted only once — multiple clicks create duplicate ClickUp tasks.',
        ],
        actions: [{ label: 'Settings', href: '/settings' }],
      },
      {
        key: 'quote-lifecycle',
        title: 'Quote Lifecycle',
        subtitle: 'Draft → Sent → Accepted / Rejected / Revised — what each status means.',
        icon: 'GitMerge',
        gradient: ['#0d9488', '#0369a1'],
        estMinutes: 4,
        whyItMatters:
          'Knowing which status means what prevents duplicate sends, missed follow-ups, and overwritten work. Each status unlocks a specific set of actions and nothing else.',
        prerequisites: ['None'],
        playbook: [
          'Draft — quote built but not yet sent. PDF download and Send actions are available.',
          'Sent — email dispatched, waiting for client response. Mark Accepted or Rejected from here.',
          'Accepted — client confirmed; ClickUp tasks created; project tracking begins.',
          'Rejected — client declined. The brief can be re-scoped and a new quote built.',
          'Revised — a newer version exists. The original version is preserved for reference.',
          'Version numbers increment on each revision — V1 is never overwritten.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
    ],
  },
  // Projects, Configuration decks added in Task 4
```

- [ ] **Step 2: Run tests — still 1 fail (only 4 decks now)**

```bash
npm test -- src/data/guides.test.ts
```

Expected: `"has all 6 decks"` fails with `expected 4 to equal 6`. All step-level tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/data/guides.ts
git commit -m "feat(guides): add Quoting and Delivery deck content"
```

---

## Task 4 — Projects and Configuration deck content

**Files:**
- Modify: `src/data/guides.ts` (replace the `// Projects, Configuration…` comment with the two decks)

- [ ] **Step 1: Replace the trailing comment with Projects and Configuration decks, then close the array**

Replace `// Projects, Configuration decks added in Task 4` with:

```ts
  {
    key: 'projects',
    label: 'Projects',
    icon: 'FolderKanban',
    steps: [
      {
        key: 'projects-list',
        title: 'Projects List',
        subtitle: 'See all in-progress briefs and active projects in one view.',
        icon: 'FolderKanban',
        gradient: ['#ec4899', '#8b5cf6'],
        estMinutes: 3,
        whyItMatters:
          'The projects list replaces the need to dig through the Inbox to find what is in flight. One view shows delivery status across all clients at a glance.',
        prerequisites: ['At least one quote has been accepted'],
        playbook: [
          'Navigate to Projects in the sidebar.',
          'In-progress briefs (scoped but not yet accepted) appear at the top.',
          'Active projects (accepted quotes with ClickUp tasks) appear below.',
          'Click any row to open the project detail.',
          'The project code badge is assigned at quote finalisation and links to ClickUp.',
          'Archived projects do not appear in this view.',
        ],
        actions: [{ label: 'Projects', href: '/projects' }],
      },
      {
        key: 'project-detail',
        title: 'Project Detail',
        subtitle: 'Planned vs actual hours, metadata, and the project code badge.',
        icon: 'ClipboardList',
        gradient: ['#f43f5e', '#ec4899'],
        estMinutes: 4,
        whyItMatters:
          "The detail page is the single source of truth for a project's health — planned hours, actual hours, team assignments, and the ClickUp link all in one place.",
        prerequisites: ['Project exists (quote accepted and ClickUp push completed)'],
        playbook: [
          'Check the planned vs actual hours table — it shows per-department breakdowns.',
          'The project code badge can be downloaded as a .cc-project file for Claude Code AI attribution.',
          'Paste the Git remote URL to link this project to a code repository.',
          'Recurrence config (if set) appears here and can be edited post-acceptance.',
          'The ClickUp task table shows all child tasks created during the acceptance push.',
          'Use "Sync now" to pull the latest completed-task hours from ClickUp.',
        ],
        actions: [{ label: 'Projects', href: '/projects' }],
      },
      {
        key: 'burn-chart',
        title: 'Burn Chart',
        subtitle: 'Visualise actual vs planned hours by department as work progresses.',
        icon: 'BarChart3',
        gradient: ['#db2777', '#6366f1'],
        estMinutes: 4,
        whyItMatters:
          'A running total of hours is meaningless without context. The burn chart shows at a glance whether each department is on track, ahead, or over budget — before it becomes a problem.',
        prerequisites: [
          'Project exists',
          'ClickUp actuals have been synced at least once',
        ],
        playbook: [
          'The chart shows one bar per department: planned (lighter fill) vs actual (solid fill).',
          'Bars that exceed planned height mean that department has gone over budget.',
          'Sync actuals via "Sync now" on the project detail page before reviewing.',
          'The chart updates live after a sync — no page refresh needed.',
          'Use the chart in client status calls to show delivery progress against the agreed budget.',
          'If all bars are empty, either no tasks are complete in ClickUp yet or sync has not been run.',
        ],
        actions: [{ label: 'Projects', href: '/projects' }],
      },
      {
        key: 'clickup-sync',
        title: 'ClickUp Actuals Sync',
        subtitle: 'Pull completed task hours back from ClickUp into the burn chart.',
        icon: 'RefreshCcw',
        gradient: ['#c026d3', '#7c3aed'],
        estMinutes: 4,
        whyItMatters:
          'ClickUp is where the team logs completed work. Syncing pulls those hours back into the calculator so the burn chart stays current and margin calculations remain accurate.',
        prerequisites: [
          'ClickUp integration configured in Settings',
          'Project has tasks in ClickUp',
        ],
        playbook: [
          'Click "Sync now" on the project detail page to trigger a manual sync.',
          'The sync-clickup-actuals edge function reads all completed subtasks under the project parent task.',
          'Hours are matched to departments based on the ClickUp task assignee and their department.',
          'Sync is additive — running it multiple times is safe; it will not double-count completed tasks.',
          'Tasks must be marked complete in ClickUp before they appear in the sync.',
          'If sync returns 0 hours but tasks are done, check the ClickUp PAT has not expired in Settings.',
        ],
        actions: [{ label: 'Settings', href: '/settings' }],
      },
      {
        key: 'recurring-tasks',
        title: 'Recurring Tasks',
        subtitle: 'How the calculator recreates ClickUp task hierarchies on a schedule.',
        icon: 'Repeat',
        gradient: ['#ec4899', '#d946ef'],
        estMinutes: 5,
        whyItMatters:
          'Monthly retainers should not require monthly manual quoting. Recurring task creation automates the ClickUp side of retainer delivery, keeping project tracking current without admin overhead.',
        prerequisites: [
          'Quote accepted with recurrence configured in the Project Builder',
          'ClickUp integration active',
        ],
        playbook: [
          'Recurrence is configured at quote time in the Project Builder Recurrence panel.',
          'The first task set is created immediately at acceptance. Subsequent sets fire on the configured schedule.',
          'The create-recurring-tasks edge function duplicates the original ClickUp task hierarchy.',
          'Each recurrence creates a fresh copy of all tasks — previous time entries are preserved.',
          'To pause recurrence, edit the recurrence config on the project detail page.',
          'Recurrence fires server-side via a scheduled job — no one needs to be logged in.',
        ],
        actions: [{ label: 'Projects', href: '/projects' }],
      },
    ],
  },
  {
    key: 'configuration',
    label: 'Configuration',
    icon: 'Settings2',
    steps: [
      {
        key: 'services-pricing',
        title: 'Services & Pricing',
        subtitle: 'Create and edit services with fixed, hourly, or percentage pricing models.',
        icon: 'Package',
        gradient: ['#6b7280', '#374151'],
        estMinutes: 5,
        whyItMatters:
          'Services are the building blocks of every quote. Well-defined services with accurate pricing make quoting fast, consistent, and auditable across the team.',
        prerequisites: ['Departments defined first — services reference department allocations'],
        playbook: [
          'Create a service with a short code (used for display), a name, and a pricing model.',
          'Pricing models: Fixed (flat rate), Hourly (sell rate × hours), Percentage (% of a base amount).',
          'Set a default allocation rule to define how hours split across departments.',
          'Fill in the scope definition fields — they feed the AI SOW drafter at quote time.',
          'Due days sets how many business days to deliver this service from acceptance.',
          'Archive services that are no longer offered — they stay on existing quotes but disappear from the picker.',
        ],
        actions: [{ label: 'Services', href: '/services' }],
      },
      {
        key: 'bundles-checklists',
        title: 'Bundles & Checklists',
        subtitle: 'Compose child services into parent bundles; save checklist allocations.',
        icon: 'Boxes',
        gradient: ['#475569', '#334155'],
        estMinutes: 4,
        whyItMatters:
          'Some services are always sold together. Bundles let you add ten services with one click. Checklists let you save customised allocation templates per service so the right hours split is always a starting point.',
        prerequisites: ['Child services exist before creating a bundle parent'],
        playbook: [
          'A bundle is a service with child services linked via the "Includes" panel in service detail.',
          'Adding a bundle to a quote automatically adds all its children as individual line items.',
          'A checklist service has its department allocation customised and saved for reuse.',
          'Save a checklist via "Save as rule" on the allocation editor in the quote builder.',
          'Bundles show a "bundle" badge in the Services list; checklist services show a "checklist" badge.',
          'Bundles can be nested — a bundle can include another bundle, which expands recursively.',
        ],
        actions: [{ label: 'Services', href: '/services' }],
      },
      {
        key: 'process-steps',
        title: 'Process Steps & AI',
        subtitle: 'Build service process flows step by step — or let Claude generate them.',
        icon: 'ListChecks',
        gradient: ['#64748b', '#475569'],
        estMinutes: 5,
        whyItMatters:
          'Process steps are the task template for ClickUp. Every service with a defined delivery checklist ensures nothing is forgotten during execution and the team knows exactly what to do from day one.',
        prerequisites: ['Service exists', 'Departments defined'],
        playbook: [
          'Open a service and scroll to the Process Flow panel.',
          'Add steps manually or click "Generate steps" to let Claude draft a delivery checklist.',
          'Each step has a name, description, responsible department, and estimated hours.',
          'Steps are ordered — drag handles allow reordering within the process.',
          "On quote acceptance, process steps become ClickUp subtasks assigned to the department's primary team member.",
          'Keep steps atomic — one action per step, one responsible party per step.',
        ],
        actions: [{ label: 'Services', href: '/services' }],
      },
      {
        key: 'allocation-rules',
        title: 'Allocation Rules',
        subtitle: 'Department-percentage templates that auto-split hours across the team.',
        icon: 'Sliders',
        gradient: ['#52525b', '#3f3f46'],
        estMinutes: 4,
        whyItMatters:
          'Rules define how service hours split across departments. They are reusable templates — change a rule once and every service using it gets the updated allocation without re-quoting.',
        prerequisites: ['Departments defined'],
        playbook: [
          'Create a rule with a descriptive name (e.g. "Dev-heavy", "Design-led") and dept → % allocations.',
          'Percentages must sum to exactly 100 — the editor enforces this with a live validator.',
          'Assign a rule to a service as its default in the service detail page.',
          'Rules can be overridden per quote line item in the builder — the rule is a starting point.',
          'Delete rules only if no services reference them — check the Services list first.',
          'Use "Save as rule" in the builder to create a rule from a custom allocation you have dialled in on a quote.',
        ],
        actions: [{ label: 'Rules', href: '/rules' }],
      },
      {
        key: 'departments-rates',
        title: 'Departments & Rates',
        subtitle: 'Define your teams, their sell rates, and cost rates per hour.',
        icon: 'Building2',
        gradient: ['#4b5563', '#1f2937'],
        estMinutes: 4,
        whyItMatters:
          'Departments define your billing teams and their rates. Sell rate drives quote pricing; cost rate drives margin calculations. Getting these right is the foundation for accurate quoting.',
        prerequisites: ['None — departments are the foundation for everything else'],
        playbook: [
          'Create one department per billing team (e.g. Development, Design, Strategy, PM).',
          'Sell rate is what you charge the client per hour for work from this department.',
          'Cost rate is your internal cost — used for margin reporting, not shown to clients.',
          'Assign a primary team member per department — they are the default ClickUp task assignee.',
          'Display order controls the sequence in burn charts and allocation tables.',
          'Changing rates affects future quotes only — existing finalised quotes are not recalculated.',
        ],
        actions: [{ label: 'Departments', href: '/departments' }],
      },
      {
        key: 'team-members',
        title: 'Team Members',
        subtitle: 'Add team members, assign departments, set skills and cost rates.',
        icon: 'Users',
        gradient: ['#6b7280', '#4b5563'],
        estMinutes: 3,
        whyItMatters:
          'Team members are the humans behind the departments. Adding them unlocks proper ClickUp task assignment so the right person gets notified when work is created on acceptance.',
        prerequisites: ['Departments exist'],
        playbook: [
          'Add each person with their name, email, and primary department.',
          'Cost rate per hour is used for internal margin calculations — keep it current.',
          'Skills are freeform tags used for filtering and display only, not for automation.',
          'Primary department determines which ClickUp tasks are assigned to them by default.',
          'Signing in as brendan@convertedclick.co.za (not the shared login) is needed for attributable writes.',
          'Team member records persist if someone leaves — do not delete, just update.',
        ],
        actions: [{ label: 'Team', href: '/team' }],
      },
      {
        key: 'clients',
        title: 'Clients',
        subtitle: 'Manage client records and link them to ClickUp folders.',
        icon: 'Briefcase',
        gradient: ['#64748b', '#374151'],
        estMinutes: 3,
        whyItMatters:
          'Linking a client to their ClickUp folder is what enables one-click task creation on quote acceptance. Without this link, the ClickUp push will fail and tasks will not be created.',
        prerequisites: [
          'ClickUp integration configured in Settings',
          'Client folder exists in your ClickUp workspace',
        ],
        playbook: [
          'Add clients with their name and primary domain.',
          'The ClickUp Folder combobox shows all folders in your configured ClickUp Clients space.',
          'Select the correct folder — this is where accepted quote tasks will be created.',
          'If the combobox is empty, configure ClickUp in Settings and select the Clients space first.',
          'Archive clients who are no longer active — archived clients do not appear in the brief form.',
          'One client can have multiple briefs but only one ClickUp folder link.',
        ],
        actions: [{ label: 'Clients', href: '/clients' }],
      },
      {
        key: 'settings-integrations',
        title: 'Settings & Integrations',
        subtitle: 'Configure ClickUp, Anthropic model selection, and Gmail relay tokens.',
        icon: 'Settings2',
        gradient: ['#374151', '#111827'],
        estMinutes: 5,
        whyItMatters:
          "Settings is the control room. Without ClickUp and Anthropic configured correctly, most of the tool's automation — AI drafting, task creation, actuals sync — will not work.",
        prerequisites: [
          'ClickUp Personal Access Token from ClickUp → Settings → Apps',
          'ClickUp Workspace ID from ClickUp → Settings → Workspaces',
        ],
        playbook: [
          'Enable ClickUp and paste your Personal Access Token — it is stored as a Supabase secret.',
          'Enter your Workspace ID — find it in ClickUp under Settings → Workspaces.',
          'Select the Clients space from the dropdown — this is where client folders live.',
          'Enable Anthropic and choose the model: Sonnet 4.6 for speed and cost, Opus 4.7 for complex briefs.',
          'Gmail relay setup lives under Settings → Gmail — follow the two-step token and Apps Script process.',
          'If ClickUp actions fail, check the PAT has not expired — ClickUp PATs do not auto-renew.',
        ],
        actions: [
          { label: 'Settings', href: '/settings' },
          { label: 'Gmail Setup', href: '/settings/gmail' },
        ],
      },
    ],
  },
]
```

- [ ] **Step 2: Run tests — all pass**

```bash
npm test -- src/data/guides.test.ts
```

Expected output: `PASS` — all 4 tests green.

- [ ] **Step 3: Commit**

```bash
git add src/data/guides.ts
git commit -m "feat(guides): add Projects and Configuration deck content — all 32 guides complete"
```

---

## Task 5 — GuidesPage component and tests

**Files:**
- Create: `src/pages/GuidesPage.tsx`
- Create: `src/pages/GuidesPage.test.tsx`

- [ ] **Step 1: Write the failing component tests**

```tsx
// src/pages/GuidesPage.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { GuidesPage } from './GuidesPage'
import { decks } from '@/data/guides'

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe('GuidesPage', () => {
  it('renders page heading', () => {
    render(<GuidesPage />, { wrapper: Wrapper })
    expect(screen.getByRole('heading', { name: /guides/i })).toBeInTheDocument()
  })

  it('renders the first deck steps by default', () => {
    render(<GuidesPage />, { wrapper: Wrapper })
    const firstStep = decks[0].steps[0]
    expect(screen.getByText(firstStep.title)).toBeInTheDocument()
  })

  it('switches to the second deck when its button is clicked', () => {
    render(<GuidesPage />, { wrapper: Wrapper })
    const secondDeck = decks[1]
    fireEvent.click(screen.getByRole('button', { name: secondDeck.label }))
    expect(screen.getByText(secondDeck.steps[0].title)).toBeInTheDocument()
    expect(screen.queryByText(decks[0].steps[0].title)).not.toBeInTheDocument()
  })

  it('expands a step card when clicked', () => {
    render(<GuidesPage />, { wrapper: Wrapper })
    const firstStep = decks[0].steps[0]
    expect(screen.queryByText('Why this matters')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(firstStep.title))
    expect(screen.getByText('Why this matters')).toBeInTheDocument()
  })

  it('collapses an open step when clicked again', () => {
    render(<GuidesPage />, { wrapper: Wrapper })
    const firstStep = decks[0].steps[0]
    fireEvent.click(screen.getByText(firstStep.title))
    expect(screen.getByText('Why this matters')).toBeInTheDocument()
    fireEvent.click(screen.getByText(firstStep.title))
    expect(screen.queryByText('Why this matters')).not.toBeInTheDocument()
  })

  it('only one step expanded at a time', () => {
    render(<GuidesPage />, { wrapper: Wrapper })
    const [step1, step2] = decks[0].steps
    fireEvent.click(screen.getByText(step1.title))
    expect(screen.getByText('Why this matters')).toBeInTheDocument()
    // Expanding step2 should collapse step1
    fireEvent.click(screen.getByText(step2.title))
    // Only one "Why this matters" label visible
    expect(screen.getAllByText('Why this matters')).toHaveLength(1)
    // step1 content gone, step2 content visible
    expect(screen.getByText(step2.whyItMatters)).toBeInTheDocument()
    expect(screen.queryByText(step1.whyItMatters)).not.toBeInTheDocument()
  })

  it('resets expanded step when switching deck', () => {
    render(<GuidesPage />, { wrapper: Wrapper })
    fireEvent.click(screen.getByText(decks[0].steps[0].title))
    expect(screen.getByText('Why this matters')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: decks[1].label }))
    expect(screen.queryByText('Why this matters')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests — all fail (module not found)**

```bash
npm test -- src/pages/GuidesPage.test.tsx
```

Expected: `FAIL` — `Cannot find module '@/pages/GuidesPage'`.

- [ ] **Step 3: Create `src/pages/GuidesPage.tsx`**

```tsx
// src/pages/GuidesPage.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart3, Boxes, Briefcase, Building2, CheckCircle2, ClipboardList,
  DollarSign, FileCheck, FileEdit, FilePlus, FileText, FolderKanban,
  GitBranch, GitMerge, Hammer, HelpCircle, Inbox, ListChecks, Lock,
  Mail, Package, Paperclip, Repeat, RefreshCcw, RefreshCw, ScanSearch,
  Search, Send, SendHorizontal, Settings2, SlidersHorizontal, Sliders, Sparkles,
  Users, Wand2, ChevronRight, ChevronDown, Lightbulb,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { decks, type Step } from '@/data/guides'

const iconMap: Record<string, React.ElementType> = {
  BarChart3, Boxes, Briefcase, Building2, CheckCircle2, ClipboardList,
  DollarSign, FileCheck, FileEdit, FilePlus, FileText, FolderKanban,
  GitBranch, GitMerge, Hammer, HelpCircle, Inbox, ListChecks, Lock,
  Mail, Package, Paperclip, Repeat, RefreshCcw, RefreshCw, ScanSearch,
  Search, Send, SendHorizontal, Settings2, SlidersHorizontal, Sliders, Sparkles,
  Users, Wand2,
}

function StepCard({
  step,
  index,
  expanded,
  onToggle,
}: {
  step: Step
  index: number
  expanded: boolean
  onToggle: () => void
}) {
  const navigate = useNavigate()

  return (
    <div
      className={`rounded-lg border bg-card transition-colors ${
        expanded ? 'border-primary' : 'border-border'
      }`}
    >
      <button
        className="flex w-full items-center gap-4 p-4 text-left"
        onClick={onToggle}
      >
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
          style={{
            background: `linear-gradient(135deg, ${step.gradient[0]}, ${step.gradient[1]})`,
          }}
        >
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">{step.title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{step.subtitle}</div>
        </div>
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          ~{step.estMinutes} min
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-0">
          <div
            className="mt-3 rounded-md border-l-4 p-3"
            style={{
              background: `linear-gradient(135deg, ${step.gradient[0]}18, ${step.gradient[1]}18)`,
              borderLeftColor: step.gradient[0],
            }}
          >
            <div
              className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"
              style={{ color: step.gradient[0] }}
            >
              <Lightbulb className="h-3 w-3" />
              Why this matters
            </div>
            <p className="text-xs leading-relaxed text-foreground">{step.whyItMatters}</p>
          </div>

          <div className="mt-3">
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Prerequisites
            </div>
            <ul className="list-disc pl-4 text-xs leading-relaxed text-muted-foreground">
              {step.prerequisites.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>

          <div className="mt-3">
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Best-practice playbook
            </div>
            <ol className="list-decimal pl-4 text-xs leading-relaxed text-muted-foreground">
              {step.playbook.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
          </div>

          {step.actions.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {step.actions.map((action, i) => (
                <Button
                  key={i}
                  size="sm"
                  className="text-white"
                  style={{
                    background: `linear-gradient(135deg, ${step.gradient[0]}, ${step.gradient[1]})`,
                  }}
                  onClick={() => navigate(action.href)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function GuidesPage() {
  const [activeDeckKey, setActiveDeckKey] = useState(decks[0].key)
  const [expandedStepKey, setExpandedStepKey] = useState<string | null>(null)

  const activeDeck = decks.find((d) => d.key === activeDeckKey) ?? decks[0]

  function handleDeckChange(key: string) {
    setActiveDeckKey(key)
    setExpandedStepKey(null)
  }

  function handleStepToggle(key: string) {
    setExpandedStepKey((prev) => (prev === key ? null : key))
  }

  return (
    <div className="container mx-auto max-w-6xl p-8">
      <h1 className="text-headline-medium text-m-on-surface">Guides</h1>
      <p className="mt-1 text-body-medium text-m-on-surface-variant">
        How everything works — step by step.
      </p>

      <div className="mt-6 flex gap-6">
        <div className="w-44 shrink-0 space-y-0.5">
          {decks.map((deck) => {
            const Icon = iconMap[deck.icon]
            return (
              <button
                key={deck.key}
                onClick={() => handleDeckChange(deck.key)}
                className={`flex w-full items-center gap-2.5 rounded-full px-4 py-2.5 text-left text-label-large transition-colors ${
                  deck.key === activeDeckKey
                    ? 'bg-m-primary-container font-semibold text-m-on-primary-container'
                    : 'text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface'
                }`}
              >
                {Icon && <Icon className="h-[18px] w-[18px] shrink-0" />}
                {deck.label}
              </button>
            )
          })}
        </div>

        <div className="flex-1 space-y-2">
          {activeDeck.steps.map((step, i) => (
            <StepCard
              key={step.key}
              step={step}
              index={i}
              expanded={expandedStepKey === step.key}
              onToggle={() => handleStepToggle(step.key)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests — all pass**

```bash
npm test -- src/pages/GuidesPage.test.tsx
```

Expected output: `PASS` — all 7 tests green.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
npm test
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/pages/GuidesPage.tsx src/pages/GuidesPage.test.tsx
git commit -m "feat(guides): GuidesPage component with deck picker and collapsible steps"
```

---

## Task 6 — Route and sidebar wiring

**Files:**
- Modify: `src/App.tsx` (add lazy-loaded route, lines 1–57 area)
- Modify: `src/components/AppShell.tsx` (add nav item, lines 2 and 7–17)

- [ ] **Step 1: Add the lazy import for GuidesPage in `src/App.tsx`**

After the `SettingsConnectGmail` lazy import (line 57), add:

```ts
const GuidesPage = lazy(() =>
  import('@/pages/GuidesPage').then((m) => ({ default: m.GuidesPage })),
)
```

- [ ] **Step 2: Add the `/guides` route in `src/App.tsx`**

Inside the `<Route element={<AppShell />}>` block, add after the `<Route path="team" …` line (line 92):

```tsx
<Route path="guides" element={<GuidesPage />} />
```

- [ ] **Step 3: Add `BookOpen` to the lucide-react import in `src/components/AppShell.tsx`**

The current import on line 2 is:

```ts
import { Building2, Calculator, FolderKanban, Inbox as InboxIcon, LayoutDashboard, LogOut, PackageSearch, Settings as SettingsIcon, SlidersHorizontal, Users, Workflow } from "lucide-react";
```

Change it to:

```ts
import { BookOpen, Building2, Calculator, FolderKanban, Inbox as InboxIcon, LayoutDashboard, LogOut, PackageSearch, Settings as SettingsIcon, SlidersHorizontal, Users, Workflow } from "lucide-react";
```

- [ ] **Step 4: Add the Guides nav item in `src/components/AppShell.tsx`**

The current `nav` array ends with Team then Settings (lines 15–16):

```ts
  { to: "/team", label: "Team", icon: Users, end: false },
  { to: "/settings", label: "Settings", icon: SettingsIcon, end: false },
```

Change it to:

```ts
  { to: "/team", label: "Team", icon: Users, end: false },
  { to: "/guides", label: "Guides", icon: BookOpen, end: false },
  { to: "/settings", label: "Settings", icon: SettingsIcon, end: false },
```

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass. TypeScript compilation implicitly checked via Vitest's ts transform.

- [ ] **Step 6: Start the dev server and verify in the browser**

```bash
npm run dev
```

Open http://localhost:5174, sign in as `team@convertedclick.co.za` / `cc-calc-2026-temp`, click **Guides** in the sidebar. Verify:

1. Guides nav item appears between Team and Settings.
2. Inbox deck is shown by default with 5 step cards.
3. Clicking a step card expands it showing Why this matters / Prerequisites / Playbook / action button.
4. Clicking another step collapses the first.
5. Clicking a deck tab in the left column switches the step list and collapses any open step.
6. Action buttons navigate to the correct route.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/AppShell.tsx
git commit -m "feat(guides): wire /guides route and sidebar nav item"
```
