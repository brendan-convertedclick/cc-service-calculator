# Brief Intelligence Layer — Design Spec

**Date:** 2026-05-09
**Status:** Approved, ready for planning
**Repo:** cc-service-calculator
**Research base:** `wiki/research/agency-briefing-principles.md`, `wiki/research/orchestrated-agent-architecture.md`

---

## Problem

Briefs arrive in the Inbox as raw emails. The team currently has to manually interpret what the client wants, map it to services, estimate effort, and assign departments — all before a scope can be built. This keeps account management embedded in the execution chain, creating a bottleneck where every brief requires an AM to broker context to the delivery team.

The goal is a **Brief Intelligence Layer**: an AI-generated, structured interpretation of every brief that gives any team member enough context to execute without involving the AM. The AM becomes a single approval gate, not an ongoing communication channel.

---

## Core Principles

1. **The wiki IS the model update.** Every new service, pricing rule, or operating procedure added to the wiki is immediately available on the next intake run. No retraining, no deployment, no code change.
2. **Rules route; LLM generates.** Routing logic is explicit imperative rules in the orchestrator. LLMs run only inside stages — for interpretation and generation, not for deciding what to run next.
3. **The `brief_intelligence` row is the state.** `brief_id` is passed between stages, not a large context payload. Stages append fields; they never overwrite prior stages' output.
4. **`allowed-tools` enforces the boundary.** Each stage lists only the tools it needs. Policy is structural, not just instructional.
5. **Extensibility is additive.** New capability = new file in `stages/` + one new step in `SKILL.md`. New business knowledge = new or edited file in `references/`. No code changes required.

---

## Architecture Overview

```
Email arrives
  → gmail-relay stores brief (existing)
  → /intake skill tick picks it up (extended)
        ↓
  Stage 1: Classify intent          → writes intent_type to briefs
  Stage 2: Extract requirements     → writes requirements[] to brief_intelligence
  Stage 3: Generate work breakdown  → writes work_breakdown[] to brief_intelligence
  Stage 4: Synthesise estimates     → writes hours, price, confidence, open_questions
  Stage 5: Draft reply (if quick_response) → writes draft_reply to briefs
        ↓
  brief_intelligence row complete (am_status = 'pending')
  AM reviews on the Scope page → approves → scope created
```

---

## Section 1 — Data Model

### New table: `brief_intelligence`

```sql
CREATE TABLE brief_intelligence (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id        uuid NOT NULL UNIQUE REFERENCES briefs(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Stage 2 output: AI-generated interpretation
  summary              text,          -- 2–3 sentences in client language
  business_objective   text,          -- what success looks like for the client
  client_context_snap  jsonb,         -- snapshot of wiki client context at generation time

  -- Stage 2 output: parsed requirements mapped to services
  requirements    jsonb,
  -- Array of:
  -- {
  --   text: string,                  -- client's ask in their language
  --   interpretation: string,        -- internal translation
  --   mapped_service_ids: uuid[],    -- matched services from catalog
  --   confidence: 'low'|'med'|'high'
  -- }

  -- Stage 3 output: work breakdown per department
  work_breakdown  jsonb,
  -- Array of:
  -- {
  --   department_id: uuid,
  --   department_name: string,
  --   deliverables: [{ name, format, quantity, platform, acceptance_criteria, revision_rounds }],
  --   tasks: [{ title, description, service_id, process_step_id, is_ai_eligible }],
  --   human_hours_low:  number,      -- optimistic (O in PERT)
  --   human_hours_mid:  number,      -- most likely (M in PERT)
  --   human_hours_high: number,      -- pessimistic (P in PERT)
  --   ai_hours:         number,      -- AI-eligible hours × 0.5 multiplier
  --   suggested_assignee_id: uuid | null
  -- }

  -- Stage 4 output: rolled-up estimation
  total_human_hours_low   numeric(6,2),
  total_human_hours_mid   numeric(6,2),
  total_human_hours_high  numeric(6,2),
  total_ai_hours          numeric(6,2),
  estimated_price_cents   integer,
  confidence_level        text CHECK (confidence_level IN ('low','medium','high')),
  open_questions          jsonb,       -- [{ question: string, context: string }]

  -- Stage 4 output: capacity signal
  inferred_start_date     date,
  inferred_deadline       date,
  priority_tier           text CHECK (priority_tier IN ('urgent','standard','flexible')),

  -- AM approval gate
  am_status       text NOT NULL DEFAULT 'pending'
                  CHECK (am_status IN ('pending','approved','rejected')),
  am_reviewed_at  timestamptz,
  am_reviewed_by  uuid REFERENCES team_members(id),
  am_notes        text,               -- populated on rejection; fed back into re-generation

  -- Pipeline metadata
  pipeline_version  text,             -- semver of the intake skill that generated this
  services_snapshot jsonb,            -- matched services at generation time (self-contained)
  audit_trail       jsonb NOT NULL DEFAULT '[]'
  -- Array of: { stage, completed_at, duration_ms, confidence, notes }
);

CREATE INDEX brief_intelligence_brief_id_idx ON brief_intelligence(brief_id);
CREATE INDEX brief_intelligence_am_status_idx ON brief_intelligence(am_status);
```

**Key decisions:**
- `brief_id` is `UNIQUE` — strictly 1:1. Re-generation upserts, never appends.
- `work_breakdown` and `requirements` are JSONB — the schema can evolve without migrations as AI output improves.
- `services_snapshot` makes the record self-contained even if the catalog changes after generation.
- `audit_trail` records every stage: what ran, when, how long, and with what confidence. Termination check: if a stage already appears in `audit_trail` with `confidence >= 0.7`, skip it on re-run.
- On AM rejection: `am_notes` is appended to the Stage 2 prompt as correction context and the pipeline re-runs (upsert).

### No changes to existing tables

`briefs`, `scopes`, `messages`, `services`, `process_steps` are unchanged. The intelligence layer slots in between briefs and scopes via the foreign key chain.

---

## Section 2 — Skill Architecture

The `/intake` skill evolves from a single-file skill into a **multi-file orchestrated plugin**.

### Directory structure

```
~/.claude/skills/intake/
  SKILL.md                        # Orchestrator — routes, sequences, tick loop, reports
  │
  stages/
  │  classify-intent.md           # Stage 1 (promoted from references/)
  │  extract-requirements.md      # Stage 2 — NEW
  │  generate-work-breakdown.md   # Stage 3 — NEW
  │  synthesise-estimates.md      # Stage 4 — NEW (arithmetic, minimal LLM)
  │  draft-reply.md               # Stage 5 (promoted from references/)
  │
  references/
     intent-classification.md     # EXISTING — five types, pre-filter rules
     failure-modes.md             # EXISTING — per-condition error handling
     business-rules.md            # NEW — retainer vs project logic, escalation triggers
     department-routing.md        # NEW — dept taxonomy, service → dept routing keys
     estimation-rules.md          # NEW — PERT tiers, AI multiplier (0.5), confidence scoring
     service-catalog-format.md    # NEW — how to query + interpret the services catalog
     client-context-format.md     # NEW — how to read + apply wiki client pages
```

### Orchestrator responsibilities (SKILL.md)

The orchestrator handles **routing and sequencing only** — it does not generate content. Its instruction body is explicit imperative rules:

```
For each new inbound brief:
  1. Run Stage 1 (classify-intent) — always
  2. If intent_type == 'quick_response':
       Run Stage 5 (draft-reply) only — skip 2, 3, 4
  3. Otherwise:
       Run Stage 2 (extract-requirements)
       Run Stage 3 (generate-work-breakdown)
       Run Stage 4 (synthesise-estimates)
  4. Append completed stage to audit_trail
  5. On any stage failure: log to audit_trail, skip remaining stages,
     set confidence_level = 'low', continue to next brief
```

### Stage contracts

Each stage file declares its interface at the top:

```
Reads:  brief.raw_body, brief.sender_email, client_context_snap, [prior stage outputs]
Writes: requirements[] on brief_intelligence
Tools:  mcp__cc-vault__read_note, mcp__cc-supabase__execute_sql
```

No stage references another stage by name. The orchestrator sequences; stages are stateless workers.

### Extensibility rules

- **New stage:** Add `stages/new-stage.md`, add one routing step to `SKILL.md`. Existing stages untouched.
- **New business rule:** Add or edit a file in `references/`. Available on next run.
- **New service type:** Update `references/department-routing.md`. No code change.
- **New intent type:** Update `references/intent-classification.md` and `stages/classify-intent.md`.
- **Breaking change to a stage:** Bump `pipeline_version` in SKILL.md frontmatter. The `audit_trail` records which version generated each row.

---

## Section 3 — Generation Flow

### Stage 1 — Classify intent (existing, promoted)

**Input:** `brief.raw_body`, `brief.raw_subject`, `brief.sender_email`
**Context loaded:** `references/intent-classification.md`
**Output:** `intent_type` written to `briefs` table
**LLM call:** Yes — classification with closed label set (90%+ accuracy)
**Fallback:** If confidence < 0.6, set `intent_type = 'general_query'`

### Stage 2 — Extract requirements

**Input:** `brief.raw_body`, wiki client context, services catalog (names + departments + sell_price_cents)
**Context loaded:** `references/service-catalog-format.md`, `references/client-context-format.md`
**Output:** `summary`, `business_objective`, `client_context_snap`, `requirements[]` written to `brief_intelligence`
**LLM call:** Yes — requires understanding of client language and service catalog mapping
**Prompt pattern:**
```
Role: Senior account manager at Converted Click.
Context: [client wiki page] [services catalog — name, dept, price]
Task: Given this client email, extract:
  1. A 2–3 sentence summary in client language
  2. Their business objective
  3. Each distinct requirement, mapped to services from the catalog
Output schema: { summary, business_objective, requirements[] }
Few-shot: [2–3 examples from past briefs]
```

### Stage 3 — Generate work breakdown

**Input:** `requirements[].mapped_service_ids`, `process_steps` for each matched service
**Context loaded:** `references/department-routing.md`, `references/estimation-rules.md`
**Output:** `work_breakdown[]` written to `brief_intelligence`
**LLM call:** Minimal — process steps are fetched from DB directly; LLM groups by department and adds deliverable specs
**Key principle:** The services catalog and process_steps do the heavy lifting — Claude groups and labels, it does not invent tasks

### Stage 4 — Synthesise estimates

**Input:** `work_breakdown[]` from Stage 3
**Context loaded:** `references/estimation-rules.md`
**Output:** All estimation fields + capacity signal + open_questions + `confidence_level`
**LLM call:** No — pure arithmetic:
```
total_human_hours_mid = sum(dept.human_hours_mid for dept in work_breakdown)
total_ai_hours = sum(dept.ai_hours for dept in work_breakdown)
estimated_price_cents = sum(sell_price_cents for service in matched_services)
confidence_level:
  high   → all requirements mapped to services, no open_questions
  medium → ≥80% mapped, ≤2 open_questions
  low    → <80% mapped OR >2 open_questions
```
Open questions are surfaced from Stage 2 where client language was ambiguous and no service matched.

### Stage 5 — Draft reply (quick_response only, existing)

No change to existing logic. Promoted from `references/intent-classification.md` to its own stage file.

---

## Section 4 — UI (Scope Page Redesign)

The existing `/briefs/:id/scope` route becomes the **Brief Intelligence View**.

### Layout

```
/briefs/:id/scope

← Inbox    [Client Name]  [intent badge]  [confidence: HIGH/MED/LOW]

┌─ Brief Summary ──────────────────────────────────────────────────┐
│ AI-generated 2–3 sentence synthesis in client language           │
│ Business objective: what success looks like for the client        │
└──────────────────────────────────────────────────────────────────┘

┌─ Requirements ───────────────────────────────────────────────────┐
│ ● "We need social content for the launch"                        │
│     → Social Content Creation · Creative Direction · Scheduling  │
│ ● "And a landing page"                                           │
│     → Landing Page Design · Web Development                      │
└──────────────────────────────────────────────────────────────────┘

┌─ Work Breakdown ─────────────────────────────────────────────────┐
│ Creative  ──────────────────────────  12–16 hrs  (6 hrs AI)     │
│   ∟ Social carousel designs (3 × Instagram, PNG 1080×1080)       │
│   ∟ Landing page design (Figma → handoff)                        │
│ Development  ───────────────────────   8–12 hrs  (2 hrs AI)     │
│   ∟ Landing page build (Webflow, responsive)                      │
│ Strategy  ──────────────────────────   4–6 hrs   (0 hrs AI)     │
│   ∟ Campaign brief · Audience research                            │
└──────────────────────────────────────────────────────────────────┘

┌─ Estimate ───────────────────────────────────────────────────────┐
│ Human hours: 24–34 hrs   AI hours: 8 hrs                        │
│ Estimated price: R 28,500                                        │
│ Timeline inferred: start flexible · deadline not specified        │
└──────────────────────────────────────────────────────────────────┘

┌─ Open Questions ─────────────────────────────────────────────────┐
│ ⚠ Which social platforms? (Instagram assumed)                    │
│ ⚠ Is the landing page a new domain or existing site?             │
└──────────────────────────────────────────────────────────────────┘

┌─ AM Review ──────────────────────────────────────────────────────┐
│ [Notes for rejection (optional)]                                  │
│          [Reject — regenerate]         [Approve → create scope]  │
└──────────────────────────────────────────────────────────────────┘
```

### States

| `am_status` | What the page shows |
|---|---|
| `pending` (intelligence generating) | Skeleton with "Analysing brief…" |
| `pending` (intelligence ready) | Full view with Approve / Reject actions |
| `approved` | Read-only view + "View Scope →" link |
| `rejected` | Read-only with AM notes + "Regenerating…" if re-running |

### Behaviour on approval

Clicking "Approve → create scope" calls the existing scope creation flow, pre-populated from `work_breakdown[]` and `requirements[]`. The intelligence layer becomes the seed data for the scope — no re-entry of information.

---

## Section 5 — New MCP Tool: `set-brief-intelligence`

The intake skill writes the `brief_intelligence` record via a new MCP tool (rather than raw SQL, keeping the MCP server as the data access layer).

```typescript
// mcp-server/src/tools/set-brief-intelligence.ts
// Input: brief_id + all brief_intelligence fields
// Behaviour: upsert on brief_id (insert or update)
// Returns: { id, brief_id, am_status, created: boolean }
```

This tool is added to `allowed-tools` in `SKILL.md` and each relevant stage file.

---

## Section 6 — What Gets Built First (V1 Scope)

**In scope for V1:**
- `brief_intelligence` table + migration
- `set-brief-intelligence` MCP tool
- Stage 1 promoted to `stages/classify-intent.md` (refactor, no new logic)
- Stage 2 — extract-requirements (new)
- Stage 3 — generate-work-breakdown (new)
- Stage 4 — synthesise-estimates (new, arithmetic only)
- Stage 5 promoted to `stages/draft-reply.md` (refactor, no new logic)
- Reference files: `business-rules.md`, `department-routing.md`, `estimation-rules.md`, `service-catalog-format.md`, `client-context-format.md`
- Scope page UI redesign to display `brief_intelligence`
- AM approval action (approve → create scope, reject → re-run)

**Out of scope for V1:**
- Subagent parallelism within Stage 3 (run departments in parallel) — add when catalog > 50 matched services per brief
- Historical few-shot retrieval (RAG over past briefs) — add once 20+ briefs have been processed
- Capacity check against current team load — add once Float/Resource Guru integration exists
- Auto-routing brief to department leads on approval — add in V2

---

## Research Basis

- `wiki/research/agency-briefing-principles.md` — 10-agent synthesis on brief formats, estimation, RACI, deliverable specs, RAG enrichment, capacity planning, retainer vs project
- `wiki/research/orchestrated-agent-architecture.md` — 4-agent synthesis on orchestration patterns, skill architecture, business brain design, context passing
