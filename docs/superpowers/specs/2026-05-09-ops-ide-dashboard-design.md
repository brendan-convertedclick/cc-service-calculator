# Ops IDE Dashboard — Design Spec

**Date:** 2026-05-09  
**Status:** Approved  

## Vision

Replace the current stat-card Dashboard with a project-first operations management IDE — the home base for the Converted Click operations manager. Inspired by VS Code's explorer + editor pattern: a client/project tree on the left, full project detail on the right. The ops manager opens this screen to see the pulse of the business, triage projects, and take action without leaving the view.

---

## Decisions made

| Question | Decision |
|---|---|
| Layout approach | Standalone `DashboardShell` — sidebar removed from AppShell on all other pages |
| Mark complete | Two-step: hover row → hide from view (session-only); "Complete project" button in detail panel → DB write (`status = completed`) |
| Project detail content | Extend existing `ProjectScopeView` content with ops-specific additions (recommended banner, quick actions) |
| Default state (no project selected) | Aggregate ops summary: health pill counts + "needs attention" list + "recently active" list |

---

## Layout

The `/` route renders a standalone `DashboardShell` — not wrapped by `AppShell`. It is a full-viewport 3-column grid:

```
[ 52px icon rail ] [ 240px project tree ] [ flex: 1 detail panel ]
```

All other routes continue to use `AppShell`, which loses its sidebar column and becomes a 2-column grid:

```
[ 52px icon rail ] [ flex: 1 main content ]
```

The icon rail component is shared between both layouts.

---

## Left panel — Project Tree

**Header:**
- "Projects" label + filter input (text filter across project names and client names)
- "Show completed" toggle button (⊘ icon)

**Health pills row** (derived from `useClientProjects`):
- `N on track` (green) · `N ⚠` (amber) · `N 🔴` (red)
- Clicking a pill filters the tree to that scope_status group

**Client groups:**
- One `ClientNavSection` per client that has visible projects
- Client header: chevron + client name, collapsible
- Project rows: `ProjectNavRow` extended with:
  - Status dot (green/amber/red matching `scope_status`)
  - Project name (truncated)
  - Last activity age ("2d ago", "12d ago") — derived from most recent brief/actuals timestamp
  - Engagement type badge (retainer/fixed)
  - On hover: `✓` dismiss button (calls `useHiddenProjects.hide(id)` — session-only, no DB write)
- Active/selected row highlighted with `bg-m-primary-container`

**Hidden projects** are filtered out of the tree. The "Show completed" toggle also surfaces `status = completed` projects (greyed out, read-only).

---

## Right panel — Default state (OpsOverview)

Shown when `selectedProjectId === null`.

**Header:**
- "Operations overview" title + date + "N active projects across N clients" subtitle

**Health cards row** (4 cards):
- On track count (green)
- Needs attention count (amber)
- Overdue count (red)
- Total hours burned this month (neutral)

**"Needs your attention" section:**
- Projects where `scope_status = needs_attention` or `scope_status = overdue`, sorted by urgency
- Each row: status dot + client name + project name + reason string + engagement type + last-activity age
- Reason string derived from: budget ≥ 80%, unlinked brief, quote not sent, no activity in N days
- Clicking a row selects that project (sets `selectedProjectId` and highlights it in the tree)

**"Recently active" section:**
- Projects with recent brief or actuals activity, sorted by `lastActivityAt` descending
- Same row format; clicking selects the project

---

## Right panel — Project detail (ProjectDetailPanel)

Shown when a project is selected.

### Header

```
[ project_code badge ] [ project name ] [ scope_status badge ]
[ client · engagement_type · Started date ]
                                    [ + Brief ]  [ ↺ Sync ]  [ ✓ Complete ]
```

- **+ Brief**: navigates to `/briefs/new?projectId=<id>` (pre-fills project). Note: `NewBrief` page may need a `projectId` query param read added if not already present — implementation should verify.
- **↺ Sync**: calls `sync-clickup-actuals` edge function
- **✓ Complete**: confirmation dialog → sets `projects.status = completed` → removes project from tree

### Recommended banner

An amber strip between the header and tabs, shown when any of these conditions are true:

| Condition | Message |
|---|---|
| `actual_hours / planned_hours ≥ 0.80` | "Budget at N% — consider scoping additional hours" |
| No linked quote | "No quote linked to this project" |
| Latest quote `status = draft` or `status = sent` | "Quote not yet accepted" |
| No brief in last 14 days | "No brief activity in N days" |
| `scope_status = overdue` | "Project is overdue" |

Multiple conditions shown as a comma-separated string. A close (`×`) button dismisses the banner for the session.

Quick-action links on the right side of the banner route to the relevant action (e.g. "Send quote →" → `/quotes/:id/send`).

### Tabs + StatusStrip

Reuses the existing `ProjectScopeView` content structure:

- **Activity tab**: `ActivityFeed` — briefs, actuals updates, quotes (existing)
- **Tasks tab**: placeholder ("ClickUp task sync coming in a future phase") — existing
- **Quote / SOW tab**: linked quote info — existing
- **Time tab**: hours breakdown by department — existing
- **StatusStrip** (right): budget burn bar, brief count, quote value/status — existing, unchanged

---

## Component map

### New components

| File | Description |
|---|---|
| `src/pages/DashboardPage.tsx` | Thin page component — renders `DashboardShell` |
| `src/components/dashboard/DashboardShell.tsx` | Full-page IDE layout; owns `selectedProjectId` + `hiddenProjectIds` state |
| `src/components/dashboard/ProjectTree.tsx` | Left panel — health pills, filter, client groups |
| `src/components/dashboard/OpsOverview.tsx` | Default right panel — aggregate summary |
| `src/components/dashboard/ProjectDetailPanel.tsx` | Selected project right panel — header + banner + tabs |
| `src/components/dashboard/RecommendedBanner.tsx` | Amber action strip below project header |
| `src/hooks/useHiddenProjects.ts` | `useState<Set<string>>` — session-only hidden project ids |
| `src/hooks/useOpsOverview.ts` | Derives health counts, needs-attention list, recently-active list from `useClientProjects` data |

### Modified components

| File | Change |
|---|---|
| `src/App.tsx` | Add `DashboardPage` route outside `AppShell`; move index route |
| `src/components/AppShell.tsx` | Remove `<aside>` sidebar column; grid becomes `grid-cols-[56px_1fr]` |
| `src/components/nav/ProjectNavRow.tsx` | Add `onHide?: (id: string) => void` prop; show `✓` on hover |
| `src/components/nav/ClientNavSection.tsx` | Pass `onHide` through to `ProjectNavRow` |
| `src/pages/ProjectScopeView.tsx` | Extract tab content + StatusStrip into `ProjectDetailPanel`; `ProjectScopeView` becomes a thin wrapper that renders `ProjectDetailPanel` inside its existing route layout |

---

## Data flow

```
DashboardShell
  ├── useClientProjects()            → all clients + projects (cached)
  ├── useHiddenProjects()            → session-dismissed ids
  ├── selectedProjectId (state)      → null = OpsOverview
  │
  ├── ProjectTree
  │     useOpsOverview(clientsData)  → health counts, attention/recent lists
  │
  └── OpsOverview          (selectedProjectId === null)
            onSelect(id) → setSelectedProjectId
      or
      ProjectDetailPanel   (selectedProjectId !== null)
            useProject(id)
            useProjectActivity(id, quoteId)
```

`useOpsOverview` is a pure derived-data hook — no network calls, runs off the already-cached `useClientProjects` result.

---

## What is NOT in scope

- Keyboard navigation between project rows (nice-to-have, future)
- Persisting hidden projects across sessions (localStorage — future)
- Per-project notes or internal comments
- Capacity planning or team workload view
- Any Xero integration

---

## Success criteria

- Ops manager can open the dashboard and immediately see which projects need attention without clicking anything
- Selecting a project loads its full detail without a page navigation
- Marking a project hidden removes it from the tree immediately
- Completing a project writes to DB and removes it from the active tree
- All other pages (Inbox, Services, Rules, etc.) are unaffected by the layout change
