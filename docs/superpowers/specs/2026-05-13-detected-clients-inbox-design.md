# Detected-clients inbox — design

**Date:** 2026-05-13
**Status:** Approved for planning

## Problem

Inbound email from unrecognised domains is silently dropped by the intake flow today. There is no way for the operator to see "domains we've heard from that aren't clients yet." Separately, `pending_senders` (unknown senders on known client domains) are only visible inside each client's Sender Rules panel — they don't surface anywhere at the top level.

The operator wants a single inbox surfaced on the Clients page that shows both, with approve/dismiss actions.

## Surface

A button in the top-right of the `<CardHeader>` on the **All clients** card on `/clients`.

- Outline icon button (lucide `Inbox`) with a count pill.
- Hidden when the combined count is 0.
- Tooltip on hover: "Detected new clients & senders".
- Click → `<DetectedInboxDialog>` (shadcn Dialog, same pattern as `SenderRulesPanel`).

## Schema

New migration creating `pending_clients`:

```sql
create table pending_clients (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  sample_sender text,
  sample_subject text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  seen_count    int not null default 1,
  dismissed_at  timestamptz
);
create index pending_clients_last_seen_idx on pending_clients (last_seen_at desc);
alter table pending_clients enable row level security;
-- Policy mirrors pending_senders: authenticated users full access.
```

Domain is stored lowercased. Upsert on `domain` conflict bumps `seen_count`, refreshes `last_seen_at`, replaces `sample_sender`/`sample_subject` with the latest, and clears `dismissed_at` so a domain that re-appears after dismissal returns to the inbox.

## Intake change

Add a new MCP tool `record-pending-client`:

```
input:  { domain: string, sender: string, subject?: string }
effect: upsert into pending_clients (see above)
output: { id, seen_count }
```

The `/intake` skill is updated so that whenever `evaluate-sender` returns `decision: "unknown"`, it calls `record-pending-client` with the sender's domain instead of silently ignoring. No brief is created for unknown domains. Gmail-side tagging is unchanged (the thread stays untagged so it's still visible in Gmail).

## Client-side

### Hook: `usePendingInbox()`

Returns:

```ts
{
  pendingClients: Array<PendingClientRow>,      // dismissed_at IS NULL, order by last_seen_at desc
  pendingSenders: Array<PendingSenderWithClient>, // all clients, joined to client.name
  total: number,                                 // sum of both
  isLoading: boolean
}
```

Mutations exported:

- `approvePendingClient({ pending, name, primary_domain, clickup_folder_id? })` — inserts `clients` row, deletes `pending_clients` row.
- `dismissPendingClient(id)` — sets `dismissed_at = now()`.
- Pending-sender approve/block/dismiss reuse the existing `useResolvePendingSender` mutation (with an added "dismiss" path that just deletes the row).

### Components

- `src/components/clients/DetectedInboxButton.tsx` — the badge button + dialog open state.
- `src/components/clients/DetectedInboxDialog.tsx` — dialog content with two sections:
  - **New client domains** — table of pending_clients rows. Columns: domain, sample sender, sample subject (truncated), seen count, last seen (relative). Row actions:
    - `Approve as client` → inline expansion with `<Input>` for client name (default = domain capitalized minus TLD), pre-filled `primary_domain = domain`, optional ClickUp folder `<Combobox>`. Submit triggers `approvePendingClient`.
    - `Dismiss` → calls `dismissPendingClient`.
  - **Senders on existing clients** — pending_senders grouped by client name. Each row: email, sample subject, seen count, last seen. Actions: `Allow` / `Block` / `Dismiss`.

### Page wiring

`src/pages/Clients.tsx`: convert the existing `<CardHeader>` of the All clients card from `<CardTitle>` only to a flex row with `<CardTitle>` on the left and `<DetectedInboxButton />` on the right.

## Files

- `supabase/migrations/<timestamp>_pending_clients.sql` (new)
- `mcp-server/src/tools/record-pending-client.ts` (new)
- `mcp-server/src/tools/record-pending-client.test.ts` (new)
- `mcp-server/src/index.ts` (register tool)
- `src/hooks/usePendingInbox.ts` (new)
- `src/components/clients/DetectedInboxButton.tsx` (new)
- `src/components/clients/DetectedInboxDialog.tsx` (new)
- `src/pages/Clients.tsx` (header wiring)
- `~/.claude/skills/intake/SKILL.md` (call `record-pending-client` on `unknown`)

## Out of scope

- Gmail tagging on dismiss (we suppress in-app only; the thread stays in Gmail).
- Bulk approve/dismiss.
- Auto-creating an allow-rule for the approving sender (operator can do that from the client's Sender Rules panel after approval).
- Notifications / badge on the global nav (only on the Clients page card for V1).
- Subdomain consolidation (e.g. `mail.acme.co.za` and `acme.co.za` are separate rows for V1).

## Testing

- MCP tool: unit test for `record-pending-client` covering insert, increment, and `dismissed_at` clearing on re-appearance.
- Hook: integration test against a local Supabase using a seeded `pending_clients` row and a seeded `pending_senders` row, asserting `total` and approve/dismiss mutations.
- Page: Playwright smoke — button hidden when empty, visible with count when seeded, opens dialog, approve creates client and removes row.
