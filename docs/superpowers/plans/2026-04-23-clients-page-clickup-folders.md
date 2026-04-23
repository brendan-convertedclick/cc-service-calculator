# Clients page + ClickUp folder linking — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fuzzy-name matching in `push-to-clickup` with an explicit client→ClickUp-folder binding, configured via a new `/clients` admin page and a one-time "Clients space" setting.

**Architecture:** A single additive migration adds `settings.clickup_clients_space_id`. Two thin edge function proxies (`list-clickup-spaces`, `list-clickup-folders`) expose the minimal ClickUp taxonomy to the browser. The Settings page gets a Clients-space selector; `/clients` gets a CRUD table mirroring `/departments`; `push-to-clickup` stops guessing and navigates Folder → List using the bound id.

**Tech Stack:** Vite + React 18 + TypeScript, TanStack Query, Tailwind + shadcn/ui (`Combobox`, `Select`, `Dialog`, `Input`), Supabase JS, Supabase Edge Functions (Deno). DB and function ops go through `mcp__cc-supabase__*` MCP tools — no local Supabase CLI in this repo.

**Spec reference:** [docs/superpowers/specs/2026-04-23-clients-page-clickup-folders-design.md](../specs/2026-04-23-clients-page-clickup-folders-design.md)

**Project-wide gotchas:**
- Edge Functions MUST be deployed with `verify_jwt=false` (project uses ES256 signing keys; gateway verify_jwt is HS256-only — see `supabase/config.toml` and `memory/project_es256_edge_fn_auth.md`). Any new function must follow this.
- Shared helpers: `supabase/functions/_shared/helpers.ts` (`cors`, `json`), `_shared/supabase-client.ts` (`createUserClient`). Import them from new edge functions rather than re-inlining.
- ClickUp PAT is stored as the `CLICKUP_PAT` edge-function secret. Read via `Deno.env.get("CLICKUP_PAT")`.
- Migrations live in `supabase/migrations/NNNN_name.sql`. Next number is **0022** (last applied: `0021_enable_rls_on_intake_pipeline.sql`).

---

## File Structure

**Migrations**
- Create: `supabase/migrations/0022_settings_clickup_clients_space_id.sql`

**Types**
- Regenerate: `src/types/db.ts` (via `mcp__cc-supabase__generate_typescript_types`)

**Edge functions**
- Create: `supabase/functions/list-clickup-spaces/index.ts`
- Create: `supabase/functions/list-clickup-folders/index.ts`
- Modify: `supabase/functions/push-to-clickup/index.ts` (swap Space→List for Folder→List; remove name-matching; error cleanly on null binding)
- Modify: `supabase/config.toml` (register the two new functions with `verify_jwt = false`)

**Hooks**
- Modify: `src/hooks/useClients.ts` — add `useUpdateClient`, `useArchiveClient`, `useClickUpFolders`, `useClickUpSpaces`

**Pages / components**
- Create: `src/pages/Clients.tsx`
- Modify: `src/App.tsx` — register lazy route `/clients`
- Modify: `src/components/AppShell.tsx` — insert "Clients" nav link between Team and Settings
- Modify: `src/pages/Settings.tsx` — add "Clients space" selector below "Workspace ID"

**No changes:** `src/hooks/useSettings.ts` (existing `useUpdateSettings` handles the new column once types regenerate).

---

## Task 1: Migration — add `settings.clickup_clients_space_id`

**Files:**
- Create: `supabase/migrations/0022_settings_clickup_clients_space_id.sql`
- Regenerate: `src/types/db.ts`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0022_settings_clickup_clients_space_id.sql`:

```sql
-- CC Service Calculator — clients page + ClickUp folder linking
-- Apply via mcp__cc-supabase__apply_migration (name: settings_clickup_clients_space_id)

alter table public.settings
  add column if not exists clickup_clients_space_id text;

comment on column public.settings.clickup_clients_space_id is
  'ClickUp top-level space id that contains client folders. Used by list-clickup-folders to populate the Clients page dropdown.';
```

- [ ] **Step 2: Apply the migration via MCP**

Run:
```
mcp__cc-supabase__apply_migration(
  name: "settings_clickup_clients_space_id",
  query: <contents of the file above>
)
```

Expected: success response with migration metadata. If it errors, copy the error verbatim and stop — do NOT retry.

- [ ] **Step 3: Verify the column exists**

Run:
```
mcp__cc-supabase__execute_sql(
  query: "select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='settings' and column_name='clickup_clients_space_id';"
)
```

Expected: one row with `data_type=text`, `is_nullable=YES`.

- [ ] **Step 4: Regenerate TypeScript types**

Run:
```
mcp__cc-supabase__generate_typescript_types()
```

Copy the returned string and overwrite `src/types/db.ts` with the new content (use the Write tool).

- [ ] **Step 5: Verify the type change**

Run:
```
Grep(pattern: "clickup_clients_space_id", path: "src/types/db.ts")
```

Expected: matches in `settings` Row, Insert, and Update types.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0022_settings_clickup_clients_space_id.sql src/types/db.ts
git commit -m "$(cat <<'EOF'
feat(db): settings.clickup_clients_space_id for clients page

Additive nullable column. Designates which ClickUp top-level space
holds client folders so the /clients page can populate its folder
dropdown and push-to-clickup can bind clients to folders explicitly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Edge function — `list-clickup-spaces`

**Files:**
- Create: `supabase/functions/list-clickup-spaces/index.ts`

- [ ] **Step 1: Write the function**

Create `supabase/functions/list-clickup-spaces/index.ts`:

```ts
// supabase/functions/list-clickup-spaces/index.ts
//
// Request:  POST {}
// Response: 200 { spaces: [{ id: string, name: string }] }
//
// Proxies ClickUp GET /team/{workspace_id}/space for the configured
// workspace. Used by the Settings page to populate the "Clients space"
// dropdown.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const supabase = createUserClient(req);
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    const { data: settings } = await supabase
      .from("settings").select("clickup_workspace_id").eq("id", 1).single();
    if (!settings?.clickup_workspace_id) {
      return json({ error: "Workspace ID not configured in Settings" }, 400);
    }

    const res = await fetch(
      `https://api.clickup.com/api/v2/team/${settings.clickup_workspace_id}/space`,
      { headers: { Authorization: clickupPat, "Content-Type": "application/json" } },
    );
    if (!res.ok) return json({ error: `ClickUp ${res.status}: ${await res.text()}` }, 502);

    const body = await res.json();
    const spaces = (body.spaces ?? [])
      .map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));

    return json({ spaces });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
```

- [ ] **Step 2: Deploy via MCP**

Call `mcp__cc-supabase__deploy_edge_function` with:
- `name: "list-clickup-spaces"`
- `entrypoint_path: "index.ts"`
- `verify_jwt: false`
- `files:` array with two entries:
  1. `{name: "index.ts", content: <file above>}`
  2. `{name: "../_shared/helpers.ts", content: <copy verbatim from supabase/functions/_shared/helpers.ts>}`
  3. `{name: "../_shared/supabase-client.ts", content: <copy verbatim from supabase/functions/_shared/supabase-client.ts>}`

Expected: response with `"verify_jwt": false` and a new version number.

- [ ] **Step 3: Register in config.toml**

Modify `supabase/config.toml` — add this block alphabetically (after `generate-process-steps`):

```toml
[functions.list-clickup-spaces]
verify_jwt = false
```

- [ ] **Step 4: Smoke-test the function**

Run:
```
mcp__cc-supabase__execute_sql(
  query: "select clickup_workspace_id from settings where id = 1;"
)
```

Confirm workspace id is `37345392` (or whatever the current value is — must be non-null).

Then call the function from the browser console via Playwright (see Task 7 for the exact pattern — for now, defer the actual smoke test to Task 7).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/list-clickup-spaces/ supabase/config.toml
git commit -m "$(cat <<'EOF'
feat(functions): add list-clickup-spaces edge function

Thin proxy over ClickUp /team/{id}/space. Used by Settings to populate
the Clients-space selector. verify_jwt=false per project ES256 policy;
function forwards the caller's JWT to Supabase client so RLS applies.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Edge function — `list-clickup-folders`

**Files:**
- Create: `supabase/functions/list-clickup-folders/index.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Write the function**

Create `supabase/functions/list-clickup-folders/index.ts`:

```ts
// supabase/functions/list-clickup-folders/index.ts
//
// Request:  POST {}
// Response: 200 { folders: [{ id: string, name: string }] }
//
// Proxies ClickUp GET /space/{clickup_clients_space_id}/folder. Used by
// the Clients page folder combobox and the New-client dialog.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const supabase = createUserClient(req);
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    const { data: settings } = await supabase
      .from("settings").select("clickup_clients_space_id").eq("id", 1).single();
    if (!settings?.clickup_clients_space_id) {
      return json({ error: "Clients space not configured in Settings" }, 400);
    }

    const res = await fetch(
      `https://api.clickup.com/api/v2/space/${settings.clickup_clients_space_id}/folder`,
      { headers: { Authorization: clickupPat, "Content-Type": "application/json" } },
    );
    if (!res.ok) return json({ error: `ClickUp ${res.status}: ${await res.text()}` }, 502);

    const body = await res.json();
    const folders = (body.folders ?? [])
      .map((f: { id: string; name: string }) => ({ id: f.id, name: f.name }))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));

    return json({ folders });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
```

- [ ] **Step 2: Deploy via MCP**

Call `mcp__cc-supabase__deploy_edge_function` with:
- `name: "list-clickup-folders"`
- `entrypoint_path: "index.ts"`
- `verify_jwt: false`
- `files:` array with three entries:
  1. `{name: "index.ts", content: <the file from Step 1>}`
  2. `{name: "../_shared/helpers.ts", content: <copy verbatim from supabase/functions/_shared/helpers.ts>}`
  3. `{name: "../_shared/supabase-client.ts", content: <copy verbatim from supabase/functions/_shared/supabase-client.ts>}`

Expected: response with `"verify_jwt": false` and a new version number.

- [ ] **Step 3: Register in config.toml**

Modify `supabase/config.toml` — add another block alphabetically adjacent to `list-clickup-spaces`:

```toml
[functions.list-clickup-folders]
verify_jwt = false
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/list-clickup-folders/ supabase/config.toml
git commit -m "$(cat <<'EOF'
feat(functions): add list-clickup-folders edge function

Thin proxy over ClickUp /space/{id}/folder scoped to the configured
Clients space. Used by the Clients page to populate the folder
combobox.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Hooks — extend `useClients.ts`

**Files:**
- Modify: `src/hooks/useClients.ts`

- [ ] **Step 1: Read the current file to preserve the existing exports**

Run:
```
Read(file_path: "/Users/brendangunn/Github/cc-service-calculator/src/hooks/useClients.ts")
```

Confirm it exports `useClients`, `useCreateClient`, `useContacts`, `useCreateContact`. These stay.

- [ ] **Step 2: Rewrite the file with new hooks appended**

Use Write to replace the entire file with:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Client = Database["public"]["Tables"]["clients"]["Row"];
type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];
type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type ContactInsert = Database["public"]["Tables"]["contacts"]["Insert"];

const LIST = ["clients"] as const;
const FOLDERS = ["clickup_folders"] as const;
const SPACES = ["clickup_spaces"] as const;

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

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: ClientUpdate }) => {
      const { data, error } = await supabase
        .from("clients").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST }),
  });
}

export function useArchiveClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("clients")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST }),
  });
}

export function useClickUpFolders() {
  return useQuery({
    queryKey: FOLDERS,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      const { data, error } = await supabase.functions.invoke("list-clickup-folders", {
        body: {},
      });
      if (error) throw error;
      return (data as { folders: Array<{ id: string; name: string }> }).folders;
    },
  });
}

export function useClickUpSpaces() {
  return useQuery({
    queryKey: SPACES,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      const { data, error } = await supabase.functions.invoke("list-clickup-spaces", {
        body: {},
      });
      if (error) throw error;
      return (data as { spaces: Array<{ id: string; name: string }> }).spaces;
    },
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

- [ ] **Step 3: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: no errors. If the build fails referencing `ClientUpdate` not found, the db.ts regen in Task 1 was skipped — stop and go back.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useClients.ts
git commit -m "$(cat <<'EOF'
feat(hooks): add update/archive mutations and ClickUp folder/space queries

useUpdateClient + useArchiveClient round out CRUD on the clients table.
useClickUpFolders + useClickUpSpaces call the new edge-function proxies
with 5-min staleTime to back the Clients-page combobox and Settings
selector respectively.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Settings page — Clients space selector

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Add the new UI block**

In `src/pages/Settings.tsx`, inside the existing ClickUp Card's `CardContent`, immediately AFTER the "Save workspace ID" `<Button>` (currently around line 71), add:

```tsx
<div className="space-y-2">
  <Label htmlFor="cu-clients-space">Clients space</Label>
  <ClickUpSpaceSelect
    value={s.clickup_clients_space_id ?? ""}
    onChange={(v) =>
      update.mutate(
        { clickup_clients_space_id: v || null },
        { onSuccess: () => toast.success("Saved") },
      )
    }
  />
  <p className="text-label-small text-m-on-surface-variant">
    The ClickUp top-level space that holds your client folders. Required before you can link clients to folders.
  </p>
</div>
```

At the top of the file, add these imports (merge with existing):

```tsx
import { useClickUpSpaces } from "@/hooks/useClients";
import { Combobox } from "@/components/ui/combobox";
```

At the bottom of the file (after the `Settings` function), add this helper component:

```tsx
function ClickUpSpaceSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { data: spaces, isLoading, error } = useClickUpSpaces();
  if (isLoading) {
    return <div className="text-body-small text-m-on-surface-variant">Loading spaces…</div>;
  }
  if (error) {
    return (
      <div className="text-body-small text-destructive">
        Couldn't load spaces: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }
  const options = (spaces ?? []).map((s) => ({ value: s.id, label: s.name }));
  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      placeholder="Select a space…"
      emptyLabel="No spaces in this workspace."
    />
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Start the dev server if not already running**

```bash
lsof -i :5174 -sTCP:LISTEN || npm run dev &
```

(Server pinned to port 5174 per `vite.config.ts` — see CLAUDE.md.)

- [ ] **Step 4: Manual smoke via Playwright**

- Navigate to http://localhost:5174/settings
- Confirm the "Clients space" combobox appears below the Workspace-ID input.
- Open it; the options list should populate (Clients, Growth, Admin, etc.). Pick "Clients".
- Expect a "Saved" toast.
- Verify via MCP:

```
mcp__cc-supabase__execute_sql(
  query: "select clickup_clients_space_id from settings where id = 1;"
)
```

Expected: the id of the selected space (e.g. `55422995` for the "Clients" space).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "$(cat <<'EOF'
feat(settings): Clients-space selector

Adds a combobox below the Workspace-ID input so the user can designate
which top-level ClickUp space holds client folders. Powered by the new
list-clickup-spaces edge function via useClickUpSpaces.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `/clients` page + nav link + route

**Files:**
- Create: `src/pages/Clients.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/AppShell.tsx`

- [ ] **Step 1: Create the page**

Create `src/pages/Clients.tsx`:

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useClients,
  useCreateClient,
  useUpdateClient,
  useArchiveClient,
  useClickUpFolders,
} from "@/hooks/useClients";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";

const UNLINKED = "__unlinked__";

export function Clients() {
  const { data: clients = [], isLoading } = useClients();
  const { data: settings } = useSettings();
  const { data: folders, isLoading: foldersLoading, error: foldersError } =
    useClickUpFolders();
  const update = useUpdateClient();
  const archive = useArchiveClient();

  const clientsSpaceConfigured = !!settings?.clickup_clients_space_id;
  const folderOptions = [
    { value: UNLINKED, label: "— Unlinked —" },
    ...(folders ?? []).map((f) => ({ value: f.id, label: f.name })),
  ];
  const folderNameById = new Map((folders ?? []).map((f) => [f.id, f.name]));

  return (
    <div className="container mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">
            The companies you do work for. Each client maps to a ClickUp folder so
            quote acceptance creates tasks in the right place.
          </p>
        </div>
        <NewClientDialog folderOptions={folderOptions} disabled={!clientsSpaceConfigured} />
      </div>

      {!clientsSpaceConfigured && (
        <Card className="mb-4">
          <CardContent className="py-4 text-sm">
            Configure a <strong>Clients space</strong> on the{" "}
            <Link to="/settings" className="underline">
              Settings page
            </Link>{" "}
            before linking clients to ClickUp folders.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All clients</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : clients.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No clients yet. Clients are created automatically when you log a new brief, or add one above.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Name</th>
                  <th className="py-2 pl-2">Primary domain</th>
                  <th className="py-2 pl-2">ClickUp folder</th>
                  <th className="py-2 pl-2">Status</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id} className="border-b">
                    <td className="py-3">
                      <Input
                        defaultValue={c.name}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== c.name)
                            update.mutate({ id: c.id, patch: { name: v } });
                        }}
                      />
                    </td>
                    <td className="py-3 pl-2">
                      <Input
                        defaultValue={c.primary_domain ?? ""}
                        placeholder="example.com"
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const next = raw === "" ? null : raw;
                          if (next !== c.primary_domain)
                            update.mutate({ id: c.id, patch: { primary_domain: next } });
                        }}
                      />
                    </td>
                    <td className="py-3 pl-2">
                      {foldersError ? (
                        <span className="text-xs text-destructive">
                          Couldn't load folders — check Settings
                        </span>
                      ) : foldersLoading ? (
                        <span className="text-xs text-muted-foreground">Loading…</span>
                      ) : !clientsSpaceConfigured ? (
                        <span className="text-xs text-muted-foreground">
                          Configure Clients space first
                        </span>
                      ) : (
                        <Combobox
                          options={folderOptions}
                          value={c.clickup_folder_id ?? UNLINKED}
                          onChange={(v) => {
                            const next = v === UNLINKED ? null : v;
                            if (next !== c.clickup_folder_id)
                              update.mutate(
                                { id: c.id, patch: { clickup_folder_id: next } },
                                { onSuccess: () => toast.success("Saved") },
                              );
                          }}
                          placeholder="Pick a folder…"
                        />
                      )}
                    </td>
                    <td className="py-3 pl-2 text-xs text-muted-foreground">
                      {c.clickup_folder_id
                        ? `✓ Linked${folderNameById.get(c.clickup_folder_id) ? ` to ${folderNameById.get(c.clickup_folder_id)}` : ""}`
                        : "Unlinked"}
                    </td>
                    <td className="py-3 pl-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Archive "${c.name}"?`)) {
                            archive.mutate(c.id, {
                              onSuccess: () => toast.success(`Archived ${c.name}`),
                              onError: (e) => toast.error(e.message),
                            });
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NewClientDialog({
  folderOptions,
  disabled,
}: {
  folderOptions: Array<{ value: string; label: string }>;
  disabled: boolean;
}) {
  const create = useCreateClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [folderId, setFolderId] = useState<string>(UNLINKED);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <Plus className="h-4 w-4" /> New client
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New client</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Primary domain (optional)</Label>
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="example.com"
            />
          </div>
          <div className="space-y-2">
            <Label>ClickUp folder (optional)</Label>
            <Combobox
              options={folderOptions}
              value={folderId}
              onChange={setFolderId}
              placeholder="Pick a folder…"
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            onClick={() => {
              const trimmed = name.trim();
              if (!trimmed) return toast.error("Name required");
              create.mutate(
                {
                  name: trimmed,
                  primary_domain: domain.trim() || null,
                  clickup_folder_id: folderId === UNLINKED ? null : folderId,
                },
                {
                  onSuccess: () => {
                    setName("");
                    setDomain("");
                    setFolderId(UNLINKED);
                    setOpen(false);
                    toast.success(`Created ${trimmed}`);
                  },
                  onError: (e) => toast.error(e.message),
                },
              );
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Register the route**

Modify `src/App.tsx`:

1. Add this `lazy` declaration alongside the others (after the `Settings` one):

```tsx
const Clients = lazy(() =>
  import("@/pages/Clients").then((m) => ({ default: m.Clients })),
);
```

2. Inside the `<AppShell>` `<Route>` block, after the `<Route path="team" element={<Team />} />` line, add:

```tsx
<Route path="clients" element={<Clients />} />
```

- [ ] **Step 3: Add the nav link**

Modify `src/components/AppShell.tsx`:

1. In the `lucide-react` import (line 2), add `Building2` to the list of icons.

2. In the nav items array, insert this entry **between** the `team` and `settings` entries:

```ts
{ to: "/clients", label: "Clients", icon: Building2, end: false },
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Manual smoke via Playwright**

- Browse to http://localhost:5174/clients
- Confirm: nav shows "Clients" between "Team" and "Settings"; table renders with existing clients (e.g. "The Kings College"); the folder column shows a working Combobox whose options include ClickUp folder names; "Unlinked" badge appears for clients with null `clickup_folder_id`.
- Link "The Kings College" to the matching ClickUp folder. Expect "Saved" toast; status cell flips to "✓ Linked to Kings College" (or whatever the folder's actual name is).
- Verify via MCP:

```
mcp__cc-supabase__execute_sql(
  query: "select name, clickup_folder_id from clients where name ilike '%kings%';"
)
```

Expected: `clickup_folder_id` is no longer null.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Clients.tsx src/App.tsx src/components/AppShell.tsx
git commit -m "$(cat <<'EOF'
feat(clients): add /clients page with ClickUp folder binding

CRUD table mirroring /departments: inline name + primary-domain edit,
combobox-powered folder link (backed by list-clickup-folders), archive
button. New-client dialog supports optional folder at creation time.
Nav link inserted between Team and Settings.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update `push-to-clickup` — Folder → List navigation

**Files:**
- Modify: `supabase/functions/push-to-clickup/index.ts`

- [ ] **Step 1: Read the current file**

Run:
```
Read(file_path: "/Users/brendangunn/Github/cc-service-calculator/supabase/functions/push-to-clickup/index.ts")
```

The current shape is: load settings + quote + client → resolve `spaceId` (with fallback matcher) → `GET /space/{spaceId}/list` → create parent + children.

- [ ] **Step 2: Rewrite the "resolve space" block**

In `supabase/functions/push-to-clickup/index.ts`, replace the block that currently reads (approximately — use the read output as the source of truth for exact lines):

```ts
let spaceId = client.clickup_folder_id;
if (!spaceId) {
  const spacesRes = await fetch(
    `https://api.clickup.com/api/v2/team/${settings.clickup_workspace_id}/space`,
    CU,
  );
  if (!spacesRes.ok) return json({ error: `CU spaces: ${await spacesRes.text()}` }, 502);
  const spaces = await spacesRes.json();
  const clientNeedle = client.name.toLowerCase();
  const space = (spaces.spaces ?? []).find((s: { name: string }) => {
    const spaceName = s.name.toLowerCase();
    return spaceName.includes(clientNeedle) || clientNeedle.includes(spaceName);
  });
  if (!space) return json({ error: `No ClickUp space found matching '${client.name}'` }, 404);
  spaceId = space.id;
  await supabase.from("clients").update({ clickup_folder_id: spaceId }).eq("id", client.id);
}

const listsRes = await fetch(`https://api.clickup.com/api/v2/space/${spaceId}/list`, CU);
```

With:

```ts
const folderId = client.clickup_folder_id;
if (!folderId) {
  return json({
    error: "Client not linked to a ClickUp folder — link it on the Clients page.",
  }, 400);
}

const listsRes = await fetch(`https://api.clickup.com/api/v2/folder/${folderId}/list`, CU);
```

The rest of the function (the `projectsList` lookup, parent task creation, batch loop, DB writes, compensating delete) is unchanged — `projectsList` still picks a `/projects/i`-named list inside the folder or falls back to the first one.

- [ ] **Step 3: Update the comment/header of the file**

Near the top of the file, find the "Preconditions:" comment block. Replace the existing "Flow:" section (steps 1–6) with:

```ts
// Flow:
//   1. Load quote + scope + brief + client + line allocations.
//   2. Require client.clickup_folder_id (set via the Clients page). If
//      null, return 400 pointing the user there.
//   3. List the folder's lists (GET /folder/{id}/list). Pick one named
//      /projects/i, or the first.
//   4. Create a parent task named after brief.raw_subject.
//   5. For each line_item × allocation: create a child task with
//      time_estimate = hours * 60 * 60000 ms, optional assignee resolved
//      from team_members, then post a BRIEF:: comment.
//   6. Insert projects row + project_actuals rows (one per child).
```

- [ ] **Step 4: Redeploy via MCP**

Call `mcp__cc-supabase__deploy_edge_function` with:
- `name: "push-to-clickup"`
- `entrypoint_path: "index.ts"`
- `verify_jwt: false`
- `files:` array with the updated `index.ts` plus the three shared helpers (`../_shared/helpers.ts`, `../_shared/supabase-client.ts`, `../_shared/clickup.ts` — all copied verbatim from the local repo).

Expected: response with `verify_jwt=false` and an incremented version number.

- [ ] **Step 5: End-to-end Playwright verification**

- In the browser (already logged in as `team@convertedclick.co.za`), browse to http://localhost:5174/quotes/79deb13d-53df-4d9a-b906-4ed5474213da (the Kings College quote — status: accepted).
- Click "Retry ClickUp push".
- Expect: "Pushed" success toast.
- Verify via MCP:

```
mcp__cc-supabase__execute_sql(
  query: "select id, quote_id, clickup_parent_task_id, name, status from projects where quote_id = '79deb13d-53df-4d9a-b906-4ed5474213da';"
)
```

Expected: one row with a non-null `clickup_parent_task_id`.

- Inspect ClickUp directly: open the Kings College folder inside the "Clients" space. A parent task named after the brief should exist with child subtasks for each line-item × department allocation.

- [ ] **Step 6: Negative test — unlinked client**

- Pick a different draft quote from the list (e.g. Dovetail "My Test").
- Ensure the Dovetail client is unlinked (nullable `clickup_folder_id`) by visiting `/clients` and setting Dovetail's folder to "— Unlinked —".
- Finalise and accept the Dovetail quote, or call `supabase.functions.invoke("push-to-clickup", { body: { quote_id: "3e3294dc-..." } })` from the browser console.
- Expect: error toast `"Client not linked to a ClickUp folder — link it on the Clients page."`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/push-to-clickup/index.ts
git commit -m "$(cat <<'EOF'
feat(push): navigate Folder → List using explicit client binding

Drops the substring-match heuristic that tried to resolve a ClickUp
space from the client name. Now relies on clients.clickup_folder_id
(set via the Clients page) and lists tasks under
GET /folder/{id}/list. Returns a pointed 400 when the binding is
missing so the user knows to link the client on /clients.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage check

- Spec §Data model → Task 1.
- Spec §New edge functions / list-clickup-folders → Task 3.
- Spec §New edge functions / list-clickup-spaces → Task 2.
- Spec §Updated push-to-clickup → Task 7.
- Spec §Settings page addition → Task 5.
- Spec §Clients page UX (table + dialog + nav) → Task 6.
- Spec §Hook additions → Task 4.
- Spec §Error handling → Task 5 (Settings), Task 6 (folder-load errors + unconfigured space), Task 7 (missing binding).
- Spec §Testing → Task 5 Step 4 (Settings), Task 6 Step 5 (Clients), Task 7 Steps 5–6 (push).
- Spec §Ship order → Task order 1–7 matches the spec's 6-step sequence (spec's step 2 "deploy both edge functions" is split into Tasks 2 and 3 for clarity; spec's step 6 "end-to-end verify" is Task 7 Step 5+6).
- Spec §Rollback → covered by commit-per-task granularity.
