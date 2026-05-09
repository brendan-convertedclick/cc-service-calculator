# SOW Clause Seeding Guide

## What's already seeded

8 business-level defaults are live in the database (payment terms, revision rounds,
IP ownership, termination notice, kill fee, confidentiality, liability cap, payment schedule).

Verify at: `/settings` → SOW Clause Hierarchy section → click any family link.

## Service-family level overrides

`master_sows` uses `slug` as its primary key (no UUID), so service-family clause values
cannot be seeded via scope_id automatically. Two options:

### Option A: Via the UI (recommended for now)
1. Go to `/settings` → SOW Clause Hierarchy
2. Click a service family link (e.g. `paid-media-management`)
3. In the "Service Family" column, click any cell to set that family's override

Key overrides to set per family:

| Family | Clause | Override value |
|--------|--------|----------------|
| paid-media-management | payment_terms | Monthly in advance as part of retainer |
| paid-media-management | termination_notice_days | 60 |
| paid-media-management | min_monthly_fee_zar | 3500 |
| social-media-management | payment_terms | Monthly in advance as part of retainer |
| social-media-management | termination_notice_days | 60 |
| website-build | payment_terms | 50% upfront, 25% on design approval, 25% on go-live |
| video-3d-production | revision_rounds | 1 |
| seo-content | payment_terms | Monthly in advance for retainer; 50/50 for project |

### Option B: Add a UUID to master_sows (future migration)
Run a migration to add `id uuid default gen_random_uuid()` to `master_sows`,
then use that UUID as scope_id for service-family clause_values rows.
This would enable the seed script to be automated.

## Testing the RPC

```sql
select resolve_sow_clause('payment_terms');
-- Should return: { value: "50% upfront, 50% on completion", source_level_name: "Business" }

select resolve_sow_clause('revision_rounds');
-- Should return: { value: "2", source_level_name: "Business" }
```
