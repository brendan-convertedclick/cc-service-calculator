# 3-Stage Brief Flow — Design

**Date:** 2026-07-14
**Route affected:** `/briefs/:id/scope` (the `Scope` page)

## Problem

The brief scope page is one long scroll that shows the AI brief and scope editor
first, and only surfaces the in/out-of-scope disposition UI later, on a separate
`/sow-check` route. Operators should not be able to brief work before confirming
what is in vs out of scope. We want the scope page restructured into three
explicit, gated stages, with the scope confirmation as the mandatory first step.

## Stages

The page becomes a **numbered accordion** with three gated sections:

1. **Stage ① · In / Out of Scope** — the mandatory gate.
   - Hosts the existing `ScopeReceipt`: items auto-bucketed **In / New / Out**,
     each correctable with the per-line In/New/Out toggle + grounding quote + qty.
   - Data: `brief_task_sow_placements`. If none exist, runs `analyze-brief-sow`
     on open (and shows `SowSelectionCard` when the client has no SOW link yet).
   - Corrections persist via `useOverridePlacement`.
   - **Completion:** required **"Confirm scope →"** button, which stamps
     `briefs.scope_confirmed_at`. Unlocks Stage ②.

2. **Stage ② · The Brief** — locked until Stage ① confirmed.
   - The existing `BriefIntelligenceView` + Approve / Reject card.
   - **Completion:** Approve (`brief_intelligence.am_status = 'approved'`).
     Unlocks Stage ③.

3. **Stage ③ · Scope Edit** — locked until Stage ② approved.
   - The existing `ScopeEditor` (4 markdown editors, now light-mode) + Save draft
     / Lock scope.
   - **Lock scope** behaves as today: `briefs.status = 'scoped'` → navigate to
     `/sow-check` → builder (downstream unchanged).

## Gating

| Stage | Locked when | Done when |
|-------|-------------|-----------|
| ① Scope | never | `scope_confirmed_at` set |
| ② Brief | `!scope_confirmed_at` | `am_status === 'approved'` |
| ③ Edit | `am_status !== 'approved'` | `brief.status === 'scoped'` |

The accordion auto-opens the first not-done stage. Done/active stages can be
re-opened manually; locked stages cannot.

## New vs reused

- **New:**
  - Migration `0081_brief_scope_confirmed.sql` — `briefs.scope_confirmed_at
    timestamptz`, `briefs.scope_confirmed_by uuid` (both nullable).
  - `useConfirmScope(briefId)` hook (in `useBriefs.ts`).
  - `StageSection` presentational accordion component (number badge, lock/check
    state, collapsible body).
  - `ScopeConfirmStage` — Stage ① body: placement data + analyze/SOW-selection +
    `ScopeReceipt` + Confirm button. Factored so `Scope.tsx` stays thin.
  - `Scope.tsx` rewired to compose the three `StageSection`s.
- **Reused unchanged:** `ScopeReceipt`, `BriefIntelligenceView`, `ScopeEditor`
  and their hooks (`useScopeMapPlacements`, `useAnalyzeBrief`,
  `useOverridePlacement`, `useServices`, `useBriefIntelligence`, `useScopes`).

## Demo data

The `/sow-check` receipt needs `brief_task_sow_placements`, produced by SOW
analysis against the client's catalogue. The demo client "The Converted Click"
has no SOWs, so demo brief `910c03f5-…` gets a handful of seeded placements
(in / new / out, with `estimated_cents` and grounding quotes) so Stage ① renders
with data.

## Out of scope (this iteration)

- The `/sow-check` page keeps its own receipt/estimate/approve-placements → this
  is the downstream project-building step; not consolidated here.
- No changes to `analyze-brief-sow` or the disposition resolver.
