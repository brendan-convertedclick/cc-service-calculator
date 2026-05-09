# SOW Inheritance System — Design Spec

**Date:** 2026-05-09  
**Status:** Approved for implementation planning  
**Scope:** Structured, cascading Scope of Work clause system with user-defined hierarchy levels

---

## Problem

The agency has 9 master SoW documents in the wiki (paid media, creative, web build, SEO, social, hosting, analytics, video, automation). These exist only as markdown files — they are not queryable, not composable, and not usable by the AI brief intelligence system for in/out-of-scope classification. Payment terms, revision limits, and exclusions are repeated or referenced by link across documents with no enforcement.

The current `master_sows` table in the DB stores a full markdown body per service with no structure.

---

## What We're Building

A **clause-level inheritance system** — think CSS `@layer` applied to legal/operational SoW terms. Each clause (payment terms, revision count, exclusions list, IP ownership, termination notice, etc.) can be defined at any level in a user-defined hierarchy. The most specific level wins for scalar values; list values stack across all levels.

### Key distinction

- **SOW = service-level contract document** (generated once per service family, saved as a reference)
- **Brief = client-specific work order** (built per engagement, referencing the relevant SOW)

The SOW wizard produces the standing document. The brief flow consumes it.

---

## Design Decisions

### 1. User-defined hierarchy levels (CSS @layer model)

Users define named levels and set their priority order via drag-to-reorder. No fixed number of levels. Starting set: Business → Service Family → Client → Project. Users can add levels at any time (e.g. "Enterprise Tier", "Geography — ZA") and reorder without breaking anything — resolution recomputes on the fly.

Level types (`agency`, `service`, `client`, `project`) are optional organisational tags, not hard ordering constraints.

### 2. Hybrid editor: structured fields + freeform markdown sections

Each SOW document has:
- **Structured header fields** (machine-readable): revision count, pricing model, min fee, payment schedule, termination notice period, kill fee %
- **Freeform markdown sections** (human-readable): inclusions prose, exclusions prose, standard terms, trigger to start, completion definition

Structured fields feed the AI brief classifier directly. Freeform sections render in the PDF export.

### 3. Merge strategy lives on the clause type

Defined once in `clause_schema`, never per-value:
- `replace` — most specific level wins entirely (e.g. payment terms, revision count, IP ownership)
- `append` — all levels contribute; items stack from base to specific (e.g. exclusions list, inclusions list)

### 4. Provenance always visible

Every resolved clause shows its source level in the UI. No mystery about where a value came from. Edit-at-level modal asks "set this at project level or client level?" before writing.

---

## Data Model

### New tables

```sql
-- User-defined hierarchy levels
create table sow_levels (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                        -- e.g. "Business", "Retainer Family"
  slug        text not null unique,                 -- e.g. "business", "retainer-family"
  level_type  text not null                         -- 'agency' | 'service' | 'client' | 'project'
              check (level_type in ('agency','service','client','project')),
  priority    int  not null,                        -- lower = base, higher = more specific
  created_at  timestamptz not null default now()
);

-- Clause type definitions
create table clause_schema (
  key             text primary key,                 -- e.g. 'payment_terms', 'revision_rounds'
  label           text not null,
  value_type      text not null                     -- 'string' | 'number' | 'string[]' | 'boolean'
                  check (value_type in ('string','number','string[]','boolean')),
  merge_strategy  text not null default 'replace'
                  check (merge_strategy in ('replace','append')),
  section         text not null,                    -- 'commercial' | 'delivery' | 'legal' | 'scope'
  sort_order      int  not null default 0
);

-- Clause values at each level
create table clause_values (
  id          uuid primary key default gen_random_uuid(),
  clause_key  text not null references clause_schema(key),
  level_id    uuid not null references sow_levels(id) on delete cascade,
  -- Polymorphic FK to the entity this level value applies to:
  -- agency level → null (applies to everything)
  -- service level → services.id or a service family slug stored as text in value_text
  -- client level  → clients.id
  -- project level → projects.id
  scope_id    uuid,
  value_text  text,    -- for string and string[] (JSON array as text for arrays)
  value_number numeric,
  value_bool  boolean,
  updated_at  timestamptz not null default now(),
  unique (clause_key, level_id, scope_id)
);
```

### Seed data

On migration, extract clause values from existing `master_sows` markdown bodies and seed as `level_type = 'service'` rows. The `[[commercials]]` wikilink pattern maps to the agency-level layer.

### Existing tables — changes

- `master_sows`: add `service_family_slug text` FK column to map each master SoW to the relevant service family level.
- `services`: no changes needed; services already have a `rule_id` that groups them.

### Resolution function (Supabase RPC or Edge Function)

```typescript
resolveClause(clauseKey, schema, context: { projectId, clientId, serviceFamilySlug })
// For 'replace': walk levels highest→lowest priority, return first defined value
// For 'append': walk levels lowest→highest, collect all non-empty arrays, concat
// Returns: { value, sourceLevel, sourceLevelName }
```

---

## UI

### Levels manager (`/settings/sow-levels`)

- Vertical drag-sortable list of levels (highest priority top)
- Each level: name, type tag, scope
- "Add level" button — name it, pick a type tag, set position
- Delete level → prompt: "Promote 14 clause overrides to parent level, or discard?"

### SOW clause table (`/sow/[familySlug]`)

- Rows: clause keys from `clause_schema`
- Columns: one per level in priority order
- Cell states:
  - **Defined**: shows value, full opacity
  - **Inherited**: shows parent value, muted, italicised
  - **Empty + no parent**: shows "—", placeholder
- Rightmost column: **Resolved** — computed value + source level tag (colour-coded by level)
- Click any cell → inline edit for that level
- Click resolved value → modal showing full inheritance chain

### SOW document view (per service family)

- Structured fields panel (revision count, pricing model, etc.) above markdown sections
- Markdown sections: Inclusions, Exclusions, Standard Terms, Trigger to Start, Completion Definition
- "Export PDF" button → rendered document
- "Last updated" timestamp + who made the last change

---

## Integration with Brief Intelligence

When `set-brief-intelligence` runs for a brief, the AI prompt includes the resolved clause set for the relevant service family. The `requirements` array in `brief_intelligence` already stores `{text, interpretation, mapped_service_ids, confidence}` — add `in_scope: boolean` resolved against the clause's inclusions/exclusions.

The edge function resolves clauses server-side before building the prompt — structured data, not markdown prose. This halves the prompt token cost vs passing full markdown SoW bodies.

---

## Out of Scope for V1

- E-signature or client-facing acceptance flow on the SOW document
- Multi-currency clause values
- Version history / change log on individual clause values (only `updated_at`)
- Automated annual rate review reminders

---

## Open Questions (resolved)

- **4th level (client override)?** Yes — "Client" is one of the default levels. King's College can have 3 revisions instead of 2.
- **Inclusions/Exclusions — merge or replace?** Append. Items stack from all levels.
- **How many levels?** User-defined. Default set of 4. No hard cap.
