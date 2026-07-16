# Scope Coverage — intake-generated reasons + CE PDF coverage page

**Date:** 2026-07-16 · **Status:** approved (Approach A)

## Problem

Clients assume work is included when it isn't. The CE only shows priced
(new-billable) lines — the client never sees what their retainer already
covers, what was declined, or *why*. That gap is where scope creep lives.

## Decisions (from brainstorm)

1. **Audience:** client-facing.
2. **Delivery:** a dedicated page in the CE PDF, after the estimate page.
3. **Intake role:** intake does all the heavy lifting — it over-generates
   coverage reasoning and assumed exclusions; the operator only prunes
   (untick). **Verdicts stay deterministic**: `resolveDisposition` against the
   real allowance ledger remains the only authority on in/new/out.
4. **Assumed exclusions:** yes — intake proactively lists adjacent work a
   client would typically assume is bundled (e.g. landing page → copywriting,
   imagery, revision rounds) and flags what isn't covered.

## Architecture — placements as the single spine

Everything the client sees on the PDF is derived from
`brief_task_sow_placements`, the same rows the Scope Receipt (Stage 1)
confirms. No parallel structure; the receipt, CE and PDF can never disagree.

### 1. Data model (migration 0087)

`brief_task_sow_placements`:
- `client_reason text` — plain-language, client-safe "why" for the line's
  bucket ("Included in your retainer's 4 social posts/month", "Copywriting is
  not part of a landing-page build — quoted separately").
- `is_assumed boolean not null default false` — line was inferred as a
  likely-assumed adjacent task, not an explicit ask.
- `excluded boolean not null default false` — operator unticked the line;
  hidden from client view + PDF, dimmed in operator view. Survives re-analysis
  (upsert only updates supplied columns).

`brief_intelligence`:
- `assumed_exclusions jsonb` — array of
  `{ item_title, assumption, reason, mapped_services?: [{service_id, qty}] }`
  written by intake.

`requirements[]` entries gain optional `coverage_reason` (string) and
`expected_disposition` (`in_agreed_scope|new_billable|out_of_scope`).

### 2. Intake skill (new stage `scope-coverage.md`)

Runs after `extract-requirements`. Fetches the client's live coverage ledger
(`get-active-retainer`, `get-active-projects`) and writes, via
`set-brief-intelligence`:
- per requirement: `coverage_reason` (client-friendly why, grounded in the
  ledger) and `expected_disposition`;
- `assumed_exclusions`: for each requirement, the adjacent tasks a client
  typically assumes are bundled, each with a client-safe reason why it is not
  included (mapped to catalog services where possible so the resolver can
  classify them).

### 3. Seeding (edge, deterministic — no AI)

- `scope-disposition.ts` gains `defaultClientReason(disposition, resolver
  context)` — template fallback reasons.
- `intelligenceScopeItems` carries `coverage_reason` / `expected_disposition`
  per item and additionally emits one item per assumed exclusion with
  `is_assumed: true`.
- `analyze-brief-sow` persists `client_reason` + `is_assumed`. **Resolver-wins
  rule:** if intake's `expected_disposition` disagrees with
  `resolveDisposition`, the row gets the template reason instead of intake's
  prose and `needs_review = true`.

### 4. Scope Receipt UI (Stage 1)

- Lines render `client_reason` as the description subline in client view (and
  under the title in operator view).
- `is_assumed` lines get an "Assumed" chip (operator view).
- Every line gets an untick control → `excluded = true` (re-tickable; dimmed
  strike in operator view, gone from client view). Intake over-generates,
  operator reduces.

### 5. CE PDF (`render-ce-pdf`)

New second A4 page, "Scope of this estimate", built from the brief's
placements (`excluded = false`), three bands in fixed order:
1. **Covered by your current agreement** — in_agreed_scope lines + reasons.
2. **Quoted in this estimate** — new_billable lines (priced on page 1).
3. **Not included** — out_of_scope lines and assumed exclusions + reasons.

`ComposeEmail` prefill gains one sentence pointing the client at the coverage
page.

## Error handling

- Briefs with no intelligence (manual/legacy) still work: template reasons
  from the resolver, no assumed exclusions, PDF page renders from whatever
  placements exist.
- A CE with zero non-billable placements renders the coverage page with only
  the Quoted band (never an empty page — if there are no placements at all,
  skip the page).
- `set-brief-intelligence` JSON-string payloads: `assumed_exclusions` joins
  `JSON_FIELDS` boundary parsing.

## Testing

- `scope-disposition.test.ts`: `defaultClientReason` cases.
- `scope-receipt` view-model: excluded lines drop out of buckets/totals;
  assumed lines bucket normally.
- Manual e2e: seed intel on a test brief → analyze → receipt → untick → CE →
  PDF shows coverage page respecting unticks.

## Out of scope

- Public tokenized scope-view web page (PDF chosen for V1).
- Any LLM say in disposition.
- Backfilling reasons onto historical briefs.
