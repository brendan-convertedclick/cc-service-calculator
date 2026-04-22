# Project Intake & Builder — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing CC Service Calculator so a staff user can take a manually-entered client brief end-to-end (intake → triage → scope → builder → SOW PDF → mailto send → accept → ClickUp push → burn dashboard) without opening a Claude Code session.

**Architecture:** Additive schema migrations on top of the existing Supabase project. React Router routes added to the existing AppShell. TanStack Query hooks per new table. Six new Deno Edge Functions (three Anthropic-backed, one PDF renderer, two ClickUp-facing). Integrations gated by a singleton `settings` row read through `useSettings`; all toggles default OFF except `anthropic_enabled`.

**Tech Stack:** Vite 6 + React 18.3 + TypeScript 5.7 (strict) + Tailwind 3.4 + shadcn/ui + Supabase JS + Supabase Edge Functions (Deno) + TanStack Query 5 + React Hook Form + Zod + Vitest + `@react-pdf/renderer` (new) + `@uiw/react-md-editor` (new) + `cmdk` (already installed).

**Scope:** Phase 1 only. Phase 1b (email intake webhook), Phase 2 (Xero OAuth activation, burn alerts), and Phase 3 (envelope-driven `/brief` refactor, variance feedback) are explicitly out of scope; separate plans will be commissioned.

**Supabase operations:** This repo is pinned to project `lpgwxacoqiqpcfpkklib`. Use **`mcp__cc-supabase__*`** tools exclusively (never `mcp__supabase__*`). Migrations are applied via `mcp__cc-supabase__apply_migration`; Edge Functions are deployed via `mcp__cc-supabase__deploy_edge_function`. After each schema migration, regenerate types with `mcp__cc-supabase__generate_typescript_types` and write the result to `src/types/db.ts`.

**Migration numbering note:** Spec §17 lists `0004_intake_pipeline.sql`–`0008_list_aliases.sql`, but the repo already ships `0004_compound_services.sql`. This plan uses `0005`–`0010` instead. The migration filename **is not** the `name:` argument to `apply_migration` — use descriptive names like `intake_pipeline`, `quotes`, etc.

**Test policy:**
- Pure logic (quote math, snapshot builder, list-alias resolver, mailto builder, Jaccard token overlap) is TDD: test first, fail, implement, pass, commit.
- UI pages and hooks are built then verified by a manual smoke checklist at the route. No enzyme-style DOM tests — the existing repo has none and adding them is out of scope.
- Edge Functions get a structural smoke test (deploy + local `curl` with a stub payload) plus one happy-path end-to-end verification when the dependent UI lands.
- `npm run typecheck` and `npm run lint` must pass at every commit boundary.

**Commit policy:** Commit per task (not per step). Each task is one atomic change. Commit message format follows the repo's convention: `feat: …`, `fix: …`, `chore: …` (lowercase, no scope prefix, no emoji).

---

## File structure — what gets created/modified

```
cc-service-calculator/
├── package.json                                    # add deps
├── src/
│   ├── App.tsx                                     # add 9 new routes
│   ├── components/
│   │   ├── AppShell.tsx                            # add nav links
│   │   ├── FeatureFlagGate.tsx                     # NEW: hide children when flag off
│   │   ├── BriefRow.tsx                            # NEW: inbox row + triage actions
│   │   ├── ScopeEditor.tsx                         # NEW: four-section MD editor
│   │   ├── QuoteLineEditor.tsx                     # NEW: quote_services row editor
│   │   ├── SOWPreview.tsx                          # NEW: rich-text SOW editor + preview
│   │   ├── AISuggestModal.tsx                      # NEW: suggest-services accept/reject
│   │   ├── BurnChart.tsx                           # NEW: planned vs actual bars
│   │   └── ui/                                     # add: textarea, select, tabs, popover,
│   │                                               #      command, combobox, sheet, separator,
│   │                                               #      switch, table, skeleton, toast
│   ├── content/
│   │   ├── email-templates.ts                      # NEW: needs-info + send-quote bodies
│   │   └── sow-template.tsx                        # NEW: PDF document frame
│   ├── data/
│   │   └── master-sows.json                        # NEW: generated, checked in
│   ├── hooks/
│   │   ├── useBriefs.ts                            # NEW
│   │   ├── useScopes.ts                            # NEW
│   │   ├── useQuotes.ts                            # NEW
│   │   ├── useProjects.ts                          # NEW
│   │   ├── useSettings.ts                          # NEW
│   │   ├── useClients.ts                           # NEW
│   │   └── useCurrentUserName.ts                   # NEW: hardcoded "Brendan"
│   ├── lib/
│   │   ├── quotes.ts                               # NEW: margin math, snapshot builder
│   │   ├── quotes.test.ts                          # NEW
│   │   ├── mailto.ts                               # NEW
│   │   ├── mailto.test.ts                          # NEW
│   │   ├── clickup-shared.ts                       # NEW: alias resolver + BRIEF:: builder
│   │   ├── clickup-shared.test.ts                  # NEW
│   │   ├── scope-overlap.ts                        # NEW: Jaccard
│   │   └── scope-overlap.test.ts                   # NEW
│   ├── pages/
│   │   ├── Inbox.tsx                               # NEW
│   │   ├── NewBrief.tsx                            # NEW
│   │   ├── Scope.tsx                               # NEW
│   │   ├── ProjectBuilder.tsx                      # NEW
│   │   ├── QuoteSend.tsx                           # NEW
│   │   ├── QuoteDetail.tsx                         # NEW
│   │   ├── Projects.tsx                            # NEW
│   │   ├── ProjectDetail.tsx                       # NEW
│   │   └── Settings.tsx                            # NEW
│   └── types/
│       └── db.ts                                   # regenerated after each migration
├── supabase/
│   ├── migrations/
│   │   ├── 0005_intake_pipeline.sql                # clients, contacts, briefs, scopes
│   │   ├── 0006_quotes.sql                         # quotes, quote_services
│   │   ├── 0007_projects_and_actuals.sql
│   │   ├── 0008_settings.sql
│   │   ├── 0009_list_aliases.sql
│   │   └── 0010_storage_buckets.sql
│   └── functions/
│       ├── draft-scope/index.ts                    # NEW
│       ├── suggest-services/index.ts               # NEW
│       ├── draft-sow/index.ts                      # NEW
│       ├── render-sow-pdf/index.ts                 # NEW
│       ├── push-to-clickup/index.ts                # NEW
│       └── sync-clickup-actuals/index.ts           # NEW (scheduled)
└── scripts/
    └── sync-sows.ts                                # NEW: wiki/sow/*.md → master-sows.json
```

---

## Task 1: Install new dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime deps**

```bash
npm install @react-pdf/renderer @uiw/react-md-editor @radix-ui/react-switch @radix-ui/react-scroll-area
```

- [ ] **Step 2: Install dev deps (for PDF spike — react-pdf ships its own types)**

No extra devDeps required. Verify with `npm ls @react-pdf/renderer` that the package resolved.

- [ ] **Step 3: Verify build still passes**

```bash
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add pdf renderer + md editor + extra radix primitives"
```

---

## Task 2: Add missing shadcn/ui components

The existing repo has `badge`, `button`, `card`, `dialog`, `input`, `label`. Phase 1 needs several more. Copy each from the shadcn/ui reference (https://ui.shadcn.com/docs/components) — or hand-port using the same CVA pattern as existing `button.tsx`.

**Files to create:**
- `src/components/ui/textarea.tsx`
- `src/components/ui/select.tsx`          (Radix Select wrapper)
- `src/components/ui/tabs.tsx`            (Radix Tabs wrapper)
- `src/components/ui/popover.tsx`         (Radix Popover wrapper)
- `src/components/ui/command.tsx`         (cmdk wrapper; needed for combobox)
- `src/components/ui/combobox.tsx`        (Popover + Command pattern)
- `src/components/ui/separator.tsx`       (Radix Separator wrapper)
- `src/components/ui/switch.tsx`          (Radix Switch wrapper)
- `src/components/ui/table.tsx`           (plain table primitives)
- `src/components/ui/skeleton.tsx`        (pulsing block)
- `src/components/ui/sonner.tsx`          (Toaster is already mounted in App.tsx; this is a no-op if present — skip if already exists)

- [ ] **Step 1: Copy reference implementations**

Use the shadcn/ui CLI mental model — one file per primitive, CVA for variants, Tailwind tokens mapped to the M3 roles already defined in `src/styles/tokens.css`. Where the reference uses `bg-background`, leave it as-is; those aliases already route through the M3 variable layer.

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui
git commit -m "feat: add shadcn primitives needed by phase 1 pages"
```

---

## Task 3: `useCurrentUserName` hook (hardcoded for MVP)

**Files:**
- Create: `src/hooks/useCurrentUserName.ts`

- [ ] **Step 1: Write hook**

```ts
/**
 * Phase 1 attribution stub. Returns the name string used in
 * briefs.triaged_by, scopes.locked_by, quotes.accepted_by.
 *
 * When per-user Supabase auth lands, swap this implementation for one
 * that reads the session user's profile; call sites stay unchanged.
 */
export function useCurrentUserName(): string {
  return "Brendan";
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useCurrentUserName.ts
git commit -m "feat: add useCurrentUserName stub for mvp attribution"
```

---

## Task 4: Migration `0005_intake_pipeline.sql` — clients, contacts, briefs, scopes

**Files:**
- Create: `supabase/migrations/0005_intake_pipeline.sql`

- [ ] **Step 1: Write migration**

```sql
-- 0005_intake_pipeline.sql
-- Apply via mcp__cc-supabase__apply_migration (name: intake_pipeline)

create type public.brief_status as enum (
  'new', 'triaged', 'spam', 'needs_info', 'scoped',
  'quoted', 'accepted', 'rejected', 'archived'
);
create type public.brief_source as enum ('email', 'manual');

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  primary_domain text unique,
  xero_contact_id text,
  clickup_folder_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index clients_primary_domain_idx on public.clients (primary_domain);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  email text not null,
  full_name text,
  role text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index contacts_client_email_idx on public.contacts (client_id, email);

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id),
  source public.brief_source not null,
  received_at timestamptz not null default now(),
  sender_email text,
  raw_subject text,
  raw_body text not null,
  raw_attachments jsonb,
  gmail_thread_id text,
  status public.brief_status not null default 'new',
  triaged_by text,
  triaged_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index briefs_status_received_idx on public.briefs (status, received_at desc);
create index briefs_client_idx on public.briefs (client_id);

create table public.scopes (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.briefs(id) on delete cascade unique,
  enhanced_prose text,
  in_scope_md text,
  out_of_scope_md text,
  open_questions_md text,
  ai_drafted boolean not null default false,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Single-brief guard: once status > 'triaged', client_id must be set.
-- Enforced at app layer (simpler to message nicely in UI) plus this assertion
-- on lock/finalise writes. No trigger in Phase 1.
```

- [ ] **Step 2: Apply migration**

Use the MCP tool:

```
mcp__cc-supabase__apply_migration with name="intake_pipeline" and query=<file contents>
```

Expected: success response. If it fails, inspect error and iterate.

- [ ] **Step 3: Regenerate types**

```
mcp__cc-supabase__generate_typescript_types
```

Write the returned TypeScript to `src/types/db.ts` (overwrite). Run `npm run typecheck` — expected: exit 0 (existing code should not break because all changes are additive).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0005_intake_pipeline.sql src/types/db.ts
git commit -m "feat: intake pipeline schema (clients, contacts, briefs, scopes)"
```

---

## Task 5: Migration `0006_quotes.sql` — quotes + quote_services

**Files:**
- Create: `supabase/migrations/0006_quotes.sql`

- [ ] **Step 1: Write migration**

```sql
-- 0006_quotes.sql
-- Apply via mcp__cc-supabase__apply_migration (name: quotes)

create type public.quote_status as enum (
  'draft', 'sent', 'accepted', 'rejected', 'superseded'
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references public.scopes(id),
  version int not null default 1,
  status public.quote_status not null default 'draft',
  sow_html text,
  sow_pdf_url text,
  line_items_jsonb jsonb not null default '[]'::jsonb,
  subtotal_cents bigint not null default 0,
  margin_pct numeric(5,2) not null default 0,
  discount_room_pct numeric(5,2) not null default 0,
  total_cents bigint not null default 0,
  xero_quote_id text,
  sent_at timestamptz,
  accepted_at timestamptz,
  accepted_by text,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quotes_scope_version_idx on public.quotes (scope_id, version);
-- One non-superseded quote per scope at any time.
create unique index quotes_one_live_per_scope_idx
  on public.quotes (scope_id) where status <> 'superseded';

create table public.quote_services (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  service_id uuid not null references public.services(id),
  qty numeric(8,2) not null default 1,
  hours_override jsonb,
  allocation_override jsonb,
  notes text,
  ordinal int not null,
  created_at timestamptz not null default now()
);
create index quote_services_quote_ordinal_idx on public.quote_services (quote_id, ordinal);
```

- [ ] **Step 2: Apply migration** — same process as Task 4 (`mcp__cc-supabase__apply_migration`, name `quotes`).

- [ ] **Step 3: Regenerate `src/types/db.ts`** + `npm run typecheck`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0006_quotes.sql src/types/db.ts
git commit -m "feat: quotes + quote_services schema"
```

---

## Task 6: Migration `0007_projects_and_actuals.sql`

**Files:**
- Create: `supabase/migrations/0007_projects_and_actuals.sql`

- [ ] **Step 1: Write migration**

```sql
-- 0007_projects_and_actuals.sql
-- Apply via mcp__cc-supabase__apply_migration (name: projects_and_actuals)

create type public.project_status as enum ('in_progress', 'completed', 'cancelled');

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) unique,
  clickup_parent_task_id text not null,
  status public.project_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_actuals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  clickup_task_id text not null,
  dept_id uuid references public.departments(id),
  planned_hours numeric(8,2) not null,
  actual_hours numeric(8,2) not null default 0,
  time_entries jsonb,
  status_at_sync text,
  synced_at timestamptz not null default now()
);
create unique index project_actuals_project_task_idx
  on public.project_actuals (project_id, clickup_task_id);
```

- [ ] **Step 2: Apply, regen types, typecheck.**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0007_projects_and_actuals.sql src/types/db.ts
git commit -m "feat: projects + project_actuals schema"
```

---

## Task 7: Migration `0008_settings.sql` — singleton settings row

**Files:**
- Create: `supabase/migrations/0008_settings.sql`

- [ ] **Step 1: Write migration**

```sql
-- 0008_settings.sql
-- Apply via mcp__cc-supabase__apply_migration (name: settings)

create table public.settings (
  id int primary key default 1 check (id = 1),
  xero_enabled boolean not null default false,
  xero_oauth_tokens jsonb,
  clickup_enabled boolean not null default false,
  clickup_pat text,
  clickup_workspace_id text,
  anthropic_enabled boolean not null default true,
  anthropic_model text not null default 'claude-sonnet-4-6',
  burn_sync_cron_minutes int not null default 30,
  inbound_email_secret text,
  updated_at timestamptz not null default now()
);

insert into public.settings (id) values (1);
```

- [ ] **Step 2: Apply, regen types, typecheck.**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0008_settings.sql src/types/db.ts
git commit -m "feat: singleton settings table with phase-1 toggles"
```

---

## Task 8: Migration `0009_list_aliases.sql`

**Files:**
- Create: `supabase/migrations/0009_list_aliases.sql`

- [ ] **Step 1: Write migration**

```sql
-- 0009_list_aliases.sql
-- Apply via mcp__cc-supabase__apply_migration (name: list_aliases)

create table public.list_aliases (
  id uuid primary key default gen_random_uuid(),
  work_stream text not null,
  aliases text[] not null,
  updated_at timestamptz not null default now()
);
create unique index list_aliases_work_stream_idx on public.list_aliases (work_stream);

create table public.list_alias_overrides (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  work_stream text not null,
  list_name text not null,
  created_at timestamptz not null default now()
);
create unique index list_alias_overrides_client_stream_idx
  on public.list_alias_overrides (client_id, work_stream);
```

- [ ] **Step 2: Seed the table with `/brief`'s current map.**

Read `~/.claude/skills/brief/references/list-aliases.md` (the authoritative file for the existing `/brief` skill). For each `Work Stream → [aliases]` entry, emit one `insert` statement, e.g.:

```sql
insert into public.list_aliases (work_stream, aliases) values
  ('Design',       array['Design', 'Creative', 'UI/UX']),
  ('Development',  array['Development', 'Dev', 'Engineering']),
  ('SEO',          array['SEO', 'Search']),
  ('Project Management', array['PM', 'Project Management']);
-- …match the markdown file exactly; these are examples.
```

Append these inserts to the migration so applying the migration seeds the table.

- [ ] **Step 3: Apply, regen types, typecheck.**

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0009_list_aliases.sql src/types/db.ts
git commit -m "feat: list_aliases + overrides, seeded from /brief map"
```

---

## Task 9: Migration `0010_storage_buckets.sql` — Supabase Storage for attachments + PDFs

**Files:**
- Create: `supabase/migrations/0010_storage_buckets.sql`

- [ ] **Step 1: Write migration**

```sql
-- 0010_storage_buckets.sql
-- Apply via mcp__cc-supabase__apply_migration (name: storage_buckets)

insert into storage.buckets (id, name, public) values
  ('brief-attachments', 'brief-attachments', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public) values
  ('quote-pdfs', 'quote-pdfs', false)
on conflict (id) do nothing;

-- Phase 1 runs without RLS; single shared login has full access.
-- When per-user auth lands, add storage.policies gated on auth.uid().
```

- [ ] **Step 2: Apply. (No type changes for storage buckets.)**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0010_storage_buckets.sql
git commit -m "feat: create brief-attachments + quote-pdfs storage buckets"
```

---

## Task 10: `useSettings` hook + `FeatureFlagGate` component

**Files:**
- Create: `src/hooks/useSettings.ts`
- Create: `src/components/FeatureFlagGate.tsx`

- [ ] **Step 1: Write `useSettings` hook**

```ts
// src/hooks/useSettings.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Settings = Database["public"]["Tables"]["settings"]["Row"];
type SettingsUpdate = Database["public"]["Tables"]["settings"]["Update"];

const KEY = ["settings"] as const;

export function useSettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Settings> => {
      const { data, error } = await supabase.from("settings").select("*").eq("id", 1).single();
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: SettingsUpdate) => {
      const { data, error } = await supabase
        .from("settings").update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", 1).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
```

- [ ] **Step 2: Write `FeatureFlagGate`**

```tsx
// src/components/FeatureFlagGate.tsx
import type { ReactNode } from "react";
import { useSettings } from "@/hooks/useSettings";

type FlagKey = "xero_enabled" | "clickup_enabled" | "anthropic_enabled";

type Props = {
  flag: FlagKey;
  children: ReactNode;
  fallback?: ReactNode;
};

/**
 * Hides children when the named settings flag is false (or settings are still loading).
 * Xero controls in Phase 1 use fallback=null; they are hidden, not disabled (per spec §7.6).
 */
export function FeatureFlagGate({ flag, children, fallback = null }: Props) {
  const { data } = useSettings();
  if (!data?.[flag]) return <>{fallback}</>;
  return <>{children}</>;
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add src/hooks/useSettings.ts src/components/FeatureFlagGate.tsx
git commit -m "feat: useSettings hook and FeatureFlagGate component"
```

---

## Task 11: `useClients` + `useContacts` hooks

**Files:**
- Create: `src/hooks/useClients.ts`

- [ ] **Step 1: Write**

```ts
// src/hooks/useClients.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Client = Database["public"]["Tables"]["clients"]["Row"];
type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type ContactInsert = Database["public"]["Tables"]["contacts"]["Insert"];

const LIST = ["clients"] as const;

export function useClients() {
  return useQuery({
    queryKey: LIST,
    queryFn: async (): Promise<Client[]> => {
      const { data, error } = await supabase
        .from("clients").select("*").is("archived_at", null).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ClientInsert) => {
      const { data, error } = await supabase.from("clients").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST }),
  });
}

export function useContacts(clientId: string | undefined) {
  return useQuery({
    enabled: !!clientId,
    queryKey: ["contacts", clientId],
    queryFn: async (): Promise<Contact[]> => {
      if (!clientId) return [];
      const { data, error } = await supabase
        .from("contacts").select("*").eq("client_id", clientId).order("is_primary", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ContactInsert) => {
      const { data, error } = await supabase.from("contacts").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["contacts", vars.client_id] }),
  });
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add src/hooks/useClients.ts
git commit -m "feat: clients and contacts hooks"
```

---

## Task 12: `useBriefs` hook

**Files:**
- Create: `src/hooks/useBriefs.ts`

- [ ] **Step 1: Write**

```ts
// src/hooks/useBriefs.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];
type BriefInsert = Database["public"]["Tables"]["briefs"]["Insert"];
type BriefUpdate = Database["public"]["Tables"]["briefs"]["Update"];
type BriefStatus = Database["public"]["Enums"]["brief_status"];

const LIST = (status?: BriefStatus) => ["briefs", status ?? "all"] as const;
const DETAIL = (id: string) => ["briefs", "detail", id] as const;

export function useBriefs(status?: BriefStatus) {
  return useQuery({
    queryKey: LIST(status),
    queryFn: async (): Promise<Brief[]> => {
      let q = supabase.from("briefs").select("*").order("received_at", { ascending: false });
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useBrief(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: id ? DETAIL(id) : ["briefs", "none"],
    queryFn: async (): Promise<Brief | null> => {
      if (!id) return null;
      const { data, error } = await supabase.from("briefs").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BriefInsert) => {
      const { data, error } = await supabase.from("briefs").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["briefs"] }),
  });
}

export function useUpdateBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: BriefUpdate }) => {
      const { data, error } = await supabase
        .from("briefs").update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["briefs"] });
      qc.invalidateQueries({ queryKey: DETAIL(vars.id) });
    },
  });
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add src/hooks/useBriefs.ts
git commit -m "feat: useBriefs hook with list/detail/create/update"
```

---

## Task 13: `useScopes` hook

**Files:**
- Create: `src/hooks/useScopes.ts`

- [ ] **Step 1: Write**

```ts
// src/hooks/useScopes.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Scope = Database["public"]["Tables"]["scopes"]["Row"];
type ScopeInsert = Database["public"]["Tables"]["scopes"]["Insert"];
type ScopeUpdate = Database["public"]["Tables"]["scopes"]["Update"];

const KEY = (briefId: string) => ["scope", briefId] as const;

export function useScope(briefId: string | undefined) {
  return useQuery({
    enabled: !!briefId,
    queryKey: briefId ? KEY(briefId) : ["scope", "none"],
    queryFn: async (): Promise<Scope | null> => {
      if (!briefId) return null;
      const { data, error } = await supabase
        .from("scopes").select("*").eq("brief_id", briefId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useUpsertScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ScopeInsert | ScopeUpdate & { brief_id: string }) => {
      const { data, error } = await supabase
        .from("scopes")
        .upsert({ ...input, updated_at: new Date().toISOString() }, { onConflict: "brief_id" })
        .select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: KEY((vars as { brief_id: string }).brief_id) }),
  });
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add src/hooks/useScopes.ts
git commit -m "feat: useScope hook (one scope per brief, upsert)"
```

---

## Task 14: `useQuotes` + `useProjects` hooks

**Files:**
- Create: `src/hooks/useQuotes.ts`
- Create: `src/hooks/useProjects.ts`

- [ ] **Step 1: Write `useQuotes.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Quote = Database["public"]["Tables"]["quotes"]["Row"];
type QuoteInsert = Database["public"]["Tables"]["quotes"]["Insert"];
type QuoteUpdate = Database["public"]["Tables"]["quotes"]["Update"];
type QuoteService = Database["public"]["Tables"]["quote_services"]["Row"];
type QuoteServiceInsert = Database["public"]["Tables"]["quote_services"]["Insert"];

const Q_DETAIL = (id: string) => ["quote", id] as const;
const Q_BY_SCOPE = (scopeId: string) => ["quote", "by-scope", scopeId] as const;

export function useQuote(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: id ? Q_DETAIL(id) : ["quote", "none"],
    queryFn: async (): Promise<{ quote: Quote; services: QuoteService[] } | null> => {
      if (!id) return null;
      const [{ data: quote, error: qErr }, { data: svcs, error: sErr }] = await Promise.all([
        supabase.from("quotes").select("*").eq("id", id).single(),
        supabase.from("quote_services").select("*").eq("quote_id", id).order("ordinal"),
      ]);
      if (qErr) throw qErr;
      if (sErr) throw sErr;
      return { quote, services: svcs ?? [] };
    },
  });
}

export function useLiveQuoteForScope(scopeId: string | undefined) {
  return useQuery({
    enabled: !!scopeId,
    queryKey: scopeId ? Q_BY_SCOPE(scopeId) : ["quote", "by-scope", "none"],
    queryFn: async (): Promise<Quote | null> => {
      if (!scopeId) return null;
      const { data, error } = await supabase
        .from("quotes").select("*")
        .eq("scope_id", scopeId).neq("status", "superseded")
        .order("version", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: QuoteInsert) => {
      const { data, error } = await supabase.from("quotes").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: Q_BY_SCOPE(d.scope_id) });
      qc.invalidateQueries({ queryKey: Q_DETAIL(d.id) });
    },
  });
}

export function useUpdateQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: QuoteUpdate }) => {
      const { data, error } = await supabase
        .from("quotes").update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: Q_DETAIL(d.id) });
      qc.invalidateQueries({ queryKey: Q_BY_SCOPE(d.scope_id) });
    },
  });
}

export function useReplaceQuoteServices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ quoteId, rows }: { quoteId: string; rows: Omit<QuoteServiceInsert, "quote_id">[] }) => {
      const { error: dErr } = await supabase.from("quote_services").delete().eq("quote_id", quoteId);
      if (dErr) throw dErr;
      if (rows.length === 0) return;
      const { error: iErr } = await supabase
        .from("quote_services")
        .insert(rows.map((r) => ({ ...r, quote_id: quoteId })));
      if (iErr) throw iErr;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: Q_DETAIL(vars.quoteId) }),
  });
}
```

- [ ] **Step 2: Write `useProjects.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type Actual = Database["public"]["Tables"]["project_actuals"]["Row"];

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<Project[]> => {
      const { data, error } = await supabase
        .from("projects").select("*").order("started_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: id ? ["project", id] : ["project", "none"],
    queryFn: async (): Promise<{ project: Project; actuals: Actual[] } | null> => {
      if (!id) return null;
      const [{ data: project, error: pErr }, { data: actuals, error: aErr }] = await Promise.all([
        supabase.from("projects").select("*").eq("id", id).single(),
        supabase.from("project_actuals").select("*").eq("project_id", id),
      ]);
      if (pErr) throw pErr;
      if (aErr) throw aErr;
      return { project, actuals: actuals ?? [] };
    },
  });
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add src/hooks/useQuotes.ts src/hooks/useProjects.ts
git commit -m "feat: quotes and projects hooks"
```

---

## Task 15: Routing skeleton + nav links

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/AppShell.tsx`

- [ ] **Step 1: Create placeholder page components**

For each of the nine new pages, create a minimal stub at `src/pages/<Name>.tsx`:

```tsx
// src/pages/Inbox.tsx (example stub, repeat for each new page)
export function Inbox() {
  return <div className="p-6"><h1 className="text-headline-medium">Inbox</h1></div>;
}
```

Create stubs for: `Inbox`, `NewBrief`, `Scope`, `ProjectBuilder`, `QuoteSend`, `QuoteDetail`, `Projects`, `ProjectDetail`, `Settings`.

- [ ] **Step 2: Wire routes in `src/App.tsx`**

```tsx
import { Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { ServicesList } from "@/pages/ServicesList";
import { ServiceDetail } from "@/pages/ServiceDetail";
import { Rules } from "@/pages/Rules";
import { Departments } from "@/pages/Departments";
import { Team } from "@/pages/Team";
import { Inbox } from "@/pages/Inbox";
import { NewBrief } from "@/pages/NewBrief";
import { Scope } from "@/pages/Scope";
import { ProjectBuilder } from "@/pages/ProjectBuilder";
import { QuoteSend } from "@/pages/QuoteSend";
import { QuoteDetail } from "@/pages/QuoteDetail";
import { Projects } from "@/pages/Projects";
import { ProjectDetail } from "@/pages/ProjectDetail";
import { Settings } from "@/pages/Settings";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="briefs/new" element={<NewBrief />} />
            <Route path="briefs/:id/scope" element={<Scope />} />
            <Route path="briefs/:id/builder" element={<ProjectBuilder />} />
            <Route path="quotes/:id" element={<QuoteDetail />} />
            <Route path="quotes/:id/send" element={<QuoteSend />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:id" element={<ProjectDetail />} />
            <Route path="settings" element={<Settings />} />
            <Route path="services" element={<ServicesList />} />
            <Route path="services/new" element={<ServiceDetail mode="new" />} />
            <Route path="services/:id" element={<ServiceDetail mode="edit" />} />
            <Route path="rules" element={<Rules />} />
            <Route path="departments" element={<Departments />} />
            <Route path="team" element={<Team />} />
          </Route>
        </Route>
      </Routes>
      <Toaster richColors position="top-right" />
    </>
  );
}
```

- [ ] **Step 3: Add nav links in `AppShell.tsx`**

Add to the `nav` array (after `Dashboard`, before `Services`):

```tsx
{ to: "/inbox", label: "Inbox", icon: Inbox, end: false },
{ to: "/projects", label: "Projects", icon: FolderKanban, end: false },
```

And at the end (after `Team`):

```tsx
{ to: "/settings", label: "Settings", icon: Settings, end: false },
```

Import new icons from `lucide-react`: `Inbox`, `FolderKanban`, `Settings`.

- [ ] **Step 4: Smoke test**

```bash
npm run dev
```

Expected: dev server on http://localhost:5174. Click each new nav link; page renders the stub heading. `npm run typecheck` passes.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/AppShell.tsx src/pages
git commit -m "feat: route skeleton and nav links for phase-1 pages"
```

---

## Task 16: PDF renderer spike (de-risk the long pole)

This is a throwaway spike. Goal: prove `@react-pdf/renderer` can run inside a Supabase Deno Edge Function and produce a valid PDF from a simple HTML-derived document. If it fails, fall back to Browserless.io before building the full pipeline.

**Files:**
- Create: `supabase/functions/render-sow-pdf/index.ts` (spike version)
- Create: `supabase/functions/render-sow-pdf/deno.json`

- [ ] **Step 1: Write minimal Edge Function**

```ts
// supabase/functions/render-sow-pdf/index.ts (spike)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import React from "npm:react@18.3.1";
import { Document, Page, Text, renderToBuffer } from "npm:@react-pdf/renderer@3";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { title = "Spike" } = await req.json().catch(() => ({}));
    const doc = React.createElement(
      Document,
      null,
      React.createElement(Page, { size: "A4" },
        React.createElement(Text, null, `Hello from ${title}`)
      )
    );
    const buf = await renderToBuffer(doc);
    return new Response(buf, {
      status: 200,
      headers: { "content-type": "application/pdf", ...cors() },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors() },
  });
}
function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}
```

```json
// supabase/functions/render-sow-pdf/deno.json
{
  "imports": {}
}
```

- [ ] **Step 2: Deploy via MCP**

```
mcp__cc-supabase__deploy_edge_function with name="render-sow-pdf" and files=[...]
```

- [ ] **Step 3: Invoke from the terminal**

```bash
curl -X POST "https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/render-sow-pdf" \
  -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"spike"}' -o /tmp/spike.pdf
```

Expected: file ~3-5 KB that `file /tmp/spike.pdf` reports as "PDF document". If 500, fetch logs via `mcp__cc-supabase__get_logs` and read the stack — common issues: `npm:` import path mismatch, `renderToBuffer` not exported, missing `Buffer` polyfill. If unresolvable within one hour, **stop and escalate**: switch to Browserless.io plan (spec §10 fallback).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/render-sow-pdf
git commit -m "chore: pdf renderer spike (hello-world from edge function)"
```

**Gate:** Do not proceed to Task 17 until this spike returns a valid PDF. The fallback (Browserless.io) changes the renderer-function contract and must be planned separately.

---

## Task 17: Settings page — toggles + credential inputs

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Build the page**

```tsx
// src/pages/Settings.tsx
import { useState } from "react";
import { toast } from "sonner";
import { useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function mask(secret: string | null): string {
  if (!secret) return "";
  if (secret.length <= 8) return "•".repeat(secret.length);
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

export function Settings() {
  const { data: s, isLoading } = useSettings();
  const update = useUpdateSettings();
  const [clickupPat, setClickupPat] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");

  if (isLoading || !s) return <div className="p-6">Loading…</div>;

  return (
    <div className="container mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-headline-medium">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>ClickUp</CardTitle>
          <CardDescription>Personal Access Token + workspace. Toggle fires pushes on acceptance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="cu-enabled">Enabled</Label>
            <Switch
              id="cu-enabled"
              checked={s.clickup_enabled}
              onCheckedChange={(v) => update.mutate({ clickup_enabled: v }, { onSuccess: () => toast.success("Saved") })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cu-pat">PAT</Label>
            <Input
              id="cu-pat"
              type="password"
              placeholder={s.clickup_pat ? mask(s.clickup_pat) : "pk_…"}
              value={clickupPat}
              onChange={(e) => setClickupPat(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cu-ws">Workspace ID</Label>
            <Input
              id="cu-ws"
              placeholder={s.clickup_workspace_id ?? "9008…"}
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            onClick={() =>
              update.mutate(
                {
                  clickup_pat: clickupPat || s.clickup_pat,
                  clickup_workspace_id: workspaceId || s.clickup_workspace_id,
                },
                { onSuccess: () => { toast.success("Saved"); setClickupPat(""); setWorkspaceId(""); } }
              )
            }
          >
            Save ClickUp
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Anthropic</CardTitle>
          <CardDescription>Model for draft-scope, suggest-services, draft-sow.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="anth-enabled">Enabled</Label>
            <Switch
              id="anth-enabled"
              checked={s.anthropic_enabled}
              onCheckedChange={(v) => update.mutate({ anthropic_enabled: v })}
            />
          </div>
          <div className="space-y-2">
            <Label>Model</Label>
            <Select value={s.anthropic_model} onValueChange={(v) => update.mutate({ anthropic_model: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="claude-sonnet-4-6">claude-sonnet-4-6</SelectItem>
                <SelectItem value="claude-opus-4-7">claude-opus-4-7</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Burn sync</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label>Cadence</Label>
            <Select
              value={String(s.burn_sync_cron_minutes)}
              onValueChange={(v) => update.mutate({ burn_sync_cron_minutes: Number(v) })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="15">Every 15 minutes</SelectItem>
                <SelectItem value="30">Every 30 minutes</SelectItem>
                <SelectItem value="60">Every hour</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Xero card omitted: Phase 1 hides the card entirely. Added in Phase 2. */}
    </div>
  );
}
```

- [ ] **Step 2: Manual smoke**

```bash
npm run dev
```

Navigate to `/settings`. Toggle ClickUp on/off and verify the DB row changes (`mcp__cc-supabase__execute_sql` with `select clickup_enabled from settings where id=1;`). Save a PAT; confirm the masked preview shows next visit.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat: settings page with clickup + anthropic + burn toggles"
```

---

## Task 18: Manual intake form (`/briefs/new`)

**Files:**
- Modify: `src/pages/NewBrief.tsx`

- [ ] **Step 1: Build form with React Hook Form + Zod**

```tsx
// src/pages/NewBrief.tsx
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { useClients, useCreateClient } from "@/hooks/useClients";
import { useCreateBrief } from "@/hooks/useBriefs";
import { supabase } from "@/lib/supabase";

const schema = z.object({
  client_id: z.string().uuid().optional(),
  new_client_name: z.string().optional(),
  sender_email: z.string().email().optional().or(z.literal("")),
  raw_subject: z.string().min(1, "Subject required"),
  raw_body: z.string().min(10, "Body must be at least 10 characters"),
});
type FormValues = z.infer<typeof schema>;

export function NewBrief() {
  const navigate = useNavigate();
  const { data: clients = [] } = useClients();
  const createClient = useCreateClient();
  const createBrief = useCreateBrief();
  const [files, setFiles] = useState<File[]>([]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { raw_subject: "", raw_body: "" },
  });

  const onSubmit = async (values: FormValues) => {
    let clientId = values.client_id;
    if (!clientId && values.new_client_name) {
      const c = await createClient.mutateAsync({ name: values.new_client_name });
      clientId = c.id;
    }

    const brief = await createBrief.mutateAsync({
      client_id: clientId ?? null,
      source: "manual",
      sender_email: values.sender_email || null,
      raw_subject: values.raw_subject,
      raw_body: values.raw_body,
      raw_attachments: null,
      status: "new",
    });

    if (files.length > 0) {
      const records: Array<{ name: string; storage_path: string; mime: string; size: number }> = [];
      for (const f of files) {
        const path = `${brief.id}/${crypto.randomUUID()}-${f.name}`;
        const { error } = await supabase.storage.from("brief-attachments").upload(path, f);
        if (error) { toast.error(`Upload failed: ${f.name}`); continue; }
        records.push({ name: f.name, storage_path: path, mime: f.type, size: f.size });
      }
      if (records.length > 0) {
        await supabase.from("briefs").update({ raw_attachments: records }).eq("id", brief.id);
      }
    }

    toast.success("Brief created");
    navigate("/inbox");
  };

  return (
    <div className="container mx-auto max-w-2xl p-6">
      <Card>
        <CardHeader><CardTitle>New brief</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>Client</Label>
              <Combobox
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
                value={form.watch("client_id") ?? ""}
                onChange={(v) => form.setValue("client_id", v)}
                placeholder="Search clients…"
                emptyLabel="No match — create new below"
              />
              <Input
                placeholder="Or create new client (name)"
                {...form.register("new_client_name")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sender">Sender email (optional)</Label>
              <Input id="sender" type="email" {...form.register("sender_email")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subj">Subject</Label>
              <Input id="subj" {...form.register("raw_subject")} />
              {form.formState.errors.raw_subject && (
                <p className="text-body-small text-destructive">{form.formState.errors.raw_subject.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="body">Brief body</Label>
              <Textarea id="body" rows={10} {...form.register("raw_body")} />
              {form.formState.errors.raw_body && (
                <p className="text-body-small text-destructive">{form.formState.errors.raw_body.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Attachments</Label>
              <Input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            </div>
            <Button type="submit" disabled={form.formState.isSubmitting}>Save brief</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Manual smoke**

1. `npm run dev`.
2. Go to `/briefs/new`.
3. Create a brief with a new client + attachment (a small PDF).
4. Verify DB: `select id, status, raw_attachments from briefs order by created_at desc limit 1;` should have `status='new'` and a JSON array with one attachment.
5. Confirm the file lives in Supabase Storage under `brief-attachments/{brief_id}/`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/NewBrief.tsx
git commit -m "feat: manual brief intake form with client creation + attachments"
```

---

## Task 19: Inbox page + `BriefRow` with triage actions

**Files:**
- Create: `src/components/BriefRow.tsx`
- Modify: `src/pages/Inbox.tsx`
- Create: `src/content/email-templates.ts`

- [ ] **Step 1: Email templates file**

```ts
// src/content/email-templates.ts
export function needsInfoReply(subject: string, senderName?: string): { subject: string; body: string } {
  return {
    subject: `Re: ${subject}`,
    body: [
      `Hi ${senderName ?? "there"},`,
      "",
      "Thanks for getting in touch. Before we put a scope together, could you share a little more detail on the following:",
      "",
      "  • <question 1>",
      "  • <question 2>",
      "",
      "Once we have that, we'll come back with a proposal.",
      "",
      "Best,",
      "Brendan",
    ].join("\n"),
  };
}

export function sendQuoteEmail(input: { subject: string; clientName: string | null }): { subject: string; body: string } {
  return {
    subject: `Proposal: ${input.subject}`,
    body: [
      `Hi ${input.clientName ?? "there"},`,
      "",
      "Please find attached our proposal covering the scope we discussed.",
      "",
      "Let me know if you'd like to tweak anything before we proceed.",
      "",
      "Best,",
      "Brendan",
    ].join("\n"),
  };
}
```

- [ ] **Step 2: BriefRow component**

```tsx
// src/components/BriefRow.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { useUpdateBrief } from "@/hooks/useBriefs";
import { useClients, useCreateClient } from "@/hooks/useClients";
import { useCurrentUserName } from "@/hooks/useCurrentUserName";
import { needsInfoReply } from "@/content/email-templates";
import { mailto } from "@/lib/mailto";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

export function BriefRow({ brief }: { brief: Brief }) {
  const navigate = useNavigate();
  const user = useCurrentUserName();
  const [expanded, setExpanded] = useState(false);
  const [clientId, setClientId] = useState<string | undefined>(brief.client_id ?? undefined);
  const [newClientName, setNewClientName] = useState("");
  const { data: clients = [] } = useClients();
  const createClient = useCreateClient();
  const update = useUpdateBrief();

  const clientName = clients.find((c) => c.id === brief.client_id)?.name;

  const accept = async () => {
    let cid = clientId;
    if (!cid && newClientName) {
      const c = await createClient.mutateAsync({ name: newClientName });
      cid = c.id;
    }
    if (!cid) { toast.error("Assign a client before accepting"); return; }
    await update.mutateAsync({
      id: brief.id,
      patch: { client_id: cid, status: "triaged", triaged_by: user, triaged_at: new Date().toISOString() },
    });
    navigate(`/briefs/${brief.id}/scope`);
  };

  const spam = async () => {
    const reason = window.prompt("Reason (optional):") ?? "";
    await update.mutateAsync({
      id: brief.id,
      patch: { status: "spam", rejection_reason: reason || null, triaged_by: user, triaged_at: new Date().toISOString() },
    });
    toast.success("Moved to spam");
  };

  const needsInfo = async () => {
    if (!brief.sender_email) { toast.error("No sender email — edit brief first"); return; }
    const { subject, body } = needsInfoReply(brief.raw_subject ?? "your request");
    window.location.href = mailto({ to: brief.sender_email, subject, body });
    await update.mutateAsync({
      id: brief.id,
      patch: { status: "needs_info", triaged_by: user, triaged_at: new Date().toISOString() },
    });
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <button onClick={() => setExpanded(!expanded)} className="flex-1 text-left">
            <div className="text-title-small">{brief.raw_subject ?? "(no subject)"}</div>
            <div className="text-label-small text-m-on-surface-variant">
              {brief.sender_email ?? "manual"} · {new Date(brief.received_at).toLocaleString("en-ZA")}
            </div>
          </button>
          {brief.client_id
            ? <Badge variant="default">Known: {clientName}</Badge>
            : <Badge variant="secondary">Unknown sender</Badge>}
        </div>

        {expanded && (
          <div className="mt-4 space-y-4">
            <pre className="whitespace-pre-wrap rounded-md bg-m-surface-container p-3 text-body-small">
              {brief.raw_body}
            </pre>

            {!brief.client_id && (
              <div className="space-y-2">
                <div className="text-label-large">Assign client</div>
                <Combobox
                  options={clients.map((c) => ({ value: c.id, label: c.name }))}
                  value={clientId ?? ""}
                  onChange={setClientId}
                  placeholder="Search clients…"
                />
                <Input
                  placeholder="Or create new client (name)"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                />
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={accept}>Accept</Button>
              <Button variant="secondary" onClick={needsInfo}>Needs info</Button>
              <Button variant="ghost" onClick={spam}>Spam</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Inbox page**

```tsx
// src/pages/Inbox.tsx
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BriefRow } from "@/components/BriefRow";
import { useBriefs } from "@/hooks/useBriefs";

export function Inbox() {
  const { data: newBriefs = [] } = useBriefs("new");
  const { data: needsInfo = [] } = useBriefs("needs_info");

  return (
    <div className="container mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="text-headline-medium">Inbox</h1>
        <Button asChild><Link to="/briefs/new"><Plus className="h-4 w-4" /> New brief</Link></Button>
      </div>

      <h2 className="mb-2 text-title-medium">New ({newBriefs.length})</h2>
      <div className="space-y-2">
        {newBriefs.map((b) => <BriefRow key={b.id} brief={b} />)}
        {newBriefs.length === 0 && <div className="text-body-medium text-m-on-surface-variant">Empty.</div>}
      </div>

      {needsInfo.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-title-medium">Awaiting client ({needsInfo.length})</h2>
          <div className="space-y-2">
            {needsInfo.map((b) => <BriefRow key={b.id} brief={b} />)}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Manual smoke**

Create 2-3 briefs via `/briefs/new`; confirm they appear at `/inbox`. Accept one → navigates to `/briefs/:id/scope`. Mark another as Spam → disappears. Mark the third as Needs info with a sender email → opens `mailto:` and moves to "Awaiting client" section.

- [ ] **Step 5: Commit** (note: `mailto.ts` is a dependency from Task 20 below — if executing strictly in order, do Task 20 first, or inline the two-line mailto builder for now)

```bash
git add src/components/BriefRow.tsx src/pages/Inbox.tsx src/content/email-templates.ts
git commit -m "feat: inbox page with triage accept/needs-info/spam actions"
```

---

## Task 20: `mailto.ts` helper (TDD)

**Files:**
- Create: `src/lib/mailto.ts`
- Create: `src/lib/mailto.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/lib/mailto.test.ts
import { describe, expect, it } from "vitest";
import { mailto } from "./mailto";

describe("mailto", () => {
  it("builds a basic mailto URL", () => {
    expect(mailto({ to: "a@b.com", subject: "Hi", body: "Hello" }))
      .toBe("mailto:a@b.com?subject=Hi&body=Hello");
  });

  it("URL-encodes subject and body", () => {
    const url = mailto({ to: "a@b.com", subject: "Re: cost & timeline?", body: "Line 1\nLine 2" });
    expect(url).toContain("subject=Re%3A%20cost%20%26%20timeline%3F");
    expect(url).toContain("body=Line%201%0ALine%202");
  });

  it("omits empty fields", () => {
    expect(mailto({ to: "a@b.com" })).toBe("mailto:a@b.com");
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
npm test -- src/lib/mailto.test.ts
```

Expected: fail ("Cannot find module './mailto'").

- [ ] **Step 3: Implement**

```ts
// src/lib/mailto.ts
type Args = { to: string; subject?: string; body?: string; cc?: string; bcc?: string };

export function mailto({ to, subject, body, cc, bcc }: Args): string {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  if (cc) params.set("cc", cc);
  if (bcc) params.set("bcc", bcc);
  const q = params.toString().replace(/\+/g, "%20");
  return q ? `mailto:${to}?${q}` : `mailto:${to}`;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- src/lib/mailto.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mailto.ts src/lib/mailto.test.ts
git commit -m "feat: mailto url builder with urlencoded subject and body"
```

---

## Task 21: Jaccard token-overlap (TDD) for `scopes.ai_drafted`

**Files:**
- Create: `src/lib/scope-overlap.ts`
- Create: `src/lib/scope-overlap.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/lib/scope-overlap.test.ts
import { describe, expect, it } from "vitest";
import { jaccard, isMostlyAi } from "./scope-overlap";

describe("jaccard", () => {
  it("returns 1 for identical strings", () => {
    expect(jaccard("hello world", "hello world")).toBe(1);
  });
  it("returns 0 for disjoint strings", () => {
    expect(jaccard("foo bar", "baz qux")).toBe(0);
  });
  it("handles partial overlap", () => {
    const j = jaccard("one two three", "two three four");
    // intersection {two, three} = 2; union {one, two, three, four} = 4
    expect(j).toBeCloseTo(0.5, 5);
  });
  it("is case-insensitive and ignores punctuation", () => {
    expect(jaccard("Hello, world!", "hello world")).toBe(1);
  });
});

describe("isMostlyAi", () => {
  it("is true when overlap ≥ 0.85", () => {
    const ai = "the client wants a new website with seo and a blog section";
    const edited = "the client wants a new website with seo and a blog area";
    expect(isMostlyAi(edited, ai)).toBe(true);
  });
  it("is false when overlap < 0.85", () => {
    expect(isMostlyAi("completely different copy here", "the client wants a new website")).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
npm test -- src/lib/scope-overlap.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/lib/scope-overlap.ts
function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

export function jaccard(a: string, b: string): number {
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function isMostlyAi(current: string, lastAiDraft: string, threshold = 0.85): boolean {
  return jaccard(current, lastAiDraft) >= threshold;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- src/lib/scope-overlap.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/scope-overlap.ts src/lib/scope-overlap.test.ts
git commit -m "feat: jaccard token overlap for scopes.ai_drafted flag"
```

---

## Task 22: `draft-scope` Edge Function

**Files:**
- Create: `supabase/functions/draft-scope/index.ts`

- [ ] **Step 1: Write function**

```ts
// supabase/functions/draft-scope/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Request:  { brief_id: string; nudge?: string }
// Response: { scope: { enhanced_prose, in_scope, out_of_scope, open_questions } }

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not set" }, 500);
    const { brief_id, nudge } = await req.json();
    if (!brief_id) return json({ error: "brief_id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    const [{ data: settings }, { data: brief, error: bErr }] = await Promise.all([
      supabase.from("settings").select("anthropic_model").eq("id", 1).single(),
      supabase.from("briefs").select("*, client:clients(name)").eq("id", brief_id).single(),
    ]);
    if (bErr || !brief) return json({ error: bErr?.message ?? "Brief not found" }, 404);

    const model = settings?.anthropic_model ?? "claude-sonnet-4-6";

    const system = [
      "You are a digital agency scoping analyst at Converted Click.",
      "A client sent a request. Rewrite it as:",
      "1) enhanced_prose — one-paragraph clarified summary",
      "2) in_scope — bullet list of explicit in-scope items",
      "3) out_of_scope — bullet list of likely out-of-scope items to confirm exclusion",
      "4) open_questions — bullet list of questions to ask before quoting",
      "Return JSON only: {\"enhanced_prose\":\"\",\"in_scope\":[],\"out_of_scope\":[],\"open_questions\":[]}.",
      "Do not invent services or commitments.",
    ].join("\n");

    const user = [
      brief.client ? `Client: ${(brief.client as { name: string }).name}` : null,
      `Subject: ${brief.raw_subject ?? "(none)"}`,
      "",
      "Body:",
      brief.raw_body,
      nudge ? `\n\nAdditional guidance from staff: ${nudge}` : null,
    ].filter(Boolean).join("\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model, max_tokens: 2048,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) return json({ error: `Anthropic: ${await res.text()}` }, 502);

    const body = await res.json();
    const text: string = body.content?.[0]?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return json({ error: "AI did not return JSON", raw: text }, 502);

    const parsed = JSON.parse(match[0]);
    const scope = {
      enhanced_prose: String(parsed.enhanced_prose ?? ""),
      in_scope_md: (parsed.in_scope ?? []).map((s: string) => `- ${s}`).join("\n"),
      out_of_scope_md: (parsed.out_of_scope ?? []).map((s: string) => `- ${s}`).join("\n"),
      open_questions_md: (parsed.open_questions ?? []).map((s: string) => `- ${s}`).join("\n"),
    };

    // Upsert scope row with ai_drafted=true. Client-side will read + render.
    await supabase
      .from("scopes")
      .upsert({ brief_id, ...scope, ai_drafted: true, updated_at: new Date().toISOString() }, { onConflict: "brief_id" });

    return json({ scope });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors() } });
}
function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}
```

- [ ] **Step 2: Deploy**

Use `mcp__cc-supabase__deploy_edge_function` with name `draft-scope`.

- [ ] **Step 3: Smoke invoke**

```bash
BRIEF_ID=<existing brief uuid>
curl -X POST "https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/draft-scope" \
  -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"brief_id\":\"$BRIEF_ID\"}"
```

Expected: JSON with `scope: {enhanced_prose, in_scope_md, ...}`. DB: `select * from scopes where brief_id = '$BRIEF_ID';` returns the upserted row.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/draft-scope
git commit -m "feat: draft-scope edge function (claude-backed brief summariser)"
```

---

## Task 23: Scope page (`/briefs/:id/scope`) with `ScopeEditor`

**Files:**
- Create: `src/components/ScopeEditor.tsx`
- Modify: `src/pages/Scope.tsx`

- [ ] **Step 1: `ScopeEditor` component (4 MD textareas + preview tabs)**

```tsx
// src/components/ScopeEditor.tsx
import MDEditor from "@uiw/react-md-editor";
import { Label } from "@/components/ui/label";

type ScopeValues = {
  enhanced_prose: string;
  in_scope_md: string;
  out_of_scope_md: string;
  open_questions_md: string;
};

type Props = {
  value: ScopeValues;
  onChange: (v: Partial<ScopeValues>) => void;
  disabled?: boolean;
};

export function ScopeEditor({ value, onChange, disabled }: Props) {
  const section = (
    key: keyof ScopeValues, label: string, rows = 6
  ) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <MDEditor
        value={value[key]}
        onChange={(v) => onChange({ [key]: v ?? "" })}
        height={rows * 28}
        textareaProps={{ disabled }}
        preview="edit"
      />
    </div>
  );

  return (
    <div className="space-y-4">
      {section("enhanced_prose", "Clarified summary", 4)}
      {section("in_scope_md", "In scope", 6)}
      {section("out_of_scope_md", "Out of scope", 6)}
      {section("open_questions_md", "Open questions", 6)}
    </div>
  );
}
```

- [ ] **Step 2: Scope page**

```tsx
// src/pages/Scope.tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScopeEditor } from "@/components/ScopeEditor";
import { useBrief, useUpdateBrief } from "@/hooks/useBriefs";
import { useScope, useUpsertScope } from "@/hooks/useScopes";
import { useCurrentUserName } from "@/hooks/useCurrentUserName";
import { supabase } from "@/lib/supabase";
import { isMostlyAi } from "@/lib/scope-overlap";

type ScopeValues = {
  enhanced_prose: string;
  in_scope_md: string;
  out_of_scope_md: string;
  open_questions_md: string;
};

const EMPTY: ScopeValues = { enhanced_prose: "", in_scope_md: "", out_of_scope_md: "", open_questions_md: "" };

export function Scope() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useCurrentUserName();
  const { data: brief } = useBrief(id);
  const { data: scope, refetch } = useScope(id);
  const updateBrief = useUpdateBrief();
  const upsertScope = useUpsertScope();
  const [values, setValues] = useState<ScopeValues>(EMPTY);
  const [lastAiDraft, setLastAiDraft] = useState<string>("");
  const [nudge, setNudge] = useState("");
  const [drafting, setDrafting] = useState(false);

  useEffect(() => {
    if (scope) {
      const v = {
        enhanced_prose: scope.enhanced_prose ?? "",
        in_scope_md: scope.in_scope_md ?? "",
        out_of_scope_md: scope.out_of_scope_md ?? "",
        open_questions_md: scope.open_questions_md ?? "",
      };
      setValues(v);
      if (scope.ai_drafted) setLastAiDraft(concat(v));
    }
  }, [scope]);

  // Auto-draft on first load if no scope row exists
  useEffect(() => {
    if (!brief || scope || drafting) return;
    void draft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, scope]);

  const draft = async () => {
    if (!id) return;
    setDrafting(true);
    const { data, error } = await supabase.functions.invoke("draft-scope", { body: { brief_id: id, nudge: nudge || undefined } });
    setDrafting(false);
    if (error) { toast.error(error.message); return; }
    const s = data.scope;
    const v = { enhanced_prose: s.enhanced_prose, in_scope_md: s.in_scope_md, out_of_scope_md: s.out_of_scope_md, open_questions_md: s.open_questions_md };
    setValues(v);
    setLastAiDraft(concat(v));
    void refetch();
    toast.success("Drafted");
  };

  const save = async () => {
    if (!id) return;
    await upsertScope.mutateAsync({
      brief_id: id, ...values,
      ai_drafted: lastAiDraft ? isMostlyAi(concat(values), lastAiDraft) : false,
    });
    toast.success("Saved");
  };

  const lock = async () => {
    if (!id) return;
    await upsertScope.mutateAsync({
      brief_id: id, ...values,
      ai_drafted: lastAiDraft ? isMostlyAi(concat(values), lastAiDraft) : false,
      locked_at: new Date().toISOString(), locked_by: user,
    });
    await updateBrief.mutateAsync({ id, patch: { status: "scoped" } });
    navigate(`/briefs/${id}/builder`);
  };

  if (!brief) return <div className="p-6">Loading…</div>;

  return (
    <div className="container mx-auto max-w-7xl p-6 grid gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]">
      <aside className="space-y-3">
        <Card><CardContent className="p-4">
          <div className="text-label-small text-m-on-surface-variant">Subject</div>
          <div className="text-title-small">{brief.raw_subject}</div>
          <div className="mt-3 text-label-small text-m-on-surface-variant">From</div>
          <div>{brief.sender_email ?? "manual"}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-label-small text-m-on-surface-variant mb-2">Raw body</div>
          <pre className="whitespace-pre-wrap text-body-small">{brief.raw_body}</pre>
        </CardContent></Card>
      </aside>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Textarea placeholder="Optional redraft nudge…" rows={2} value={nudge} onChange={(e) => setNudge(e.target.value)} />
          <Button variant="secondary" onClick={draft} disabled={drafting}>
            {drafting ? "Drafting…" : scope ? "Redraft" : "Draft"}
          </Button>
        </div>
        <ScopeEditor value={values} onChange={(v) => setValues({ ...values, ...v })} />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={save}>Save draft</Button>
          <Button onClick={lock}>Lock scope</Button>
        </div>
      </section>
    </div>
  );
}

function concat(v: { enhanced_prose: string; in_scope_md: string; out_of_scope_md: string; open_questions_md: string }) {
  return `${v.enhanced_prose}\n${v.in_scope_md}\n${v.out_of_scope_md}\n${v.open_questions_md}`;
}
```

- [ ] **Step 3: Manual smoke**

1. Accept a brief from inbox → lands at `/briefs/:id/scope`.
2. First load calls `draft-scope`; four sections pre-fill.
3. Edit a section; click Save draft → toast, DB `scopes` row updated.
4. Click Redraft with a nudge like "focus on SEO scope only" → fields repopulate.
5. Click Lock scope → brief status → `scoped`, navigates to `/briefs/:id/builder`.

- [ ] **Step 4: Commit**

```bash
git add src/components/ScopeEditor.tsx src/pages/Scope.tsx
git commit -m "feat: scope page with ai draft, redraft nudge, and lock"
```

---

## Task 24: `quotes.ts` — margin math + line-item snapshot (TDD)

**Files:**
- Create: `src/lib/quotes.ts`
- Create: `src/lib/quotes.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/lib/quotes.test.ts
import { describe, expect, it } from "vitest";
import { aggregateTotals, buildLineItems, type QuoteLine } from "./quotes";

const depts = [
  { id: "dev", name: "Development", hourly_rate_cents: 107500 },
  { id: "seo", name: "SEO", hourly_rate_cents: 107500 },
];

const baseLine: QuoteLine = {
  service_id: "svc-1",
  service_name: "Full Page Build",
  xero_code: "002",
  qty: 1,
  unit_price_cents: 330000,
  allocation: [
    { dept_id: "dev", pct: 60 },
    { dept_id: "seo", pct: 40 },
  ],
};

describe("aggregateTotals", () => {
  it("sums subtotal and applies margin + discount_room", () => {
    const t = aggregateTotals([{ ...baseLine, qty: 2 }], { margin_pct: 0, discount_room_pct: 0 });
    expect(t.subtotal_cents).toBe(660000);
    expect(t.total_cents).toBe(660000);
  });

  it("applies margin uplift (cost → sell)", () => {
    const t = aggregateTotals([baseLine], { margin_pct: 10, discount_room_pct: 0 });
    // Uplift interpretation: total = subtotal * (1 + margin_pct/100)
    expect(t.total_cents).toBe(363000);
  });

  it("applies discount_room_pct as a downward percentage on the post-margin total", () => {
    const t = aggregateTotals([baseLine], { margin_pct: 0, discount_room_pct: 10 });
    expect(t.total_cents).toBe(297000);
  });
});

describe("buildLineItems snapshot", () => {
  it("expands allocation into per-dept cost_share and hours", () => {
    const items = buildLineItems([baseLine], depts);
    expect(items).toHaveLength(1);
    expect(items[0].subtotal_cents).toBe(330000);
    const dev = items[0].allocation.find((a) => a.dept_id === "dev")!;
    expect(dev.cost_share_cents).toBe(198000);
    expect(dev.hours).toBeCloseTo(1.84, 2); // 198000 / 107500
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
npm test -- src/lib/quotes.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/lib/quotes.ts
/**
 * Quote aggregation + line-item snapshot. Pure, no I/O.
 * Used by ProjectBuilder for live totals and by Finalise-quote to freeze
 * line_items_jsonb into quotes.line_items_jsonb.
 */

export type DeptRef = { id: string; name: string; hourly_rate_cents: number };

export type QuoteLineAllocation = { dept_id: string; pct: number };

export type QuoteLine = {
  service_id: string;
  service_name: string;
  xero_code: string | null;
  qty: number;
  unit_price_cents: number;
  allocation: QuoteLineAllocation[];
};

export type SnapshotAllocation = {
  dept_id: string;
  dept_name: string;
  hours: number;
  cost_share_cents: number;
};

export type SnapshotLineItem = {
  service_id: string;
  service_name: string;
  xero_code: string | null;
  qty: number;
  unit_price_cents: number;
  subtotal_cents: number;
  allocation: SnapshotAllocation[];
};

export function aggregateTotals(
  lines: QuoteLine[],
  opts: { margin_pct: number; discount_room_pct: number }
): { subtotal_cents: number; total_cents: number } {
  const subtotal_cents = lines.reduce(
    (acc, l) => acc + Math.round(l.unit_price_cents * l.qty),
    0
  );
  const afterMargin = Math.round(subtotal_cents * (1 + opts.margin_pct / 100));
  const total_cents = Math.round(afterMargin * (1 - opts.discount_room_pct / 100));
  return { subtotal_cents, total_cents };
}

export function buildLineItems(lines: QuoteLine[], depts: DeptRef[]): SnapshotLineItem[] {
  const deptMap = new Map(depts.map((d) => [d.id, d]));
  return lines.map((l) => {
    const subtotal_cents = Math.round(l.unit_price_cents * l.qty);
    const allocation = l.allocation.map((a) => {
      const d = deptMap.get(a.dept_id);
      const cost_share_cents = Math.round((subtotal_cents * a.pct) / 100);
      const rate = d?.hourly_rate_cents ?? 0;
      const hours = rate > 0 ? round2(cost_share_cents / rate) : 0;
      return {
        dept_id: a.dept_id,
        dept_name: d?.name ?? "Unknown",
        hours,
        cost_share_cents,
      };
    });
    return {
      service_id: l.service_id,
      service_name: l.service_name,
      xero_code: l.xero_code,
      qty: l.qty,
      unit_price_cents: l.unit_price_cents,
      subtotal_cents,
      allocation,
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- src/lib/quotes.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/quotes.ts src/lib/quotes.test.ts
git commit -m "feat: quote totals aggregation + line item snapshot builder"
```

---

## Task 25: `clickup-shared.ts` — list-alias resolver + BRIEF:: builder (TDD)

**Files:**
- Create: `src/lib/clickup-shared.ts`
- Create: `src/lib/clickup-shared.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/lib/clickup-shared.test.ts
import { describe, expect, it } from "vitest";
import { resolveListAlias, buildBriefComment } from "./clickup-shared";

const aliases = [
  { work_stream: "Development", aliases: ["Development", "Dev", "Engineering"] },
  { work_stream: "SEO",         aliases: ["SEO", "Search"] },
];

describe("resolveListAlias", () => {
  it("returns the matching work_stream for exact alias", () => {
    expect(resolveListAlias("Dev", aliases, [])).toEqual({ list_name: "Development", source: "default" });
  });
  it("is case-insensitive", () => {
    expect(resolveListAlias("seo", aliases, [])).toEqual({ list_name: "SEO", source: "default" });
  });
  it("falls back to client override when present", () => {
    const overrides = [{ client_id: "c1", work_stream: "SEO", list_name: "SEO (Pebble custom)" }];
    const out = resolveListAlias("SEO", aliases, overrides, "c1");
    expect(out).toEqual({ list_name: "SEO (Pebble custom)", source: "override" });
  });
  it("returns null for unknown stream", () => {
    expect(resolveListAlias("Accounting", aliases, [])).toBeNull();
  });
});

describe("buildBriefComment", () => {
  it("emits a BRIEF:: prefixed JSON grammar identical to /brief output", () => {
    const c = buildBriefComment({
      client_name: "Pebble",
      engagement_type: "Task",
      work_stream: "Development",
      sprint_points: 3,
      date_of_engagement: "2026-04-22",
      source_quote_id: "q-1",
    });
    expect(c.startsWith("BRIEF:: ")).toBe(true);
    const payload = JSON.parse(c.slice("BRIEF:: ".length));
    expect(payload.sprint_points).toBe(3);
    expect(payload.work_stream).toBe("Development");
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
npm test -- src/lib/clickup-shared.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/lib/clickup-shared.ts
/**
 * ClickUp helpers shared between push-to-clickup Edge Function (server) and
 * any client-side UI that needs to preview what will be sent.
 *
 * The work_stream → list mapping mirrors the /brief skill's list-aliases.md
 * (seeded into list_aliases table). Phase 3 will consolidate.
 */

export type AliasRow = { work_stream: string; aliases: string[] };
export type OverrideRow = { client_id: string; work_stream: string; list_name: string };

export type AliasResolution =
  | { list_name: string; source: "default" | "override" }
  | null;

export function resolveListAlias(
  input: string,
  aliases: AliasRow[],
  overrides: OverrideRow[],
  client_id?: string,
): AliasResolution {
  const needle = input.trim().toLowerCase();

  // First find the canonical work_stream by searching aliases (case-insensitive).
  const canonical = aliases.find((a) =>
    a.work_stream.toLowerCase() === needle || a.aliases.some((x) => x.toLowerCase() === needle)
  );
  if (!canonical) return null;

  if (client_id) {
    const o = overrides.find(
      (x) => x.client_id === client_id && x.work_stream.toLowerCase() === canonical.work_stream.toLowerCase()
    );
    if (o) return { list_name: o.list_name, source: "override" };
  }
  return { list_name: canonical.work_stream, source: "default" };
}

export type BriefCommentPayload = {
  client_name: string;
  engagement_type: "Project" | "Task";
  work_stream: string;
  sprint_points: number;
  date_of_engagement: string; // ISO date
  source_quote_id: string;
};

export function buildBriefComment(p: BriefCommentPayload): string {
  // Matches the grammar emitted by ~/.claude/skills/brief. Phase 3 will swap to
  // an envelope consumed by /brief instead.
  return `BRIEF:: ${JSON.stringify(p)}`;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- src/lib/clickup-shared.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/clickup-shared.ts src/lib/clickup-shared.test.ts
git commit -m "feat: clickup shared helpers (list-alias resolver + BRIEF:: builder)"
```

---

## Task 26: Master SoW sync script

**Files:**
- Create: `scripts/sync-sows.ts`
- Create: `src/data/master-sows.json` (generated — first run)
- Modify: `package.json` (add script target)

- [ ] **Step 1: Write sync script**

```ts
// scripts/sync-sows.ts
/**
 * Read cc-vault wiki SoW markdown files and emit a JSON bundle at
 * src/data/master-sows.json. The bundle is checked in; edge functions that
 * draft SOW content include it in their Anthropic prompts.
 *
 * Source layout: CC-Vault/cc-vault/wiki/sow/*.md (one per service family).
 * Excludes _index.md and _shared directory.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, basename, resolve } from "node:path";

const SOW_DIR = resolve(process.env.SOW_DIR ?? "../CC-Vault/cc-vault/wiki/sow");
const OUT = resolve("src/data/master-sows.json");

type SoW = { slug: string; title: string; body_md: string };

function listMd(dir: string): string[] {
  return readdirSync(dir)
    .filter((n) => n.endsWith(".md") && !n.startsWith("_"))
    .filter((n) => statSync(join(dir, n)).isFile());
}

function firstHeading(md: string, fallback: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

function main() {
  const files = listMd(SOW_DIR);
  const sows: SoW[] = files.map((f) => {
    const body = readFileSync(join(SOW_DIR, f), "utf8");
    const slug = basename(f, ".md");
    return { slug, title: firstHeading(body, slug), body_md: body };
  });
  writeFileSync(OUT, JSON.stringify(sows, null, 2));
  // eslint-disable-next-line no-console
  console.log(`Wrote ${sows.length} SoWs to ${OUT}`);
}

main();
```

- [ ] **Step 2: Add npm script**

Edit `package.json` `scripts`:

```json
"sync-sows": "tsx scripts/sync-sows.ts"
```

- [ ] **Step 3: Run and verify**

```bash
npm run sync-sows
cat src/data/master-sows.json | head -5
```

Expected: JSON array with entries for each wiki SoW. If `SOW_DIR` is wrong, set it explicitly:

```bash
SOW_DIR=/Users/brendangunn/Github/CC-Vault/cc-vault/wiki/sow npm run sync-sows
```

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-sows.ts src/data/master-sows.json package.json
git commit -m "feat: sync master SoWs from wiki into bundled json"
```

---

## Task 27: `suggest-services` Edge Function

**Files:**
- Create: `supabase/functions/suggest-services/index.ts`

- [ ] **Step 1: Write function**

```ts
// supabase/functions/suggest-services/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Request:  { brief_id: string }
// Response: { suggestions: Array<{ service_id: string; qty: number; confidence: number; reasoning: string }> }

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not set" }, 500);
    const { brief_id } = await req.json();
    if (!brief_id) return json({ error: "brief_id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    const [{ data: settings }, { data: brief }, { data: scope }, { data: services }] = await Promise.all([
      supabase.from("settings").select("anthropic_model").eq("id", 1).single(),
      supabase.from("briefs").select("*").eq("id", brief_id).single(),
      supabase.from("scopes").select("*").eq("brief_id", brief_id).single(),
      supabase.from("services").select("id,name,code,scope_definition").eq("status", "active"),
    ]);
    if (!brief || !scope) return json({ error: "Brief or scope missing" }, 404);

    const model = settings?.anthropic_model ?? "claude-sonnet-4-6";
    const catalogue = (services ?? []).map((s) =>
      `  ${s.id} [${s.code ?? "-"}] ${s.name}${s.scope_definition ? ` — ${s.scope_definition.slice(0, 180)}` : ""}`
    ).join("\n");

    const system = [
      "You are a scoping assistant at Converted Click. Given a locked scope and a full service catalogue,",
      "propose up to 8 services that should be on the quote, with a quantity and confidence (0-1).",
      "Return JSON only: {\"suggestions\":[{\"service_id\":\"\",\"qty\":0,\"confidence\":0,\"reasoning\":\"\"}]}.",
      "Only use service_ids from the catalogue below. Do not invent services.",
      "",
      "Catalogue:",
      catalogue,
    ].join("\n");

    const user = [
      `Subject: ${brief.raw_subject ?? "(none)"}`,
      "",
      "Clarified scope:",
      scope.enhanced_prose ?? "",
      "",
      "In scope:",
      scope.in_scope_md ?? "",
      "",
      "Out of scope:",
      scope.out_of_scope_md ?? "",
    ].join("\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model, max_tokens: 2048,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) return json({ error: `Anthropic: ${await res.text()}` }, 502);

    const body = await res.json();
    const text: string = body.content?.[0]?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return json({ error: "AI did not return JSON", raw: text }, 502);

    const parsed = JSON.parse(match[0]);
    const knownIds = new Set((services ?? []).map((s: { id: string }) => s.id));
    const suggestions = (parsed.suggestions ?? [])
      .filter((s: { service_id?: string }) => s.service_id && knownIds.has(s.service_id))
      .map((s: { service_id: string; qty?: number; confidence?: number; reasoning?: string }) => ({
        service_id: s.service_id,
        qty: Math.max(0.25, Number(s.qty ?? 1)),
        confidence: Math.max(0, Math.min(1, Number(s.confidence ?? 0))),
        reasoning: String(s.reasoning ?? "").slice(0, 500),
      }));

    return json({ suggestions });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors() } });
}
function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}
```

- [ ] **Step 2: Deploy via `mcp__cc-supabase__deploy_edge_function`.**

- [ ] **Step 3: Smoke invoke with a real scoped brief_id; verify array of suggestions returned with real service_ids.**

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/suggest-services
git commit -m "feat: suggest-services edge function (ranked catalogue matches)"
```

---

## Task 28: `draft-sow` Edge Function

**Files:**
- Create: `supabase/functions/draft-sow/index.ts`

- [ ] **Step 1: Write function — include master SoWs in the prompt**

Because Edge Functions can't read repo files, the caller passes the SoW bundle as part of the request. Alternative: mirror the JSON into a Storage bucket read at function cold-start. Choose request-payload path for simplicity; the bundle is small (~100 KB).

```ts
// supabase/functions/draft-sow/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Request:  { quote_id: string; master_sows: Array<{ slug: string; title: string; body_md: string }> }
// Response: { sow_html: string }

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not set" }, 500);
    const { quote_id, master_sows } = await req.json();
    if (!quote_id) return json({ error: "quote_id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    const { data: settings } = await supabase.from("settings").select("anthropic_model").eq("id", 1).single();
    const { data: quote, error: qErr } = await supabase
      .from("quotes").select("*, scope:scopes(*, brief:briefs(*, client:clients(*)))")
      .eq("id", quote_id).single();
    if (qErr || !quote) return json({ error: qErr?.message ?? "Quote not found" }, 404);

    const { data: qsvcs } = await supabase
      .from("quote_services").select("*, service:services(*)")
      .eq("quote_id", quote_id).order("ordinal");

    const model = settings?.anthropic_model ?? "claude-sonnet-4-6";

    const system = [
      "You are drafting a Statement of Work for Converted Click, a South African digital agency.",
      "Use the master SoW templates below as reference. Produce HTML, not Markdown.",
      "Sections, in order: Overview, Deliverables (one subsection per service), Exclusions, Terms, Pricing Summary.",
      "Use <h2> for section headings, <h3> for subsections, <p>, <ul>, <li>, <table> as needed.",
      "Do not invent scope commitments not present in the locked scope and selected services.",
      "",
      "Master SoW templates:",
      (master_sows ?? []).map((s: { title: string; body_md: string }) =>
        `--- ${s.title} ---\n${s.body_md.slice(0, 3000)}`
      ).join("\n\n"),
    ].join("\n");

    const scope = (quote as { scope: { enhanced_prose?: string; in_scope_md?: string; out_of_scope_md?: string; brief?: { raw_subject?: string; client?: { name?: string } | null } | null } }).scope;
    const user = [
      `Client: ${scope.brief?.client?.name ?? "Client"}`,
      `Subject: ${scope.brief?.raw_subject ?? ""}`,
      "",
      "Scope:",
      scope.enhanced_prose ?? "",
      "",
      "In scope:",
      scope.in_scope_md ?? "",
      "",
      "Out of scope:",
      scope.out_of_scope_md ?? "",
      "",
      "Selected services:",
      (qsvcs ?? []).map((q: { service: { name: string; code: string | null; scope_definition: string | null }; qty: number }) =>
        `- ${q.service.name} (qty ${q.qty})${q.service.scope_definition ? `: ${q.service.scope_definition.slice(0, 200)}` : ""}`
      ).join("\n"),
    ].join("\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model, max_tokens: 4096,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) return json({ error: `Anthropic: ${await res.text()}` }, 502);

    const body = await res.json();
    const sow_html: string = body.content?.[0]?.text ?? "";
    if (!sow_html) return json({ error: "AI returned empty content" }, 502);

    return json({ sow_html });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors() } });
}
function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}
```

- [ ] **Step 2: Deploy + smoke invoke** (call from a quick `curl` with a known `quote_id` and the `master_sows` JSON).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/draft-sow
git commit -m "feat: draft-sow edge function (claude composes html sow)"
```

---

## Task 29: `ProjectBuilder` page + `QuoteLineEditor` + `SOWPreview` + `AISuggestModal`

This is the largest UI task. Split into sub-steps.

**Files:**
- Create: `src/components/QuoteLineEditor.tsx`
- Create: `src/components/SOWPreview.tsx`
- Create: `src/components/AISuggestModal.tsx`
- Modify: `src/pages/ProjectBuilder.tsx`

### 29a — `QuoteLineEditor`

- [ ] **Step 1: Build per-line editor (one card per quote_service row)**

```tsx
// src/components/QuoteLineEditor.tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { X } from "lucide-react";
import type { Database } from "@/types/db";

type Service = Database["public"]["Tables"]["services"]["Row"];
type Dept = Database["public"]["Tables"]["departments"]["Row"];

export type EditorLine = {
  service_id: string;
  qty: number;
  allocation: Record<string, number>; // dept_id -> pct
  hours: Record<string, number>;      // dept_id -> hours (derived or overridden)
};

type Props = {
  line: EditorLine;
  service: Service;
  depts: Dept[];
  onChange: (patch: Partial<EditorLine>) => void;
  onRemove: () => void;
};

export function QuoteLineEditor({ line, service, depts, onChange, onRemove }: Props) {
  const sumPct = Object.values(line.allocation).reduce((a, b) => a + b, 0);
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-title-small">{service.name}</div>
            <div className="text-label-small text-m-on-surface-variant">{service.code ?? ""}</div>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={`qty-${line.service_id}`}>Qty</Label>
            <Input id={`qty-${line.service_id}`} type="number" step="0.25" min="0.25" className="w-20"
              value={line.qty} onChange={(e) => onChange({ qty: Number(e.target.value) })} />
            <Button variant="ghost" size="icon" onClick={onRemove}><X className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {depts.map((d) => (
            <div key={d.id} className="flex items-center gap-2">
              <span className="w-24 text-label-small">{d.name}</span>
              <Input type="number" step="0.5" className="w-20"
                value={line.allocation[d.id] ?? 0}
                onChange={(e) => onChange({
                  allocation: { ...line.allocation, [d.id]: Number(e.target.value) }
                })} />
              <span className="text-label-small text-m-on-surface-variant">%</span>
              <span className="ml-auto text-label-small">{(line.hours[d.id] ?? 0).toFixed(2)}h</span>
            </div>
          ))}
        </div>
        <div className={sumPct < 99.5 || sumPct > 100.5
          ? "text-body-small text-destructive"
          : "text-body-small text-m-on-surface-variant"}>
          Allocation sum: {sumPct.toFixed(2)}%
        </div>
      </CardContent>
    </Card>
  );
}
```

### 29b — `SOWPreview`

- [ ] **Step 2: Build preview with edit mode toggle**

```tsx
// src/components/SOWPreview.tsx
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

type Props = {
  html: string;
  onChange: (html: string) => void;
};

export function SOWPreview({ html, onChange }: Props) {
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex gap-2">
        <Button size="sm" variant={mode === "preview" ? "default" : "secondary"} onClick={() => setMode("preview")}>Preview</Button>
        <Button size="sm" variant={mode === "edit" ? "default" : "secondary"} onClick={() => setMode("edit")}>Edit HTML</Button>
      </div>
      {mode === "preview" ? (
        <div className="prose max-w-none rounded-md border border-m-outline-variant bg-m-surface p-4 overflow-auto"
             dangerouslySetInnerHTML={{ __html: html || "<em>No SOW drafted yet.</em>" }} />
      ) : (
        <Textarea rows={24} value={html} onChange={(e) => onChange(e.target.value)} className="font-mono text-body-small" />
      )}
    </div>
  );
}
```

### 29c — `AISuggestModal`

- [ ] **Step 3: Build per-suggestion accept/reject/skip modal**

```tsx
// src/components/AISuggestModal.tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type Suggestion = {
  service_id: string;
  service_name: string;
  qty: number;
  confidence: number;
  reasoning: string;
};

type Props = {
  open: boolean;
  suggestions: Suggestion[];
  onClose: () => void;
  onAccept: (accepted: Suggestion[]) => void;
};

export function AISuggestModal({ open, suggestions, onClose, onAccept }: Props) {
  const [decisions, setDecisions] = useState<Record<string, "accept" | "reject" | "skip">>({});

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Suggested services</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-auto">
          {suggestions.map((s) => (
            <div key={s.service_id} className="rounded-md border border-m-outline-variant p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-title-small">{s.service_name}</div>
                  <div className="text-label-small text-m-on-surface-variant">
                    Qty {s.qty} · Confidence {(s.confidence * 100).toFixed(0)}%
                  </div>
                  <div className="mt-1 text-body-small">{s.reasoning}</div>
                </div>
                <div className="flex gap-1">
                  {(["accept", "reject", "skip"] as const).map((d) => (
                    <Button key={d}
                      size="sm"
                      variant={decisions[s.service_id] === d ? "default" : "secondary"}
                      onClick={() => setDecisions({ ...decisions, [s.service_id]: d })}
                    >{d}</Button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => {
            const accepted = suggestions.filter((s) => decisions[s.service_id] === "accept");
            onAccept(accepted);
          }}>Add accepted</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### 29d — `ProjectBuilder` page

- [ ] **Step 4: Wire everything together**

```tsx
// src/pages/ProjectBuilder.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { QuoteLineEditor, type EditorLine } from "@/components/QuoteLineEditor";
import { SOWPreview } from "@/components/SOWPreview";
import { AISuggestModal, type Suggestion } from "@/components/AISuggestModal";
import { ServicePicker } from "@/components/ServicePicker";
import { useBrief, useUpdateBrief } from "@/hooks/useBriefs";
import { useScope } from "@/hooks/useScopes";
import { useServices } from "@/hooks/useServices";
import { useDepartments } from "@/hooks/useDepartments";
import {
  useLiveQuoteForScope, useCreateQuote, useUpdateQuote, useReplaceQuoteServices,
} from "@/hooks/useQuotes";
import { aggregateTotals, buildLineItems, type QuoteLine } from "@/lib/quotes";
import { supabase } from "@/lib/supabase";
import masterSows from "@/data/master-sows.json";
import { formatZar } from "@/lib/utils";

export function ProjectBuilder() {
  const { id: briefId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: brief } = useBrief(briefId);
  const { data: scope } = useScope(briefId);
  const { data: services = [] } = useServices();
  const { data: depts = [] } = useDepartments();
  const { data: liveQuote } = useLiveQuoteForScope(scope?.id);
  const createQuote = useCreateQuote();
  const updateQuote = useUpdateQuote();
  const replaceSvcs = useReplaceQuoteServices();
  const updateBrief = useUpdateBrief();

  const [lines, setLines] = useState<EditorLine[]>([]);
  const [marginPct, setMarginPct] = useState(0);
  const [discountPct, setDiscountPct] = useState(0);
  const [sowHtml, setSowHtml] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [drafting, setDrafting] = useState(false);

  // Ensure a draft quote exists for this scope on first load
  useEffect(() => {
    if (!scope || liveQuote) return;
    void createQuote.mutateAsync({ scope_id: scope.id, version: 1, status: "draft" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope?.id, liveQuote?.id]);

  // Hydrate editor state from the live quote
  useEffect(() => {
    if (!liveQuote) return;
    setMarginPct(Number(liveQuote.margin_pct));
    setDiscountPct(Number(liveQuote.discount_room_pct));
    setSowHtml(liveQuote.sow_html ?? "");
    void hydrateLines(liveQuote.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveQuote?.id]);

  async function hydrateLines(quoteId: string) {
    const { data } = await supabase.from("quote_services").select("*").eq("quote_id", quoteId).order("ordinal");
    setLines((data ?? []).map((r): EditorLine => {
      const allocation = (r.allocation_override as Record<string, number> | null) ?? deriveAllocationPct(r.service_id);
      const hours = (r.hours_override as Record<string, number> | null) ?? {};
      return { service_id: r.service_id, qty: Number(r.qty), allocation, hours };
    }));
  }

  function deriveAllocationPct(serviceId: string): Record<string, number> {
    // TODO fetch from service_allocation_resolved view; placeholder: empty
    return {};
  }

  const lineTotals = useMemo<QuoteLine[]>(() => {
    return lines.map((l) => {
      const svc = services.find((s) => s.id === l.service_id);
      return {
        service_id: l.service_id,
        service_name: svc?.name ?? "Unknown",
        xero_code: svc?.code ?? null,
        qty: l.qty,
        unit_price_cents: svc?.sell_price_cents ?? 0,
        allocation: Object.entries(l.allocation).map(([dept_id, pct]) => ({ dept_id, pct })),
      };
    });
  }, [lines, services]);

  const totals = aggregateTotals(lineTotals, { margin_pct: marginPct, discount_room_pct: discountPct });

  async function addService(serviceId: string) {
    if (lines.some((l) => l.service_id === serviceId)) return;
    const { data: resolved } = await supabase
      .from("service_allocation_resolved").select("*").eq("service_id", serviceId);
    const allocation: Record<string, number> = {};
    const hours: Record<string, number> = {};
    for (const r of (resolved ?? []) as Array<{ department_id: string; pct: number | null; hours: number | null }>) {
      allocation[r.department_id] = Number(r.pct ?? 0);
      hours[r.department_id] = Number(r.hours ?? 0);
    }
    setLines([...lines, { service_id: serviceId, qty: 1, allocation, hours }]);
  }

  async function saveLines() {
    if (!liveQuote) return;
    await replaceSvcs.mutateAsync({
      quoteId: liveQuote.id,
      rows: lines.map((l, i) => ({
        service_id: l.service_id, qty: l.qty,
        allocation_override: l.allocation, hours_override: l.hours,
        ordinal: i + 1, notes: null,
      })),
    });
  }

  async function aiSuggest() {
    if (!briefId) return;
    const { data, error } = await supabase.functions.invoke("suggest-services", { body: { brief_id: briefId } });
    if (error) { toast.error(error.message); return; }
    setSuggestions((data.suggestions as Array<{ service_id: string; qty: number; confidence: number; reasoning: string }>)
      .map((s) => ({ ...s, service_name: services.find((x) => x.id === s.service_id)?.name ?? "Unknown" })));
    setSuggestOpen(true);
  }

  async function draftSow() {
    if (!liveQuote) return;
    setDrafting(true);
    await saveLines();
    const { data, error } = await supabase.functions.invoke("draft-sow", {
      body: { quote_id: liveQuote.id, master_sows: masterSows },
    });
    setDrafting(false);
    if (error) { toast.error(error.message); return; }
    setSowHtml(data.sow_html);
    await updateQuote.mutateAsync({ id: liveQuote.id, patch: { sow_html: data.sow_html } });
    toast.success("Drafted");
  }

  async function finalise() {
    if (!liveQuote || !briefId) return;
    await saveLines();
    const snapshot = buildLineItems(lineTotals, depts);
    await updateQuote.mutateAsync({
      id: liveQuote.id,
      patch: {
        line_items_jsonb: snapshot,
        subtotal_cents: totals.subtotal_cents,
        total_cents: totals.total_cents,
        margin_pct: marginPct,
        discount_room_pct: discountPct,
        sow_html: sowHtml,
      },
    });
    // Render PDF
    const { data: pdfRes, error: pdfErr } = await supabase.functions.invoke("render-sow-pdf", {
      body: { quote_id: liveQuote.id },
    });
    if (pdfErr) { toast.error(`PDF render failed: ${pdfErr.message}`); return; }
    await updateQuote.mutateAsync({ id: liveQuote.id, patch: { sow_pdf_url: pdfRes.url } });
    await updateBrief.mutateAsync({ id: briefId, patch: { status: "quoted" } });
    navigate(`/quotes/${liveQuote.id}/send`);
  }

  if (!brief || !scope) return <div className="p-6">Loading…</div>;

  return (
    <div className="grid h-[calc(100vh-4rem)] grid-cols-[minmax(280px,340px)_1fr_minmax(320px,440px)] gap-4 p-4">
      <aside className="overflow-auto space-y-3">
        <Card><CardContent className="p-4 space-y-3">
          <h2 className="text-title-small">Locked scope</h2>
          <div className="text-body-small whitespace-pre-wrap">{scope.enhanced_prose}</div>
          <Tabs defaultValue="in">
            <TabsList>
              <TabsTrigger value="in">In</TabsTrigger>
              <TabsTrigger value="out">Out</TabsTrigger>
              <TabsTrigger value="q">Questions</TabsTrigger>
            </TabsList>
            <TabsContent value="in"><pre className="text-body-small whitespace-pre-wrap">{scope.in_scope_md}</pre></TabsContent>
            <TabsContent value="out"><pre className="text-body-small whitespace-pre-wrap">{scope.out_of_scope_md}</pre></TabsContent>
            <TabsContent value="q"><pre className="text-body-small whitespace-pre-wrap">{scope.open_questions_md}</pre></TabsContent>
          </Tabs>
        </CardContent></Card>
      </aside>

      <section className="overflow-auto space-y-3">
        <div className="flex items-center gap-2">
          <ServicePicker onPick={addService} />
          <Button variant="secondary" onClick={aiSuggest}>AI suggest services</Button>
          <Button variant="secondary" onClick={draftSow} disabled={drafting || lines.length === 0}>
            {drafting ? "Drafting…" : "Draft SOW"}
          </Button>
        </div>

        {lines.map((l, i) => {
          const svc = services.find((s) => s.id === l.service_id)!;
          return (
            <QuoteLineEditor key={l.service_id} line={l} service={svc} depts={depts}
              onChange={(patch) => {
                const next = [...lines]; next[i] = { ...l, ...patch, allocation: patch.allocation ?? l.allocation };
                setLines(next);
              }}
              onRemove={() => setLines(lines.filter((x) => x.service_id !== l.service_id))}
            />
          );
        })}

        <Card><CardContent className="p-4 space-y-2">
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Margin %</Label>
              <Input type="number" step="0.5" value={marginPct} onChange={(e) => setMarginPct(Number(e.target.value))} /></div>
            <div><Label>Discount room %</Label>
              <Input type="number" step="0.5" value={discountPct} onChange={(e) => setDiscountPct(Number(e.target.value))} /></div>
            <div><Label>Total</Label>
              <div className="text-title-medium">{formatZar(totals.total_cents)}</div></div>
          </div>
          <div className="flex justify-between">
            <Button variant="secondary" onClick={saveLines}>Save draft</Button>
            <Button onClick={finalise} disabled={lines.length === 0 || !sowHtml}>Finalise quote</Button>
          </div>
        </CardContent></Card>
      </section>

      <aside className="overflow-hidden">
        <SOWPreview html={sowHtml} onChange={setSowHtml} />
      </aside>

      <AISuggestModal open={suggestOpen} suggestions={suggestions}
        onClose={() => setSuggestOpen(false)}
        onAccept={(accepted) => {
          setSuggestOpen(false);
          for (const s of accepted) void addService(s.service_id);
        }} />
    </div>
  );
}
```

- [ ] **Step 5: Manual smoke**

1. From `/briefs/:id/scope` lock a scope → navigates here.
2. Add 2 services via picker, adjust qty + allocation.
3. Totals update live. Margin/discount sliders recompute.
4. Click AI suggest → modal shows Claude's ranked list → accept 1-2 → lines added.
5. Click Draft SOW → preview populates with HTML. Toggle to Edit HTML; tweak; toggle back.
6. Click Finalise → PDF renders, `quotes.sow_pdf_url` set, brief status → `quoted`, navigates to `/quotes/:id/send`.

- [ ] **Step 6: Commit**

```bash
git add src/components/QuoteLineEditor.tsx src/components/SOWPreview.tsx src/components/AISuggestModal.tsx src/pages/ProjectBuilder.tsx
git commit -m "feat: project builder page (service picker, live totals, sow preview, ai suggest, finalise)"
```

---

## Task 30: `render-sow-pdf` Edge Function (real version)

Replaces the Task 16 spike. Loads the quote, renders a structured PDF, uploads to Storage, returns a signed URL.

**Files:**
- Modify: `supabase/functions/render-sow-pdf/index.ts`
- Create: `src/content/sow-template.tsx` (referenced only for HTML→PDF element mapping; actual PDF rendering happens in Deno)

- [ ] **Step 1: Rewrite the function to do the real work**

```ts
// supabase/functions/render-sow-pdf/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import React from "npm:react@18.3.1";
import {
  Document, Page, Text, View, StyleSheet, renderToBuffer,
} from "npm:@react-pdf/renderer@3";

// Request:  { quote_id: string }
// Response: { url: string } — signed Supabase Storage URL (90-day TTL)

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  h1: { fontSize: 20, marginBottom: 10 },
  h2: { fontSize: 14, marginTop: 12, marginBottom: 6 },
  h3: { fontSize: 11, marginTop: 8, marginBottom: 4, fontFamily: "Helvetica-Bold" },
  p: { marginBottom: 6, lineHeight: 1.4 },
  li: { marginLeft: 12, marginBottom: 3 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  footer: { marginTop: 20, fontSize: 8, color: "#555" },
});

/**
 * Minimal HTML → react-pdf mapper. Supports: h1, h2, h3, p, ul/li, strong, em.
 * Anything else is rendered as plain text.
 */
function htmlToElements(html: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Strip whitespace between tags, lowercase tag names.
  const tokens = html.replace(/\s+/g, " ").matchAll(/<(\/?[a-z0-9]+)[^>]*>([^<]*)/gi);
  let listOpen = false;
  let idx = 0;
  for (const m of tokens) {
    const tag = m[1].toLowerCase();
    const text = (m[2] ?? "").trim();
    if (tag === "h1") out.push(React.createElement(Text, { key: idx++, style: styles.h1 }, text));
    else if (tag === "h2") out.push(React.createElement(Text, { key: idx++, style: styles.h2 }, text));
    else if (tag === "h3") out.push(React.createElement(Text, { key: idx++, style: styles.h3 }, text));
    else if (tag === "p" && text) out.push(React.createElement(Text, { key: idx++, style: styles.p }, text));
    else if (tag === "ul") { listOpen = true; }
    else if (tag === "/ul") { listOpen = false; }
    else if (tag === "li" && text) out.push(React.createElement(Text, { key: idx++, style: styles.li }, `• ${text}`));
    else if (text) out.push(React.createElement(Text, { key: idx++, style: styles.p }, text));
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const { quote_id } = await req.json();
    if (!quote_id) return json({ error: "quote_id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    const { data: quote, error } = await supabase
      .from("quotes").select("*, scope:scopes(*, brief:briefs(*, client:clients(*)))")
      .eq("id", quote_id).single();
    if (error || !quote) return json({ error: error?.message ?? "Not found" }, 404);

    const client = (quote as { scope: { brief: { client: { name: string } | null } | null } }).scope.brief?.client;
    const totalZar = (Number(quote.total_cents) / 100).toLocaleString("en-ZA", { style: "currency", currency: "ZAR" });

    const doc = React.createElement(
      Document,
      null,
      React.createElement(
        Page, { size: "A4", style: styles.page },
        React.createElement(View, { style: styles.row },
          React.createElement(Text, { style: styles.h1 }, "Statement of Work"),
          React.createElement(Text, null, `v${quote.version}`),
        ),
        React.createElement(Text, null, `Client: ${client?.name ?? "Client"}`),
        ...htmlToElements(quote.sow_html ?? ""),
        React.createElement(View, { style: styles.h2 }),
        React.createElement(Text, { style: styles.h2 }, "Pricing Summary"),
        React.createElement(Text, { style: styles.p }, `Subtotal: ${(Number(quote.subtotal_cents) / 100).toLocaleString("en-ZA", { style: "currency", currency: "ZAR" })}`),
        React.createElement(Text, { style: styles.p }, `Total: ${totalZar}`),
        React.createElement(Text, { style: styles.footer }, "Converted Click · converted click.co.za"),
      )
    );

    const buf = await renderToBuffer(doc);
    const path = `${quote_id}/sow-v${quote.version}.pdf`;
    const { error: upErr } = await supabase.storage.from("quote-pdfs").upload(path, buf, {
      contentType: "application/pdf", upsert: true,
    });
    if (upErr) return json({ error: upErr.message }, 500);

    const { data: signed, error: signErr } = await supabase.storage.from("quote-pdfs")
      .createSignedUrl(path, 60 * 60 * 24 * 90);
    if (signErr || !signed) return json({ error: signErr?.message ?? "sign failed" }, 500);

    return json({ url: signed.signedUrl });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors() } });
}
function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}
```

- [ ] **Step 2: Deploy + invoke with a real `quote_id`.**

Expected: `{ url: "https://…supabase.co/storage/v1/object/sign/quote-pdfs/…" }`. Open the URL in a browser; PDF displays with the SOW content.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/render-sow-pdf
git commit -m "feat: render-sow-pdf real implementation (html → react-pdf → storage)"
```

---

## Task 31: `QuoteSend` page (`/quotes/:id/send`)

**Files:**
- Modify: `src/pages/QuoteSend.tsx`

- [ ] **Step 1: Build page**

```tsx
// src/pages/QuoteSend.tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { FeatureFlagGate } from "@/components/FeatureFlagGate";
import { useQuote, useUpdateQuote } from "@/hooks/useQuotes";
import { supabase } from "@/lib/supabase";
import { mailto } from "@/lib/mailto";
import { sendQuoteEmail } from "@/content/email-templates";

export function QuoteSend() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data } = useQuote(id);
  const update = useUpdateQuote();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipient, setRecipient] = useState("");

  useEffect(() => {
    if (!data) return;
    (async () => {
      const scope = await supabase.from("scopes").select("*, brief:briefs(*, client:clients(*), sender_email)")
        .eq("id", data.quote.scope_id).single();
      const brief = (scope.data as { brief: { raw_subject: string; sender_email: string | null; client: { name: string } | null } }).brief;
      const tmpl = sendQuoteEmail({ subject: brief.raw_subject, clientName: brief.client?.name ?? null });
      setSubject(tmpl.subject);
      setBody(tmpl.body);
      setRecipient(brief.sender_email ?? "");
    })();
  }, [data]);

  if (!data) return <div className="p-6">Loading…</div>;
  const q = data.quote;

  const openEmail = async () => {
    if (!q.sow_pdf_url) { toast.error("No PDF on this quote"); return; }
    const link = document.createElement("a");
    link.href = q.sow_pdf_url;
    link.download = `SOW-${q.id}.pdf`;
    document.body.appendChild(link); link.click(); link.remove();
    window.open(mailto({ to: recipient, subject, body }), "_blank");
  };

  const markSent = async () => {
    await update.mutateAsync({ id: q.id, patch: { status: "sent", sent_at: new Date().toISOString() } });
    toast.success("Marked sent");
    navigate(`/quotes/${q.id}`);
  };

  return (
    <div className="container mx-auto max-w-3xl p-6 space-y-4">
      <Card><CardContent className="p-4 space-y-3">
        <div className="space-y-2"><Label>To</Label>
          <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} type="email" /></div>
        <div className="space-y-2"><Label>Subject</Label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="space-y-2"><Label>Body</Label>
          <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} /></div>
      </CardContent></Card>

      <div className="flex gap-2">
        <Button onClick={openEmail} disabled={!recipient}>Open email + download PDF</Button>
        <Button variant="secondary" onClick={markSent}>Mark as sent</Button>
        <FeatureFlagGate flag="xero_enabled">
          <Button variant="secondary" onClick={() => toast("Phase 2 — not yet implemented")}>Push to Xero</Button>
        </FeatureFlagGate>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Smoke — finalise a quote from the builder, land here, click Open email → browser downloads PDF and opens Gmail compose.**

- [ ] **Step 3: Commit**

```bash
git add src/pages/QuoteSend.tsx
git commit -m "feat: quote send page (mailto + pdf download, xero gated)"
```

---

## Task 32: `QuoteDetail` page — Accept / Reject / Revise

**Files:**
- Modify: `src/pages/QuoteDetail.tsx`

- [ ] **Step 1: Build page**

```tsx
// src/pages/QuoteDetail.tsx
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuote, useUpdateQuote, useCreateQuote, useReplaceQuoteServices } from "@/hooks/useQuotes";
import { useSettings } from "@/hooks/useSettings";
import { useCurrentUserName } from "@/hooks/useCurrentUserName";
import { supabase } from "@/lib/supabase";
import { formatZar } from "@/lib/utils";

export function QuoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data } = useQuote(id);
  const { data: settings } = useSettings();
  const user = useCurrentUserName();
  const update = useUpdateQuote();
  const create = useCreateQuote();
  const replaceSvcs = useReplaceQuoteServices();

  if (!data) return <div className="p-6">Loading…</div>;
  const q = data.quote;

  const accept = async () => {
    await update.mutateAsync({
      id: q.id,
      patch: { status: "accepted", accepted_at: new Date().toISOString(), accepted_by: user },
    });
    if (settings?.clickup_enabled) {
      const { error } = await supabase.functions.invoke("push-to-clickup", { body: { quote_id: q.id } });
      if (error) toast.error(`ClickUp push failed: ${error.message}`);
      else toast.success("Accepted + pushed to ClickUp");
    } else {
      toast.success("Accepted (ClickUp disabled — use Retry push when ready)");
    }
    navigate(`/quotes/${q.id}`);
  };

  const reject = async () => {
    const reason = window.prompt("Rejection reason:") ?? "";
    await update.mutateAsync({
      id: q.id,
      patch: { status: "rejected", rejection_reason: reason || null },
    });
  };

  const retryPush = async () => {
    const { error } = await supabase.functions.invoke("push-to-clickup", { body: { quote_id: q.id } });
    if (error) toast.error(error.message); else toast.success("Pushed");
  };

  const revise = async () => {
    // Mark old as superseded; create new version; copy services + html.
    await update.mutateAsync({ id: q.id, patch: { status: "superseded" } });
    const newQuote = await create.mutateAsync({
      scope_id: q.scope_id, version: q.version + 1, status: "draft",
      sow_html: q.sow_html, margin_pct: q.margin_pct, discount_room_pct: q.discount_room_pct,
    });
    await replaceSvcs.mutateAsync({
      quoteId: newQuote.id,
      rows: data.services.map((s) => ({
        service_id: s.service_id, qty: Number(s.qty),
        allocation_override: s.allocation_override, hours_override: s.hours_override,
        ordinal: s.ordinal, notes: s.notes,
      })),
    });
    // Get brief id from scope
    const { data: scope } = await supabase.from("scopes").select("brief_id").eq("id", q.scope_id).single();
    if (scope) navigate(`/briefs/${scope.brief_id}/builder`);
  };

  return (
    <div className="container mx-auto max-w-3xl p-6 space-y-4">
      <Card><CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <h1 className="text-headline-small">Quote v{q.version}</h1>
          <Badge>{q.status}</Badge>
        </div>
        <div>Total: <strong>{formatZar(Number(q.total_cents))}</strong></div>
        {q.sow_pdf_url && (<a className="text-primary underline" href={q.sow_pdf_url} target="_blank" rel="noreferrer">Download PDF</a>)}
      </CardContent></Card>

      <div className="flex gap-2">
        {q.status === "sent" && (<>
          <Button onClick={accept}>Mark accepted</Button>
          <Button variant="secondary" onClick={reject}>Mark rejected</Button>
          <Button variant="ghost" onClick={revise}>Revise</Button>
        </>)}
        {q.status === "accepted" && !settings?.clickup_enabled && (
          <Button variant="secondary" onClick={retryPush}>Retry ClickUp push</Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Smoke**

Mark sent → Mark accepted (with ClickUp disabled) → status=accepted, toast says deferred. Then flip ClickUp toggle in Settings on, return, click Retry push.

- [ ] **Step 3: Commit**

```bash
git add src/pages/QuoteDetail.tsx
git commit -m "feat: quote detail page (accept, reject, revise, retry push)"
```

---

## Task 33: `push-to-clickup` Edge Function

**Files:**
- Create: `supabase/functions/push-to-clickup/index.ts`

- [ ] **Step 1: Write function**

```ts
// supabase/functions/push-to-clickup/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Request:  { quote_id: string }
// Response: { project_id: string; clickup_parent_task_id: string; child_count: number }
//
// Preconditions: settings.clickup_enabled=true, settings.clickup_pat set, settings.clickup_workspace_id set.
// Behaviour: creates parent task + per-dept child tasks; posts BRIEF:: comment per child;
// inserts projects row + project_actuals rows (planned_hours from allocation snapshot).

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const { quote_id } = await req.json();
    if (!quote_id) return json({ error: "quote_id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    const { data: settings } = await supabase.from("settings").select("*").eq("id", 1).single();
    if (!settings?.clickup_enabled) return json({ error: "ClickUp disabled in settings" }, 400);
    if (!settings.clickup_pat || !settings.clickup_workspace_id) {
      return json({ error: "ClickUp PAT or workspace_id missing" }, 400);
    }

    const { data: quote, error } = await supabase
      .from("quotes").select("*, scope:scopes(*, brief:briefs(*, client:clients(*)))")
      .eq("id", quote_id).single();
    if (error || !quote) return json({ error: error?.message ?? "Not found" }, 404);

    const scope = (quote as { scope: { brief: { raw_subject: string | null; client_id: string; client: { id: string; name: string; clickup_folder_id: string | null } | null } | null } }).scope;
    const client = scope.brief?.client;
    if (!client) return json({ error: "Client missing" }, 400);

    const CU = {
      headers: {
        "Authorization": settings.clickup_pat!,
        "Content-Type": "application/json",
      },
    };

    // Resolve folder id (cache onto clients table)
    let folderId = client.clickup_folder_id;
    if (!folderId) {
      const foldersRes = await fetch(
        `https://api.clickup.com/api/v2/team/${settings.clickup_workspace_id}/space`,
        CU
      );
      if (!foldersRes.ok) return json({ error: `CU spaces: ${await foldersRes.text()}` }, 502);
      const spaces = await foldersRes.json();
      // Simple substring match; refine with user input if needed
      const space = (spaces.spaces ?? [])
        .find((s: { name: string }) => s.name.toLowerCase().includes(client.name.toLowerCase()));
      if (!space) return json({ error: `No ClickUp space found for client ${client.name}` }, 404);
      folderId = space.id;
      await supabase.from("clients").update({ clickup_folder_id: folderId }).eq("id", client.id);
    }

    // Find "Projects" list inside folder
    const listsRes = await fetch(`https://api.clickup.com/api/v2/folder/${folderId}/list`, CU);
    if (!listsRes.ok) return json({ error: `CU lists: ${await listsRes.text()}` }, 502);
    const lists = await listsRes.json();
    const projectsList = (lists.lists ?? []).find((l: { name: string }) => /projects/i.test(l.name))
      ?? (lists.lists ?? [])[0];
    if (!projectsList) return json({ error: "No list found in client folder" }, 404);

    // Create parent task
    const parentRes = await fetch(`https://api.clickup.com/api/v2/list/${projectsList.id}/task`, {
      ...CU, method: "POST",
      body: JSON.stringify({
        name: scope.brief?.raw_subject ?? "Untitled project",
        description: `Project from quote ${quote.id}`,
      }),
    });
    if (!parentRes.ok) return json({ error: `CU parent: ${await parentRes.text()}` }, 502);
    const parent = await parentRes.json();

    // Load team_members + list_aliases + overrides (for assignee + list resolution)
    const [{ data: team }, { data: aliases }, { data: overrides }] = await Promise.all([
      supabase.from("team_members").select("id,full_name,email,primary_department_id").is("archived_at", null),
      supabase.from("list_aliases").select("*"),
      supabase.from("list_alias_overrides").select("*").eq("client_id", client.id),
    ]);

    const items = (quote.line_items_jsonb as Array<{ service_name: string; allocation: Array<{ dept_id: string; dept_name: string; hours: number }> }>) ?? [];
    const actualsRows: Array<{ project_id: string; clickup_task_id: string; dept_id: string; planned_hours: number }> = [];
    let childCount = 0;

    // Create projects row first so we can reference project_id
    const { data: project } = await supabase.from("projects").insert({
      quote_id: quote.id, clickup_parent_task_id: parent.id, status: "in_progress",
    }).select().single();
    if (!project) return json({ error: "Failed to create project row" }, 500);

    for (const item of items) {
      for (const alloc of item.allocation) {
        const assignee = (team ?? []).find((t: { primary_department_id: string | null }) => t.primary_department_id === alloc.dept_id);
        const childRes = await fetch(`https://api.clickup.com/api/v2/task/${parent.id}`, {
          ...CU, method: "POST",
          body: JSON.stringify({
            name: `${item.service_name} — ${alloc.dept_name}`,
            parent: parent.id,
            assignees: assignee ? [Number(assignee.id)] : [],
            time_estimate: Math.round(alloc.hours * 60 * 60_000), // hours → ms
          }),
        });
        if (!childRes.ok) continue; // log and keep going
        const child = await childRes.json();

        // BRIEF:: comment for audit
        await fetch(`https://api.clickup.com/api/v2/task/${child.id}/comment`, {
          ...CU, method: "POST",
          body: JSON.stringify({
            comment_text: `BRIEF:: ${JSON.stringify({
              client_name: client.name,
              engagement_type: "Task",
              work_stream: alloc.dept_name,
              sprint_points: Math.max(1, Math.round(alloc.hours / 4)),
              date_of_engagement: new Date().toISOString().slice(0, 10),
              source_quote_id: quote.id,
            })}`,
          }),
        });

        actualsRows.push({
          project_id: project.id,
          clickup_task_id: child.id,
          dept_id: alloc.dept_id,
          planned_hours: alloc.hours,
        });
        childCount++;
      }
    }

    if (actualsRows.length > 0) {
      await supabase.from("project_actuals").insert(actualsRows);
    }

    return json({ project_id: project.id, clickup_parent_task_id: parent.id, child_count: childCount });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors() } });
}
function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}
```

- [ ] **Step 2: Deploy.**

- [ ] **Step 3: Smoke against a real ClickUp test workspace first.**

Recommend creating a throwaway Folder/List in ClickUp named after a test client (e.g. "Test Client"). Toggle ClickUp on in Settings with a PAT scoped to that workspace. Accept a test quote and verify:
1. Parent task appears in the client's Projects list.
2. Child task(s) appear with `time_estimate` in milliseconds (hover over task; ClickUp will show estimate).
3. `BRIEF::` comment appears on each child with parseable JSON.
4. `select * from project_actuals where project_id = <id>;` returns rows with correct `planned_hours`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/push-to-clickup
git commit -m "feat: push-to-clickup edge function (parent + child tasks + audit comments)"
```

---

## Task 34: `Projects` list page

**Files:**
- Modify: `src/pages/Projects.tsx`

- [ ] **Step 1: Build page**

```tsx
// src/pages/Projects.tsx
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useProjects } from "@/hooks/useProjects";

export function Projects() {
  const { data: projects = [] } = useProjects();
  return (
    <div className="container mx-auto max-w-5xl p-6 space-y-4">
      <h1 className="text-headline-medium">Projects</h1>
      {projects.length === 0 && <div className="text-body-medium">No projects yet. Accept a quote to create one.</div>}
      {projects.map((p) => (
        <Link to={`/projects/${p.id}`} key={p.id}>
          <Card><CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-title-small">{p.clickup_parent_task_id}</div>
              <div className="text-label-small text-m-on-surface-variant">
                Started {new Date(p.started_at).toLocaleDateString("en-ZA")}
              </div>
            </div>
            <Badge>{p.status}</Badge>
          </CardContent></Card>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Projects.tsx
git commit -m "feat: projects list page"
```

---

## Task 35: `BurnChart` component + `ProjectDetail` page

**Files:**
- Create: `src/components/BurnChart.tsx`
- Modify: `src/pages/ProjectDetail.tsx`

- [ ] **Step 1: `BurnChart` component (no external chart lib; CSS flex bars)**

```tsx
// src/components/BurnChart.tsx
import { cn } from "@/lib/utils";

type Row = { dept_name: string; planned: number; actual: number };

export function BurnChart({ rows }: { rows: Row[] }) {
  const max = Math.max(...rows.map((r) => Math.max(r.planned, r.actual)), 1);
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const ratio = r.planned > 0 ? r.actual / r.planned : 0;
        const color = ratio > 1.2 ? "bg-destructive" : ratio > 1.0 ? "bg-amber-500" : "bg-m-primary";
        return (
          <div key={r.dept_name}>
            <div className="flex items-center justify-between text-label-small">
              <span>{r.dept_name}</span>
              <span>{r.actual.toFixed(1)} / {r.planned.toFixed(1)} h</span>
            </div>
            <div className="relative mt-1 h-3 w-full rounded-full bg-m-surface-container">
              <div className="absolute inset-y-0 left-0 rounded-full bg-m-outline-variant"
                   style={{ width: `${(r.planned / max) * 100}%` }} />
              <div className={cn("absolute inset-y-0 left-0 rounded-full", color)}
                   style={{ width: `${(r.actual / max) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: `ProjectDetail` page**

```tsx
// src/pages/ProjectDetail.tsx
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { BurnChart } from "@/components/BurnChart";
import { useProject } from "@/hooks/useProjects";
import { useDepartments } from "@/hooks/useDepartments";

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { data } = useProject(id);
  const { data: depts = [] } = useDepartments();

  const rows = useMemo(() => {
    if (!data) return [];
    const byDept = new Map<string, { planned: number; actual: number }>();
    for (const a of data.actuals) {
      const key = a.dept_id ?? "unknown";
      const cur = byDept.get(key) ?? { planned: 0, actual: 0 };
      cur.planned += Number(a.planned_hours);
      cur.actual += Number(a.actual_hours);
      byDept.set(key, cur);
    }
    return Array.from(byDept.entries()).map(([dept_id, v]) => ({
      dept_name: depts.find((d) => d.id === dept_id)?.name ?? "Unknown",
      planned: v.planned, actual: v.actual,
    }));
  }, [data, depts]);

  if (!data) return <div className="p-6">Loading…</div>;
  const { project, actuals } = data;

  const totalPlanned = rows.reduce((a, r) => a + r.planned, 0);
  const totalActual = rows.reduce((a, r) => a + r.actual, 0);

  return (
    <div className="container mx-auto max-w-4xl p-6 space-y-4">
      <Card><CardContent className="p-4">
        <h1 className="text-headline-small">Project</h1>
        <div className="text-label-small text-m-on-surface-variant">
          Started {new Date(project.started_at).toLocaleDateString("en-ZA")} · Status: {project.status}
        </div>
        <div className="mt-2">
          Planned: <strong>{totalPlanned.toFixed(1)}h</strong> · Actual: <strong>{totalActual.toFixed(1)}h</strong>
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-4"><BurnChart rows={rows} /></CardContent></Card>

      <Card><CardContent className="p-4">
        <h2 className="mb-2 text-title-small">Tasks</h2>
        <table className="w-full text-body-small">
          <thead>
            <tr className="text-left text-label-small text-m-on-surface-variant">
              <th>Task</th><th>Dept</th><th>Planned</th><th>Actual</th><th>Status</th><th>Synced</th>
            </tr>
          </thead>
          <tbody>
            {actuals.map((a) => (
              <tr key={a.id} className="border-t border-m-outline-variant">
                <td className="py-1">{a.clickup_task_id}</td>
                <td>{depts.find((d) => d.id === a.dept_id)?.name ?? "—"}</td>
                <td>{Number(a.planned_hours).toFixed(1)}</td>
                <td>{Number(a.actual_hours).toFixed(1)}</td>
                <td>{a.status_at_sync ?? "—"}</td>
                <td>{new Date(a.synced_at).toLocaleTimeString("en-ZA")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/BurnChart.tsx src/pages/ProjectDetail.tsx
git commit -m "feat: project detail page with burn chart and task table"
```

---

## Task 36: `sync-clickup-actuals` scheduled Edge Function

**Files:**
- Create: `supabase/functions/sync-clickup-actuals/index.ts`

- [ ] **Step 1: Write function**

```ts
// supabase/functions/sync-clickup-actuals/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Invoked on a schedule (see Task 37 below).
// Fetches task status + time entries for every in-progress project's child tasks
// and upserts project_actuals rows by (project_id, clickup_task_id).

Deno.serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // server-side; bypasses anon
    );

    const { data: settings } = await supabase.from("settings").select("*").eq("id", 1).single();
    if (!settings?.clickup_enabled || !settings.clickup_pat) {
      return new Response(JSON.stringify({ skipped: "clickup disabled" }), { headers: { "content-type": "application/json" } });
    }

    const CU = { headers: { "Authorization": settings.clickup_pat!, "Content-Type": "application/json" } };

    const { data: projects } = await supabase.from("projects").select("*").eq("status", "in_progress");
    let updated = 0;
    for (const p of projects ?? []) {
      const { data: actuals } = await supabase.from("project_actuals").select("*").eq("project_id", p.id);
      let allDone = (actuals ?? []).length > 0;
      for (const a of actuals ?? []) {
        const tRes = await fetch(`https://api.clickup.com/api/v2/task/${a.clickup_task_id}?include_subtasks=false`, CU);
        if (!tRes.ok) { allDone = false; continue; }
        const task = await tRes.json();

        const teRes = await fetch(`https://api.clickup.com/api/v2/task/${a.clickup_task_id}/time`, CU);
        const timeEntries = teRes.ok ? (await teRes.json()).data : null;
        const actualHours = (timeEntries ?? []).reduce(
          (acc: number, e: { duration?: string }) => acc + Number(e.duration ?? 0) / 3_600_000, 0
        );

        const status = task.status?.status?.toLowerCase() ?? null;
        if (status !== "complete" && status !== "closed" && status !== "done") allDone = false;

        await supabase.from("project_actuals").update({
          actual_hours: actualHours,
          time_entries: timeEntries,
          status_at_sync: status,
          synced_at: new Date().toISOString(),
        }).eq("id", a.id);
        updated++;
      }
      if (allDone) {
        await supabase.from("projects").update({
          status: "completed", completed_at: new Date().toISOString(),
        }).eq("id", p.id);
      }
    }

    return new Response(JSON.stringify({ updated }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
});
```

- [ ] **Step 2: Deploy.**

- [ ] **Step 3: Test one-shot invocation**

```bash
curl -X POST "https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/sync-clickup-actuals" \
  -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"
```

Expected: `{ "updated": N }`. Verify `project_actuals.synced_at` is recent.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/sync-clickup-actuals
git commit -m "feat: sync-clickup-actuals edge function (task status + time entries)"
```

---

## Task 37: Schedule `sync-clickup-actuals` to run every 30 min

Supabase scheduled functions use the `pg_cron` extension and `net.http_post`.

**Files:**
- Create: `supabase/migrations/0011_cron_sync_actuals.sql`

- [ ] **Step 1: Write migration**

```sql
-- 0011_cron_sync_actuals.sql
-- Apply via mcp__cc-supabase__apply_migration (name: cron_sync_actuals)

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Remove any prior schedule with the same name
select cron.unschedule('sync-clickup-actuals-30min') where exists (
  select 1 from cron.job where jobname = 'sync-clickup-actuals-30min'
);

select cron.schedule(
  'sync-clickup-actuals-30min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/sync-clickup-actuals',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    )
  );
  $$
);
```

Note: the cron cadence is fixed at 30 minutes here. The spec lets `settings.burn_sync_cron_minutes` override it, but pg_cron schedules are static — Phase 1 ships with a fixed 30-min cron; updating the setting at runtime **does not** reschedule. Document this in the Settings page: "Cadence applies after admin reschedule" (out-of-scope for Phase 1). If truly needed in Phase 1, add a manual "Reschedule cron" button wired to an Edge Function that runs `cron.unschedule` + `cron.schedule` with the new cadence.

- [ ] **Step 2: Ensure `service_role_key` is in Supabase Vault**

Skip if already present. If not, add via Supabase Dashboard → Vault, then re-apply this migration.

- [ ] **Step 3: Apply migration.** Verify with:

```sql
select jobname, schedule from cron.job;
```

Expected: one row named `sync-clickup-actuals-30min` with schedule `*/30 * * * *`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0011_cron_sync_actuals.sql
git commit -m "feat: schedule sync-clickup-actuals every 30 minutes via pg_cron"
```

---

## Task 38: End-to-end verification against spec §16

This task does not create new code. It walks the whole pipeline and confirms all nine success criteria pass.

- [ ] **Step 1: Reset to a clean slate**

Create a fresh test client in the Settings page or by SQL insert.

- [ ] **Step 2: Walk the nine steps of spec §16**

1. `/briefs/new` → create a brief attached to the test client. Confirm row in `briefs` table with `status='new'`.
2. `/inbox` → Accept. Confirm `status='triaged'`, `triaged_by='Brendan'`, route = `/briefs/:id/scope`.
3. Scope page auto-drafts. Edit one bullet. Click Lock scope. Confirm `scopes.locked_at` set, `briefs.status='scoped'`, `scopes.ai_drafted` is true/false based on your edit distance.
4. Project Builder: add 3+ services (try AI suggest for at least one), adjust allocations, set margin=10%, discount=0%, click Draft SOW, edit one HTML header, click Finalise.
   - Confirm `quotes.line_items_jsonb` is a frozen snapshot (query `quotes.line_items_jsonb->0` — contains `service_id`, `subtotal_cents`, `allocation`).
   - Confirm `quotes.sow_pdf_url` is a signed URL that opens a valid PDF.
5. Send page → Open email. Browser downloads the PDF; Gmail compose opens with prefilled subject + body.
6. Mark as sent. Later: `/quotes/:id` → Mark accepted.
7. Verify ClickUp push: parent + child tasks appear; `time_estimate` on each child is in ms; `BRIEF::` JSON comment is valid JSON.
8. Verify `projects` + `project_actuals` rows exist.
9. Manually invoke `sync-clickup-actuals` once. Confirm `project_actuals.synced_at` is recent. Within 30 min of scheduled run, the burn dashboard updates.

- [ ] **Step 3: Typecheck + build**

```bash
npm run typecheck
npm run build
npm run lint
npm test
```

All four must pass.

- [ ] **Step 4: Tag the Phase 1 milestone**

```bash
git tag phase-1-complete
git log --oneline phase-1-complete~40..phase-1-complete
```

Produce a human-readable diff summary for the release notes.

---

## Self-review against spec §3 (Phase 1 in-scope checklist)

| Spec item (§3 "In scope — Phase 1 MVP") | Task | Verified by |
|---|---|---|
| New schema: `clients`, `contacts`, `briefs`, `scopes`, `quotes`, `quote_services`, `projects`, `project_actuals`, `settings`, `list_aliases`, `list_alias_overrides` | 4–9 | Migration applied + types regenerated |
| Manual brief intake (form-based) | 18 | Brief appears in `briefs` with `source='manual'` |
| Triage UI (Inbox + accept/spam/needs-info) | 19 | Brief transitions happen in DB |
| Scope UI with Claude-drafted enhanced brief | 22, 23 | `scopes` row with `ai_drafted=true` after auto-draft |
| Project Builder UI (picker + live totals + SOW preview) | 29 | Adding services updates totals; SOW preview renders |
| Three AI-assisted actions (scope draft, suggest services, SOW draft) | 22, 27, 28 | Functions deployed; smoke-invoked against real data |
| Quote finalisation + PDF render | 16, 30 | Signed URL opens valid PDF |
| Send UI (mailto + PDF download; Xero hidden) | 31 | `mailto:` opens Gmail; Xero button absent |
| Accept / Reject / Revise flow | 32 | Three state transitions observed |
| ClickUp push on acceptance | 33 | Parent + children created with BRIEF:: comments |
| Read-only burn dashboard with 30-min actuals sync | 34, 35, 36, 37 | `cron.job` row exists; actuals update |
| Settings page with three toggles + credential fields (default OFF) | 17 | Toggles persist; defaults match |

| Phase 1 explicit OUT-of-scope items (never built) | Verified |
|---|---|
| Email intake webhook + `inbound-brief` | Not created |
| Xero OAuth + `push-xero-quote` | Not created; button hidden |
| Burn alerts | Not created |
| Envelope-driven `/brief` refactor | Not started |
| Variance feedback loop | Not started |
| Per-user auth / RLS | Not enabled |
| Outbound email send | Not implemented (mailto only) |

## Known simplifications in Phase 1

- **Cron cadence fixed at 30 min.** Changing `settings.burn_sync_cron_minutes` doesn't reschedule. Phase 1.x or a manual-reschedule Edge Function can fix.
- **Client ClickUp folder resolution uses substring match on space name.** Works if clients have a dedicated space; breaks if they share a space under a subfolder. Task 33 stores the resolved id so this only hurts on first push per client.
- **Allocation derivation in ProjectBuilder reads `service_allocation_resolved`** — if a service has no resolved allocation, the editor shows empty; user has to fill it in.
- **Sprint points heuristic** in `BRIEF::` comment is `max(1, round(hours/4))`. Tune against historical Scheduler-Skill data in Phase 3.
- **SOW HTML → PDF mapper** supports h1/h2/h3/p/ul/li only. Nested lists, tables, images are flattened. Constrain the editor in Task 29 if this bites.

## Execution sequencing summary

Tasks 1–3 → 4–9 (migrations, commit per migration) → 10–14 (hooks) → 15 (routing) → 16 (PDF spike, GATE) → 17 (settings) → 18 (new brief) → 19–20 (inbox + mailto) → 21 (scope overlap) → 22–23 (scope page + draft-scope) → 24–25 (quotes + clickup-shared logic) → 26 (SoW sync) → 27–28 (suggest + draft-sow) → 29 (project builder) → 30 (real PDF renderer) → 31 (send) → 32 (quote detail) → 33 (push-to-clickup) → 34–35 (projects list + detail) → 36–37 (sync + cron) → 38 (E2E).

**Estimated effort:** 6–9 working days for a focused engineer familiar with the repo. PDF spike (Task 16) is the highest-risk point; if it fails, expect +1 day for the Browserless.io fallback.

---

*End of plan.*










