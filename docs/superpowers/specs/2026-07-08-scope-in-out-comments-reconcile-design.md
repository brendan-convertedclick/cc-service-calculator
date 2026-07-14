# Scope In/Out + Per-Section Comments + Daily SOW/Wiki Reconcile — Design

**Date:** 2026-07-08
**Status:** Approved (autonomous build per user directive "build in a workflow e2e, dont ask questions, i will review at the end")

## Problem

Now that briefs are created by the intake skill, the AM reviewing a brief on the
Scope screen needs to:

1. **Choose what is in vs out of scope** on the brief, and have that update the
   brief's price/hours — with **out-of-scope work quoted separately** (an
   "additional quote"), not silently dropped.
2. **Leave a comment to the right of every section** of the brief review. These
   comments are feedback destined for the **SOW** and the **wiki**.
3. Have a **skill run once a day** that reads this information (the in/out
   decisions + the comments) and **makes adjustments in the SOW and the wiki**
   accordingly.

## Architecture (three subsystems)

### A. In/out-of-scope selection → brief price + out-of-scope quote

**Key constraint discovered:** hours live **only at the department level** in
`brief_intelligence.work_breakdown[]` (deliverables/tasks carry no hours).
`estimated_price_cents = Σ(dept.human_hours_high × departments.hourly_rate_cents)`.
Therefore the pricing-accurate unit of in/out selection is the **department
(work-stream)**.

- **Data:** add an optional `in_scope?: boolean` to `DeptBreakdown`
  (`src/types/brief-intelligence.ts`). **Missing = in-scope** — so every existing
  brief renders and prices exactly as before (zero migration, the field is a new
  key inside the existing `work_breakdown` JSONB column).
- **Estimate math** (`src/lib/brief-estimate.ts`):
  - `recomputeTotals` and `computeEstimatedPriceCents` now sum **in-scope
    departments only** (default-in-scope preserves current results; existing
    tests still pass).
  - New `computeOutOfScopeTotals` and `computeOutOfScopePriceCents` sum the
    out-of-scope departments — the "additional quote".
  - `isDeptInScope(d) = d.in_scope !== false`.
- **UI** (`BriefIntelligenceView.tsx`):
  - Read mode: each department shows an In/Out **badge**; out-of-scope
    departments render muted + struck-through.
  - Edit mode: each department gets an **In scope / Out of scope** toggle
    (`updateDept(i, { in_scope })`).
  - Estimate section: headline price/hours = in-scope. If any department is
    out-of-scope, a second **"Out of scope — additional quote"** line shows the
    summed out-of-scope hours × rate.
  - `handleSave` stores the **in-scope** totals + price (the manual-override path
    is unchanged: a touched price still wins). Out-of-scope figures are **derived**
    everywhere (UI, MCP, skill) from `work_breakdown` + department rates — never
    stored, so they can never drift.

### B. Per-section comments (feedback for SOW + wiki)

- **Table `brief_feedback`** (migration `0078`): a real table (not JSONB) because
  the daily job queries "all open feedback across briefs". Columns:
  `id, brief_id (fk→briefs cascade), section_key text, body text,
  target text check(sow|wiki|both) default 'both',
  status text check(open|applied|dismissed) default 'open',
  author_id uuid fk→team_members set null, applied_at, applied_note,
  created_at, updated_at`. `tg_touch_updated_at` trigger; RLS `authed_all`
  (mirrors `brief_intelligence`, so the shared login can read/write).
- **Section keys** (the 5 review sections):
  `summary | requirements | work_breakdown | estimate | open_questions`.
- **Types** `src/types/brief-feedback.ts`; **hook** `src/hooks/useBriefFeedback.ts`
  (untyped-cast pattern, same as `useSowComposer` — the table isn't in generated
  `db.ts`).
- **UI** `src/components/SectionComments.tsx`: a fixed-width (`w-64`) right-hand
  rail rendered beside each section (in **both** read and edit trees). Collapsible;
  shows the thread + a composer (textarea + target select). Comment writes touch
  the independent `brief-feedback` query only — **never** the paused
  `brief-intelligence` query — so they can't clobber an in-flight edit draft.
  `Scope.tsx` container widens `max-w-5xl → max-w-6xl` to fit the rail; passes the
  `briefId`.

### C. Daily SOW/wiki reconcile

- **MCP tools** (`mcp-server/src/tools/`):
  - `list-brief-feedback` `{ status='open', brief_id?, limit? }` → each feedback row
    enriched with brief `{id, raw_subject, client_id}`, client `{name}`, and the
    brief's **scope snapshot**: in-scope departments, out-of-scope departments
    (name, high hours, rate, line cents), `estimated_price_cents` (in-scope) and
    the derived `out_of_scope_price_cents`. One call = full context.
  - `resolve-brief-feedback` `{ feedback_id, status: applied|dismissed, applied_note? }`.
  - Both registered in `mcp-server/src/index.ts`.
- **Skill** `~/.claude/skills/sow-wiki-reconcile/SKILL.md` (skills are user-global;
  the repo ships none). Procedure: pull open feedback → group by brief/client →
  for `target ∈ {sow, both}` update the Composer `sow_documents` row for that brief
  (draft only; refresh exclusions from out-of-scope, refresh the billable
  service_table, respect manual edits) via `mcp__cc-supabase__*`; for
  `target ∈ {wiki, both}` patch the client's project SoW + account-engagement brief
  (Change Log row, Pending-scope / Open-items sections) via `mcp__cc-vault__*` →
  `resolve-brief-feedback` each row with an `applied_note`. Idempotent, dry-run
  aware.
- **Schedule:** a daily `CronCreate({ cron: '0 7 * * *', prompt: '/sow-wiki-reconcile',
  recurring: true })`. (CronCreate is session-scoped and expires after 7 days; the
  skill documents the `/loop` and pg_cron alternatives for durable unattended runs.)

## Explicit non-goals (bounded for this build)

- No unification of the two scope representations (`brief_intelligence.work_breakdown`
  vs `brief_task_sow_placements`); the reconcile edits the SOW body directly.
- In/out is **department-level**, not per-deliverable (deliverables have no hours,
  so they can't move price). Noted as a future extension.
- Reconcile is driven by **explicit open feedback rows** (the comment is the
  instruction); pure scope-change-without-comment triggering is a future extension.
- No new durable scheduler infra beyond CronCreate.

## Verification

- `vitest` (brief-estimate in/out split), `tsc -b` (no new errors).
- Playwright walkthrough on :5391 against a real brief: toggle a department out →
  price drops + additional-quote appears → save → DB reflects it; add a comment on
  each section → row lands in `brief_feedback`; `list-brief-feedback` returns it
  enriched. Restore any real brief to its original state afterward.
- Adversarial review workflow over the diff.
