# Inbox Client/Contact Filter Panel

**Date:** 2026-05-09  
**Status:** Approved

## Overview

Add an always-visible filter panel to the left of the Inbox page content area. The panel lists clients as collapsible rows; expanding a client reveals its direct contacts (unique `sender_email` values). Clicking a client or contact narrows the brief list. Unmatched briefs (no `client_id`) are pinned at the bottom in red to signal they need attention.

## Layout

The Inbox page becomes a two-column layout within the existing content area (AppShell nav sidebar is unchanged at 240px):

```
[ AppShell nav (240px) ] [ Filter panel (196px) ] [ Brief list (flex-1) ]
```

The filter panel has a fixed width of 196px, a light background (`#f7f7fb`), and a right border. It is always visible — not collapsible.

## Filter Panel — InboxFilterPanel component

### Structure

```
Filter by client          ← section label

  All clients             ← resets filter

  ▾ Trellidor        8   ← expanded client (purple left-border highlight when selected)
      yharyparsat@…  5   ← contact row (deeper fill when selected)
      djudge@…       3

  ▸ King's College   2   ← collapsed client

  ▸ Pebble Analytics 1

  [spacer]

  ▸ Unassigned       3   ← pinned bottom, red bg + red badge
```

### Interaction

| Action | Result |
|---|---|
| Click "All clients" | Clears `clientId` and `contactEmail` filters |
| Click a client name | Sets `clientId`; clears `contactEmail`; auto-expands that client's contact list; collapses all other clients' contact lists |
| Click chevron on a client | Toggles contact list expansion without changing the active filter |
| Click a contact email | Sets both `clientId` and `contactEmail` |
| Click "Unassigned" | Sets filter to `clientId = null` (briefs where `client_id IS NULL`) |

Only one filter is active at a time. The active item is highlighted; the Inbox heading shows the active context as a breadcrumb (e.g., `Inbox · yharyparsat@trellidor.co.za`).

### Counts

Count badges show the number of briefs in each group across **all scopes** (not scoped to Mine/Unassigned/Waiting/All — those tabs filter within the selected client/contact). This means a client with 8 briefs shows `8` regardless of which tab is active.

## Data layer

### New hook — useInboxFilterTree

Fetches the client/contact tree with counts in one query. Returns:

```ts
type FilterTree = {
  clients: {
    id: string;
    name: string;
    count: number;
    contacts: { email: string; count: number }[];
  }[];
  unassigned: { count: number };
};
```

Query: select `client_id`, `sender_email`, count from `briefs` where `parent_project_id IS NULL`, group by `client_id, sender_email`. Join client names from the `clients` table. Briefs with `client_id IS NULL` go into the `unassigned` bucket. Briefs with a `client_id` but a null `sender_email` (manually created) count towards the client total but do not generate a contact row.

Only direct To/From is considered — `sender_email` on the brief record (not CC/BCC fields on `brief_messages`).

### Extended hook — useBriefs

Add two optional params to the existing `useBriefs(scope, currentUserId)` hook:

```ts
useBriefs(scope, currentUserId, options?: {
  clientId?: string | null;   // null = unassigned filter
  contactEmail?: string;
})
```

- `clientId` (string): adds `.eq('client_id', clientId)` 
- `clientId` (null): adds `.is('client_id', null)` — unassigned
- `contactEmail`: adds `.eq('sender_email', contactEmail)`
- Both undefined: no extra filter (existing behaviour)

## Inbox page changes

- Wrap the existing content in a flex row: `<InboxFilterPanel>` + existing tab/list area
- Thread filter state (`clientId`, `contactEmail`) via `useState` in `Inbox.tsx`, passed down as props
- Filter state resets to undefined when navigating away and back (no URL persistence needed for V1)
- Heading updates to show active filter context

## Visual tokens

| Element | Token |
|---|---|
| Panel background | `#f7f7fb` (close to `bg-muted`) |
| Panel border | `border-m-outline-variant` |
| Selected client left-border | `border-m-primary` (indigo) |
| Selected client bg | `bg-m-primary-container` at low opacity |
| Selected contact bg | slightly deeper fill within primary-container range |
| Count badge (active) | `bg-m-primary text-white` |
| Count badge (inactive) | `bg-muted text-muted-foreground` |
| Unassigned section bg | red-50 equivalent |
| Unassigned border-top | red-200 |
| Unassigned text + badge | `text-destructive` / `bg-destructive` |

## Out of scope

- URL-based filter persistence (no query params for V1)
- Multi-select filtering (one client or contact at a time)
- Search/filter within the panel
- Outbound-only contact filtering (outbound `to_emails` not surfaced; `sender_email` covers inbound and is the primary contact signal)
