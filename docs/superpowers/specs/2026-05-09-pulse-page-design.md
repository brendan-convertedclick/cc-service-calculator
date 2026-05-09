# Business Pulse Page — Design Spec

**Date:** 2026-05-09  
**Status:** Approved  
**Route:** `/pulse`  
**Access:** Nav item (separate from existing dashboard/OpsOverview)

---

## Purpose

A dedicated morning screen for the Ops Manager. Scan top-to-bottom in under 30 seconds and know whether it's a normal day or something needs action. Red stops you, amber slows you, green means run.

This page does NOT replace the existing project tree + OpsOverview. It is a separate nav destination.

---

## Page Structure (top to bottom)

### 1. Critical Alerts Strip
Always rendered at the top. If there are zero alerts, shows a green "All clear" banner. If alerts exist, shows a red header with a count and individual alert rows.

**Alert types (in priority order):**
- `OVERDUE` (red) — invoice past due date and unpaid. Text: `"{Client} — Invoice {amount} overdue {X} days. Flag to account manager."`
- `WATCH` (amber) — retainer burn ≥ 85% with more than 5 days left in the month. Text: `"{Client} retainer — {X}% of hours burned with {N} days left in month."`
- `FLAG AM` (purple) — client with no touchpoint (email brief or logged meeting) for ≥ 21 days. Text: `"{Client} — No email or meeting in {X} days. Account manager should follow up."`

Alert rows are clickable and navigate to the relevant context (invoice → reconciliation, retainer → project detail, client → client page).

---

### 2. Retainer Burn (left column)

**Data model additions required:**
- `projects.retainer_hours_target` — numeric(6,2), the monthly hours target set by ops (e.g. 8h)
- `projects.retainer_monthly_fee_cents` — int, the monthly retainer fee (e.g. R10,000 = 1_000_000 cents). If null, falls back to the linked quote's `total_cents`. Ops can override by setting this field directly on the project form.
- Only shown for projects where `engagement_type = 'retainer'`

**Display per retainer client:**
- Client name + fee/month + hours target
- Burn bar: `actual_hours_this_month / retainer_hours_target` (%)
- RAG: green < 70%, amber 70–84%, red ≥ 85%
- Days remaining in current calendar month
- Effective hourly rate: `retainer_monthly_fee_cents / retainer_hours_target` (what we're paid per hour)
- Warning when burn pace implies overrun (projected hours at current pace > target with > 5 days left)
- "Under-utilised" note when burn < 40% with < 10 days left (client not getting value)

**Hook:** `usePulseRetainerBurn()` — returns `RetainerBurnRow[]` per retainer project for current month.

---

### 3. WIP Pipeline Funnel (right column)

Maps briefs and projects to funnel stages based on existing status fields:

| Stage | Condition |
|---|---|
| Received | Brief exists, `am_status` is null or `pending` |
| Scoping | Brief exists, `am_status = 'reviewing'` or intelligence in progress |
| Quoted | Quote exists with `status = 'draft'` or `'sent'` |
| Accepted | Quote `status = 'accepted'`, project `scope_status != 'completed'` |
| Delivered | Project `status = 'completed'` in rolling 30 days |

**Display:** Vertical bar chart, count per stage, purple gradient → green for Delivered. Each bar is clickable and opens a filtered list of the briefs/projects in that stage.

**Below the chart:**
- Brief-to-quote conversion rate (rolling 30 days): `accepted_quotes / total_briefs * 100`
- Average cycle time (existing `useAvgDftCycleTime` hook)

**Hook:** `usePulseWipFunnel()` — returns `{ stage: string, count: number, items: Brief[] | Project[] }[]`

---

### 4. AR Aging (left column)

Requires `xero_invoices` table (built in Phase 2). If Xero not connected, shows "Connect Xero to see AR aging" with link to Settings.

**Three buckets:**
- 0–30 days: sum of `amount_cents` where `due_date` between today and 30 days ago, status `AUTHORISED`
- 30–60 days: same, 30–60 days ago
- 60+ days: same, > 60 days ago (this is the danger zone)

**Display:** Three cards with RAG colouring (green / amber / red). Total outstanding below. Each card expandable to show individual invoices (client name, invoice number, amount, days overdue).

**Hook:** `usePulseArAging()` — returns `{ band: '0-30' | '30-60' | '60+', totalCents: number, invoices: XeroInvoice[] }[]`

---

### 5. Client Relationship Health (right column)

**Touchpoint sources (auto-tracked):**
- Last brief `created_at` for this client (inbound email)
- Last `xero_invoices.paid_at` (payment = active relationship)

**Manual touchpoints:**
- New table: `client_touchpoints (id, client_id, type ['meeting' | 'call' | 'email'], notes, occurred_at, created_by)`
- "Log meeting" button per client row — opens a simple modal: date + type + optional notes

**Display per client:**
- RAG dot: green < 14 days, amber 14–30 days, red > 30 days
- Client name
- Last touchpoint: type + days ago (e.g. "email 2 days ago", "meeting 34 days ago")
- Revenue trend arrow: ↑ / → / ↓ based on this month vs last month from `xero_invoices`

**Thresholds:** 21-day silence → `FLAG AM` alert generated. 30-day silence → red dot.

**Hook:** `usePulseClientHealth()` — returns `ClientHealthRow[]` sorted by days-since-contact descending.

---

### 6. Pricing Health (left column)

Two metric cards + per-client scope creep breakdown.

**Scope creep rate:**
- Definition: projects where `sum(actual_hours) > sum(planned_hours) * 1.10` (i.e. >10% over)
- Rolling 90 days, completed projects only
- Rate = `over_quota_projects / total_completed_projects * 100`
- Per-client breakdown as a mini bar chart

**Brief-to-quote conversion:**
- Rolling 30 days
- `accepted_quotes_count / briefs_received_count * 100`
- (This also appears in the WIP funnel summary — same number, surfaced twice for context)

**Hook:** `usePulsePricingHealth()` — returns `{ scopeCreepRate: number, conversionRate: number, byClient: { clientId, clientName, scopeCreepRate }[] }`

---

### 7. Revenue Trend (right column)

Per-client month-over-month revenue from `xero_invoices`. Requires Xero connection.

**Display per client:**
- Client name
- Mini sparkline (3 months of bars)
- MoM change %: `(this_month - last_month) / last_month * 100`
- This month total in ZAR
- Trend arrow: ↑ green ≥ +5%, → grey between -5% and +5%, ↓ red ≤ -5%

If Xero not connected: "Connect Xero to see revenue trends" with link to Settings.

**Hook:** `usePulseRevenueTrend()` — returns `RevenueTrendRow[]` per client, last 3 months of data.

---

## New Schema

```sql
-- Retainer fields on projects
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS retainer_hours_target    numeric(6,2),
  ADD COLUMN IF NOT EXISTS retainer_monthly_fee_cents int;

-- Manual client touchpoints
CREATE TABLE IF NOT EXISTS client_touchpoints (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('meeting', 'call', 'email')),
  notes        text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_touchpoints_client_id
  ON client_touchpoints(client_id);
CREATE INDEX IF NOT EXISTS idx_client_touchpoints_occurred_at
  ON client_touchpoints(occurred_at DESC);
```

---

## New Files

### Hooks (all in `src/hooks/`)
- `usePulseRetainerBurn.ts`
- `usePulseWipFunnel.ts`
- `usePulseArAging.ts`
- `usePulseClientHealth.ts`
- `usePulsePricingHealth.ts`
- `usePulseRevenueTrend.ts`
- `usePulseAlerts.ts` — aggregates alerts from all other hooks into a single sorted list

### Page
- `src/pages/PulseView.tsx` — main page, 7 sections, lazy-loaded

### Components
- `src/components/pulse/AlertsStrip.tsx`
- `src/components/pulse/RetainerBurnSection.tsx`
- `src/components/pulse/WipFunnelSection.tsx`
- `src/components/pulse/ArAgingSection.tsx`
- `src/components/pulse/ClientHealthSection.tsx`
- `src/components/pulse/PricingHealthSection.tsx`
- `src/components/pulse/RevenueTrendSection.tsx`
- `src/components/pulse/LogTouchpointModal.tsx`

### Route + Nav
- Route: `/pulse` added to `src/App.tsx`
- Nav item: `⚡ Pulse` added to `src/components/nav/navItems.ts`, positioned above Reconciliation

---

## Alert Thresholds (configurable in future)

| Alert | Threshold | Level |
|---|---|---|
| Invoice overdue | due_date < today, unpaid | OVERDUE (red) |
| Retainer overrun risk | burn ≥ 85%, > 5 days left | WATCH (amber) |
| Client silence | no touchpoint ≥ 21 days | FLAG AM (purple) |
| Client silence severe | no touchpoint ≥ 30 days | OVERDUE (red) |

---

## Graceful degradation

- Xero not connected → AR Aging and Revenue Trend show a "Connect Xero" prompt, not an error
- No retainer projects → Retainer Burn section shows "No retainer clients configured"
- No briefs → WIP Funnel shows empty state
- All sections render independently — one failing query does not crash the page

---

## Out of scope

- Push notifications / email digests of alerts (future)
- Configurable alert thresholds via UI (future)
- Account Manager task creation from the FLAG AM alert (future — AM role not yet built)
- Historical pulse snapshots / trend of the pulse itself (future)
