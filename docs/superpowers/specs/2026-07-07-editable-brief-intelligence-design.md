# Editable Brief Intelligence — Design

**Date:** 2026-07-07
**Status:** Approved, pending implementation plan
**Scope:** Add a direct human edit path for brief intelligence (hours, work breakdown, price, and the rest of the review content) on the Scope review screen.

## Problem

The brief review screen (`/briefs/:id/scope` → `src/pages/Scope.tsx` + `src/components/BriefIntelligenceView.tsx`) is read-only. The only way to change the hours or work breakdown is **Reject — needs changes**, which sends free-text notes back and makes the intake pipeline **regenerate** the whole intelligence record from scratch.

The account manager (AM) needs to correct the numbers directly during review — the intake pipeline takes a guess, and in review the AM may want to fix the hours, the breakdown, or the price without a full regeneration round-trip.

## Goal

On the Scope review screen, let the AM flip into an edit mode, correct the intelligence content, and save it back directly — no pipeline round-trip. Approve/Reject remain available for the untouched-review path.

## Current state (as-is)

- **View:** `BriefIntelligenceView.tsx` is a pure presentational component (`props: intelligence, isLoading`). It renders Summary + confidence badge, Requirements, Work Breakdown (per department: `"{low}–{high} hrs human · {ai} hrs AI"` + deliverables/tasks), Human hours + Estimated price cards, and Open Questions. The JSONB shapes `Requirement`, `DeptBreakdown`, `OpenQuestion` are defined **privately** inside this file.
- **Data:** `useBriefIntelligence(briefId)` in `src/hooks/useBriefIntelligence.ts` selects `brief_intelligence` (1:1 with `briefs`). It **polls every 5s while `am_status === "pending"`**. `useApproveBriefIntelligence` / `useRejectBriefIntelligence` update only `am_status` / `am_notes` / `am_reviewed_at`.
- **Table `brief_intelligence`** (`src/types/db.ts`): JSONB `requirements`, `work_breakdown`, `open_questions`; scalars `summary`, `business_objective`, `confidence_level`; hours `total_human_hours_low/mid/high`, `total_ai_hours`; `estimated_price_cents` (integer cents); review `am_status/am_notes/am_reviewed_at`. The `Update` type already exposes all content/hours/price fields as optional.
- **Pricing today:** the intake pipeline (`~/.claude/skills/intake/stages/synthesise-estimates.md` step 3) sets `estimated_price_cents = sum(sell_price_cents)` of the matched services — **independent of hours**. Departments carry `hourly_rate_cents` (`departments` table; `useDepartments()` hook returns non-archived depts). Each `work_breakdown` group has a `department_id`.

## Design

### 1. Edit-mode toggle

`BriefIntelligenceView` gains internal edit state:

- An **Edit** button top-right of the body (near the confidence badge) in read-only mode.
- Clicking Edit snapshots the current `intelligence` into a local **draft** (editable fields only) and renders every section as inputs.
- **Save** and **Cancel** replace the Edit button while editing. Cancel discards the draft and returns to read-only. Save persists (see §4) then returns to read-only showing saved values.
- The component owns the draft; it notifies the parent of edit state via an `onEditingChange(isEditing: boolean)` callback.

### 2. Editable fields

- **Summary** (`summary`) and **business objective** (`business_objective`) → textareas.
- **Requirements** (`requirements[]`) → per row: `text` + `interpretation` (text inputs) and `confidence` (select: low/medium/high). Add/remove rows. `mapped_service_ids` is **preserved untouched** on each row (not edited in the UI; carried through on save).
- **Work breakdown** (`work_breakdown[]`), per department:
  - Department name stays a **read-only label**, resolved from `department_id` via `useDepartments()`.
  - `human_hours_low`, `human_hours_mid`, `human_hours_high`, `ai_hours` → number inputs.
  - `deliverables[]` → editable `name` lines; add/remove. Other deliverable fields (`format`, `quantity`, `platform`) preserved.
  - `tasks[]` → editable `title` + `description`; add/remove. `is_ai_eligible` preserved.
- **Open questions** (`open_questions[]`) → editable `question` + `context`; add/remove.

### 3. Hours + price cards (live)

- **Total hours** (low–high) and **AI hours**: read-only outputs, recomputed live from the sum of the per-department hours in the draft.
- **Estimated price**: rendered as an **editable ZAR input**. Its default/suggested value is the live computed figure:

  ```
  computeEstimatedPriceCents = Σ over work_breakdown depts of
      round(dept.human_hours_high × dept.hourly_rate_cents)
  ```

  (`human_hours_high` = the "ceiling for pricing" per the existing estimation rules; departments missing a rate contribute 0.) The AM may override the field with any value. A **"reset to computed"** link restores the formula value. Whatever is in the field at Save is stored (converted to integer cents).

  Note: because today's stored price comes from service sell-prices, switching to hours×rate means the displayed price will differ from the pipeline's original figure even before any edit. This is intended — the price card always reflects hours×rate (or the AM's override), per the approved decision "always show hours×rate".

### 4. Save behaviour

On Save:

1. A pure helper `recomputeTotals(work_breakdown)` computes `total_human_hours_low/mid/high` and `total_ai_hours` as the sums of the per-department values.
2. `estimated_price_cents` = the current value of the price input (cents).
3. `useUpdateBriefIntelligence` performs one `update` on `brief_intelligence` keyed by `brief_id`, writing: `work_breakdown`, `requirements`, `open_questions`, `summary`, `business_objective`, `total_human_hours_low/mid/high`, `total_ai_hours`, `estimated_price_cents`.
4. On success, invalidate the `brief_intelligence` query; the view exits edit mode and shows saved values.

Editing is a **direct human override** — it does **not** re-run the intake pipeline, and is distinct from Reject-and-regenerate. `am_status` is not changed by an edit; an AM may edit and then Approve without ever Rejecting.

### 5. Guards

- **Poll pause:** `useBriefIntelligence` polls every 5s while `am_status === "pending"` — exactly when editing occurs. Editing must **pause that poll** so a refetch can't race the draft. Scope owns an `isEditing` flag (fed by `onEditingChange`) and passes it to `useBriefIntelligence` so `refetchInterval` is disabled while editing.
- **Action bar:** `Scope.tsx` **hides/disables the Approve → build scope / Reject bar while editing** (via `onEditingChange`). The AM finishes or cancels the edit before approving.

### 6. Files

**New**
- `src/types/brief-intelligence.ts` — extract `Requirement`, `DeptBreakdown`, `OpenQuestion` (currently private in `BriefIntelligenceView.tsx`) into a shared module consumed by both the view and the editor logic.
- `src/lib/brief-estimate.ts` (+ `src/lib/brief-estimate.test.ts`) — pure `recomputeTotals(work_breakdown)` and `computeEstimatedPriceCents(work_breakdown, departments)`.

**Edit**
- `src/hooks/useBriefIntelligence.ts` — add `useUpdateBriefIntelligence`; add a poll-pause parameter to `useBriefIntelligence`.
- `src/components/BriefIntelligenceView.tsx` — edit mode, draft state, inputs, live totals, editable+overridable price, save/cancel, `onEditingChange`; import shared types.
- `src/pages/Scope.tsx` — supply `useDepartments()`, wire `useUpdateBriefIntelligence`, pause the poll and hide the action bar while editing.

## Testing

- Unit tests (`brief-estimate.test.ts`): `recomputeTotals` sums correctly; `computeEstimatedPriceCents` = Σ(high × rate) with rounding and missing-rate → 0.
- Manual verification in the running app via `/run`: enter edit mode, change hours → totals + computed price update live; override price → holds; reset link → restores computed; Save → persists and re-renders read-only; Cancel → discards; poll pause and action-bar hide behave; Approve still works after an edit.

## Money convention

`estimated_price_cents` is an integer in cents; format on the edge with `Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' })`. The price input works in ZAR and converts to/from cents at the edit boundary.

## Out of scope

- Editing `mapped_service_ids`, `suggested_services`, `services_snapshot`, `client_context_snap`, or `audit_trail`.
- Re-running or partially re-running the intake pipeline from the edit path.
- Recomputing price from service sell-prices (the app uses hours×rate / manual override).
- Any change to the Reject-and-regenerate flow.
