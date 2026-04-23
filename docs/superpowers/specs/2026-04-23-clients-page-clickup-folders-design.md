# Clients page + ClickUp folder linking — design

**Date:** 2026-04-23
**Status:** approved (2026-04-23)

## Problem

The `push-to-clickup` edge function currently assumes `client = ClickUp top-level space` and uses a fuzzy substring matcher on client name. This breaks against the real ClickUp workspace structure, where clients are **folders inside spaces** (e.g. Kings College is a folder inside the `Clients` space). The substring matcher never hits because no top-level space is named after the client.

There is also no in-app way to browse or edit clients, let alone explicitly bind one to a ClickUp container. Every quote that accepts into ClickUp silently depends on an undocumented name-matching heuristic.

## Goal

Ship a minimal Clients page that lets the user:

1. See every client in the app, linked or unlinked to ClickUp.
2. Pick a ClickUp folder for each client from a dropdown.
3. Edit client name and primary domain inline.
4. Create new clients (name required, folder optional).

And update the push function to use the explicit folder binding instead of heuristic matching.

## Non-goals (V1)

- Auto-creating ClickUp folders when a client is created in-app.
- Supporting clients that live outside the designated Clients space (e.g. `Beefy Ethy` as its own top-level space). Users will reorganise ClickUp to place client folders inside the canonical Clients space.
- Contact management (already has a `contacts` table with a `useContacts` hook — not touched here).
- Hard delete. Archive only (column already exists).
- Scheduled sync of ClickUp folders into a local cache.

## Data model

One migration, two columns:

```sql
-- 0022_settings_clickup_clients_space_id.sql
alter table public.settings
  add column if not exists clickup_clients_space_id text;
```

`public.clients.clickup_folder_id` already exists as `text null`. We change its semantics from "space id" to "folder id" — no schema migration needed. Existing values are all null in the live DB (verified), so no data migration is needed either.

Regenerate `src/types/db.ts` after the migration.

## New edge functions

### `list-clickup-folders`

- Request: `POST {}` (no body; reads settings).
- Response: `200 { folders: [{ id: string, name: string }] }` sorted alphabetically by name.
- Auth: `verify_jwt=false` (ES256 project-wide policy). Internally uses `createUserClient(req)` so the settings read respects RLS.
- Flow:
  1. Load `settings.clickup_clients_space_id`. If null, 400 `"Clients space not configured in Settings"`.
  2. Call ClickUp `GET /api/v2/space/{id}/folder` with the `CLICKUP_PAT` secret.
  3. Map to `{id, name}` and sort.
- File: `supabase/functions/list-clickup-folders/index.ts`.

### `list-clickup-spaces`

- Request: `POST {}`.
- Response: `200 { spaces: [{ id: string, name: string }] }` sorted alphabetically.
- Auth: same as above.
- Flow:
  1. Load `settings.clickup_workspace_id`. If null, 400 `"Workspace ID not configured in Settings"`.
  2. Call ClickUp `GET /api/v2/team/{workspace_id}/space`.
  3. Map to `{id, name}` and sort.
- File: `supabase/functions/list-clickup-spaces/index.ts`.
- Used by the Settings page "Clients space" dropdown only.

## Updated `push-to-clickup`

- `client.clickup_folder_id` is now a **folder id**, not a space id.
- If null, return `400 "Client not linked to a ClickUp folder — link it on the Clients page"`. No more fallback to name matching.
- Navigation changes from `GET /space/{spaceId}/list` to `GET /folder/{folderId}/list`. Still prefer a list named `/projects/i`, else first.
- Remove the entire "resolve space by substring match on client name" block (lines 89–106 of the current file).
- The cached write-back (`await supabase.from("clients").update({ clickup_folder_id: spaceId })`) is also removed — the folder binding is now set explicitly by the user via the Clients page, not implicitly by the push.

## Settings page addition

Below the "Workspace ID" input, add a **Clients space** select:

- On page load, call ClickUp `GET /team/{workspace_id}/space` (via a one-shot edge function, or via a small `list-clickup-spaces` helper — reuse `list-clickup-folders` shape). Populate options as `{id, name}`.
- Binds to `settings.clickup_clients_space_id`.
- Save via existing `useUpdateSettings` hook.

**Decision:** create one edge function `list-clickup-spaces` that mirrors `list-clickup-folders` structure. Cheaper to maintain than an inline fetch in the page.

## Clients page — UX

Route: `/clients`. Pattern: copy `/departments`.

**Sidebar nav**: insert "Clients" link between "Team" and "Settings".

**Layout** (top to bottom):

- Page title: "Clients" + subtitle: "The companies you do work for. Each client maps to a ClickUp folder so quote acceptance creates tasks in the right place."
- Header row: `+ New client` dialog trigger on the right.
- Table with columns:
  - **Name** — inline `<Input>` with `onBlur` save (mirrors Departments pattern).
  - **Primary domain** — inline `<Input>` (optional text).
  - **ClickUp folder** — combobox. Current value shows the folder name resolved via `useClickUpFolders`. Options populated by the same hook. On select: update `clickup_folder_id`. Includes an "Unlinked" option (sets null).
  - **Status** — dim text "Unlinked" or "✓ Linked to <folder name>".
  - **Actions** — Archive button (sets `archived_at`).

**Empty state**: "No clients yet. Clients are created automatically when you log a new brief, or you can add one here." with the New client CTA.

**`+ New client` dialog**:
- Fields: Name (required), Primary domain (optional), ClickUp folder (optional combobox).
- On submit: `useCreateClient` → toast success → close dialog → table refetches.

## Hook additions

`src/hooks/useClients.ts`:

- `useUpdateClient()` — mutation patching `{ id, patch: Partial<ClientUpdate> }`. Invalidates `["clients"]`.
- `useArchiveClient()` — convenience wrapper that sets `archived_at = now()`. Invalidates `["clients"]`.
- `useClickUpFolders()` — query at `["clickup_folders"]`, `staleTime: 5 * 60_000`, calls the `list-clickup-folders` edge function via `supabase.functions.invoke`. Errors surface as toast in consumers.
- `useClickUpSpaces()` — same shape, calls `list-clickup-spaces`, used only by Settings.

## Error handling

- Live ClickUp fetches: if the function returns 4xx/5xx, consumers show a toast with the error body. Dropdown falls back to "(couldn't load folders — check Settings)".
- Missing `clickup_clients_space_id` when opening the Clients page: folder combobox shows "(configure Clients space in Settings first)" and disables.
- `push-to-clickup` with a client missing `clickup_folder_id`: returns a specific error message that the caller surfaces as a toast pointing to the Clients page.

## Testing

Manual testing via Playwright (same flow used to verify the auth fix):

1. Settings: set Clients space → see options, save → settings row updated.
2. `/clients`: table renders; link Kings College to Kings College folder; table shows "✓ Linked".
3. `/quotes/:id`: retry ClickUp push → creates parent task + children in the linked folder's projects list.

No new unit tests for the edge functions (they're thin ClickUp proxies, covered by integration via the above).

## Ship order

1. Migration `0022_settings_clickup_clients_space_id.sql` + `npm run supabase:types` (or MCP-generate).
2. Deploy `list-clickup-folders` + `list-clickup-spaces` edge functions.
3. Add "Clients space" selector to Settings page; user configures once.
4. Build `/clients` page: route, nav link, `useClients` hook additions.
5. Update `push-to-clickup`: folder→list navigation, drop name-matcher, error on null binding. Redeploy.
6. End-to-end verify via Playwright.

## Rollback

Each step is independently reversible. The schema change is additive (new nullable column). The edge function changes preserve the outer response shape; rolling back `push-to-clickup` to v9 restores the current (broken-for-folders) behaviour.
