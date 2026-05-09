# Design: Client → Project Scope View — Three-Tier Navigation Restructure

**Date:** 2026-05-09
**Status:** Draft — awaiting plan
**Author:** Brendan Gunn

---

## 1. What this is and why

The current app organises work across separate pages — Inbox, Projects, Clients, Quotes — requiring navigation between them to build a picture of any one client. There is no single place where a staff member can see everything happening for a client and quickly jump between clients.

This spec describes a restructure of the app shell and navigation model around a **three-tier scope view**: Client → Project → Thread. The reference model is the VS Code agent sessions panel: a left sidebar groups sessions by workspace; clicking a session loads its full context in the centre; a right strip shows artefacts and status.

The result: one view, one click to switch clients, everything for a project visible without navigating away.

This is a **UI/navigation restructure**, not a new data feature. It depends on the cc-service-calculator MCP (being built separately) for writes, and on the auto-scope-on-ingest pipeline (specced 2026-05-09) for intake. The scope view is the surface those systems write *to* and staff read *from*.

---

## 2. The three tiers

### Tier 1 — Client
The top-level grouping. Maps to the `clients` table. Displayed as collapsible section headers in the left sidebar. A badge shows the count of new/unread items across all projects for that client.

### Tier 2 — Project (or Engagement)
An active piece of work belonging to a client. Maps to the `projects` table. Two engagement types exist and are visually distinct in the sidebar:

| Type | Description | Example |
|---|---|---|
| `fixed` | Scoped, time-bounded, has a quote | "Website Rebuild 2026" |
| `retainer` | Ongoing, billed monthly, no fixed end | "Monthly SEO — May 2026" |

Projects are listed under their client header, ordered by most-recent activity (latest `briefs.created_at` or `project_actuals.updated_at` for that project, whichever is newer).

### Tier 3 — Thread / Brief
An individual communication or work item within a project. Maps to `briefs` (linked via `parent_project_id`). Rendered in the centre pane as an activity feed — not a separate navigation tier. Threads don't get their own URL; they anchor within the project scope view.

---

## 3. Layout — three panes

```
┌─────────────────────┬──────────────────────────────┬───────────────────┐
│  LEFT (240px)       │  CENTRE (flex)               │  RIGHT (280px)    │
│  Navigation         │  Project scope               │  Status strip     │
└─────────────────────┴──────────────────────────────┴───────────────────┘
```

The three panes are always visible on desktop (≥1280px). On narrower viewports, the right pane collapses first (accessible via a tab within the centre), then the left pane collapses to an icon rail.

---

## 4. Left pane — navigation

### Structure (top to bottom)

```
[ ⌘K Search / jump ]

INBOX  (3)                    ← unlinked briefs awaiting assignment
  ↳ Email from sarah@acme... 2h ago
  ↳ Email from jay@pebble... 5h ago
  ↳ Email from unknown...    1d ago

── ACME ──────────────────
● Website Rebuild            ← active project, dot = status colour
  +2 new · 2h ago
○ Monthly SEO Retainer
  Active · 1d ago

── PEBBLE ────────────────
● Brand Campaign Q2
  On track · 3d ago
○ App Design
  Needs info · 1w ago

── QUARTZ ────────────────
● Monthly SEO
  Active · 5h ago

[ + New project ]
```

### Inbox section
Always appears at the top, above all clients. Shows briefs that have been ingested (by the skill or by gmail-relay) but not yet linked to a project. Count badge shows unresolved items. Clicking an inbox item opens it in the centre pane in assignment mode — the staff member sees the email, the AI classification, the suggested project match, and a single action to confirm or reassign.

### Client headers
Collapsible. Show client name in uppercase. A count badge appears when any project under them has new activity. Clients with no active projects are collapsed by default.

### Project rows
Each row shows:
- Status dot (colour-coded: green = on track, amber = needs attention, red = overdue/blocked). In V1 this is a manually set field on the project — staff update it. Auto-computation from task/burn data is V2.
- Project name (truncated to fit)
- Engagement type chip (`retainer` vs `fixed`) — small, right-aligned
- Activity summary: "+ N new" if unread briefs exist, otherwise relative timestamp of last activity

Clicking a row loads that project in the centre pane and updates the URL.

### New project button
At the bottom of the left pane. Opens a lightweight drawer to create a project against any client. (Actual creation handled via MCP.)

---

## 5. Centre pane — project scope view

### Header
```
ACME  >  Website Rebuild                          [ Fixed · Active ]
Last activity 2h ago · R48,500 quoted · 48h / 120h used
```

Breadcrumb shows client name (links to client view) and project name. Status chip and key metrics inline.

### Tabs

| Tab | Content |
|---|---|
| **Activity** (default) | Chronological feed of everything — see below |
| **Tasks** | ClickUp tasks linked to this project, grouped by status |
| **Quote / SOW** | Quote lines, SOW preview, acceptance status |
| **Time** | Burn chart: estimated vs actual hours by department |

### Activity feed (default tab)

A single chronological timeline, newest at bottom, showing every event that belongs to this project:

```
Apr 30  Brief created
        "Full site build, 8 inner pages, mobile responsive."
        [new_brief]  Assignee: Brendan

May 6   ClickUp update (synced)
        "Design phase complete — 3 tasks closed"

May 7   Scope draft added
        Homepage + 5 inner pages, revision policy, trigger to start...
        [View scope]

May 9   Email from sarah@acme.co.za
        "Can we add a blog section to the site?"
        [project_thread · pre-scoped]  [Review & assign]

                                              [ + Add brief to project ]
```

Event types in the feed:
- **Brief / email** — inbound communication, shows classification badge and scope status
- **Scope draft** — AI-generated or human-written scope, expandable inline
- **ClickUp sync** — task status updates synced from ClickUp (via sync-clickup-actuals)
- **Quote event** — quote sent, accepted, superseded
- **Note** — internal team note (from BriefConversation note flow)
- **Time entry** — logged time against the project

Each event is compact by default, expandable on click. No pagination — feeds are short at agency volume (20–50 briefs/month across all clients).

### "Add brief to project" button
Fixed at the bottom of the Activity tab. Opens a drawer where staff can manually create a brief, paste email content, or pull from the Inbox. This is also where the Claude skill surfaces its findings for human review before committing — the skill writes a draft brief with classification and scope, and the staff member presses confirm.

---

## 6. Right pane — status strip

Always visible for the active project. Four sections:

### Burn
```
Budget
48h used / 120h estimated
████░░░░░░  40%

By department:
Dev     22h / 60h
Design  18h / 40h
PM       8h / 20h
```

### Tasks
```
Tasks (ClickUp)
✓ 12  complete
○  5  in progress
✗  3  outstanding
```

### Quote
```
Quote
R48,500  ·  Sent 2026-05-07
Awaiting client sign-off
```

### Recent artefacts
```
Files
SOW-v2.pdf         May 8
Wireframes.fig     May 6
Brief-001.pdf      Apr 30
```

---

## 7. Navigation model

### URL structure
```
/                              ← dashboard (unchanged)
/inbox                         ← all unlinked briefs across all clients
/clients                       ← client list (existing page, unchanged)
/clients/:clientId             ← client overview — all their projects listed
/clients/:clientId/projects/:projectId          ← project scope view (new)
/clients/:clientId/projects/:projectId/tasks    ← tasks tab deep link
/clients/:clientId/projects/:projectId/quote    ← quote tab deep link
/clients/:clientId/projects/:projectId/time     ← time tab deep link
```

The left sidebar reflects the current URL. Navigating via the sidebar updates the URL. Browser back/forward and bookmarks work correctly.

### Keyboard navigation
- `⌘K` — command palette with "Jump to client" and "Jump to project" as top actions
- `G I` — jump to Inbox
- `G C` — jump to Clients list
- Left sidebar is keyboard-navigable (arrow keys + Enter)

### Scope persistence
When a staff member switches clients or projects, their scroll position within the previous project is saved to session storage and restored on return. Tab selection (Activity / Tasks / Quote / Time) is also preserved per project.

---

## 8. Inbox assignment flow

This is the critical human-in-the-loop step for the skill integration.

1. Skill runs (manually or on a loop), reads Gmail, classifies emails, drafts scopes.
2. For each email it processes, it writes a brief via the MCP with `parent_project_id = null` if it couldn't match confidently, or with a matched `parent_project_id` if confidence is high.
3. Unmatched briefs appear in the **Inbox** section of the left sidebar with count badge.
4. Staff clicks an inbox item → centre pane shows:
   - The email content
   - AI classification: intent type + reasoning
   - Suggested project match (if any) with confidence
   - Scope draft (if pre-scoped)
5. Staff selects the correct project from a dropdown (pre-filled with the AI suggestion) and clicks **Assign to project**.
6. The brief moves from Inbox into that project's activity feed. The Inbox count decrements.

For high-confidence matches, the skill can write `parent_project_id` directly and the brief lands in the project feed without touching Inbox. A small "AI-linked" badge on the feed item signals this; staff can reassign if wrong.

---

## 9. Data model changes required

This view depends on the following that don't yet exist:

| Change | Why needed |
|---|---|
| `projects.client_id` (FK, denormalized) | Left sidebar query: "give me all projects for client X" needs this — currently requires traversing 4 joins |
| `briefs.parent_project_id` (FK to `projects.id`, nullable) | Core link. Null = Inbox item. Set = appears in project feed |
| `projects.engagement_type` (`fixed` \| `retainer`) | Visual distinction in sidebar and header |
| `projects.status` colour (`on_track` \| `needs_attention` \| `overdue`) | Sidebar dot colour |

The `project_artifacts` table (proposed in earlier research) is deferred — the activity feed is assembled by querying existing tables (`briefs`, `brief_messages`, `project_actuals`, `quotes`) joined on `project_id`. No new polymorphic artifact table needed for V1 of this view.

---

## 10. What this replaces / restructures

| Current | After |
|---|---|
| Inbox page (standalone) | Inbox section at top of left sidebar |
| Projects page (standalone list) | Projects listed under each client in left sidebar |
| Clients page (standalone) | Client headers in left sidebar; `/clients/:id` becomes a project list view |
| Navigating between pages to see one client's full picture | Single project scope view, everything in one place |

The existing Inbox, Projects, and Clients pages are **not deleted** in V1 of this restructure — they remain accessible from the left nav for staff who prefer the list views. The scope view is an addition to navigation, not a replacement. Deprecation can happen once the new model is validated.

---

## 11. Out of scope for this spec

- MCP implementation (being built separately)
- Auto-scope-on-ingest pipeline (specced 2026-05-09, not yet implemented)
- Claude skill that reads Gmail and drives the Inbox (separate skill spec)
- Client portal / external-facing view
- Mobile layout (responsive behaviour noted but not detailed)
- Notification system (new-brief badges are real-time via existing Supabase Realtime subscription)
- Drag-and-drop inbox assignment (keyboard + dropdown is sufficient for V1)
- Retainer billing periods / monthly rollup view (V2)
