# Inbox v2 + wiki-context AI scoping — design

**Date:** 2026-05-05
**Status:** ready for implementation planning

## Problem

The current Inbox is a flat list of briefs created by manually pasting subject + body into `NewBrief.tsx`. There is no way to (a) get client requests *into* the system without pasting, since clients email individuals on the team rather than a shared address, and (b) see the response history of a brief without flipping to Gmail. The AI scoping step (`generate-process-steps`) sees only the brief body — it has no awareness of the per-client knowledge already curated in the Obsidian wiki at `wiki/clients/<Client>/`.

## Goal

Three concurrent upgrades shipped as a single mega-spec, three sequenced phases:

1. **Phase 1 — Intake + threading.** Any teammate can pipe a Gmail thread into the shared Inbox by applying a label. Briefs accumulate full message history (inbound + outbound + internal notes) keyed by `gmail_message_id`.
2. **Phase 2 — Inbox v2 UI.** Conversation pane (one row per brief, messages nested), four default tabs (Mine / Unassigned / Waiting / All), assignee model, interleaved internal notes, downstream link chips (Quote / Project).
3. **Phase 3 — Wiki context for AI scoping.** `draft-scope` Edge Function inlines the client's `wiki/clients/<slug>/` markdown into the AI prompt, with frontmatter `context: hidden` opt-out and auto-provisioning of new client folders.

## Non-goals

- Telegram intake bot (deferred to Phase 1.5; re-evaluate after mobile-triage pain materialises).
- Cloudflare Email Routing path (deferred; only if Apps Script proves friction-bound).
- iOS Shortcut share-sheet intake (Apple Mail's share sheet doesn't expose structured Mail Message metadata).
- Multi-source `client_context_sources` registry covering ClickUp / Drive / Gmail. Wiki is the single source; cross-references happen by humans summarising into the wiki via existing `/save` and `/ingest` skills.
- pgvector / embeddings RAG.
- MCP-at-runtime tool layer (`cc-vault search_notes` exposed to Claude). Deferred to Phase 4.
- Snooze, structured intake fields (`type` / `urgency`), keyboard shortcuts. Add only on team request.
- Saved views, SLA timers, AI auto-triage, in-app reply composing.
- Cold-tier archival of attachments. Defer until > 100 GB.

## Architecture overview

```
┌─────────────────┐    label "→Inbox/Push"   ┌──────────────────┐
│ Teammate Gmail  │ ─────────────────────────▶│ Apps Script      │
│ (per-mailbox)   │  apply on any thread      │ (5-min trigger)  │
└─────────────────┘                           └────────┬─────────┘
                                                       │ POST {thread, messages, attachments}
                                                       │ HMAC signed
                                                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Edge Function: gmail-relay                                  │
│  - validate HMAC against relay_secrets                      │
│  - resolve client by sender domain                          │
│  - upsert briefs row on gmail_thread_id                     │
│  - upsert brief_messages on gmail_message_id (dedup)        │
│  - upload attachments → brief-attachments storage           │
└────────────────────┬────────────────────────────────────────┘
                     ▼
       ┌───────────────────────────┐    React Query    ┌──────────────────────┐
       │ Postgres                  │ ─────────────────▶│ Inbox.tsx (v2)       │
       │  briefs (+ assignee_id)   │                   │  - 4 tabs            │
       │  brief_messages (new)     │                   │  - conversation pane │
       │  clients (+ wiki_path)    │                   │  - assignee picker   │
       │  relay_secrets (new)      │                   │  - internal notes    │
       │  scopes (+ ai_snapshot)   │                   │  - downstream chips  │
       └───────────────────────────┘                   └──────────────────────┘
                     │ at scope-draft time
                     ▼
       ┌──────────────────────────────────────────┐
       │ Edge Function: draft-scope (modified)    │
       │  - GET wiki/clients/<slug>/ via GitHub   │
       │  - filter by frontmatter context flag    │
       │  - inject as <client_context> block      │
       │  - snapshot to scopes.ai_context_snapshot│
       │  - call Anthropic Claude                 │
       └──────────────────────────────────────────┘

       ┌──────────────────────────────────────────┐
       │ Edge Function: provision-client-wiki     │
       │  - PUT wiki/clients/<slug>/index.md      │
       │  - template, fire-and-forget             │
       └──────────────────────────────────────────┘
```

## Phase 1 — Intake + threading

### Schema (migration `0023_brief_threading.sql`)

```sql
alter type public.brief_source add value 'gmail_relay';

create table public.brief_messages (
  id                 uuid primary key default gen_random_uuid(),
  brief_id           uuid not null references public.briefs(id) on delete cascade,
  gmail_message_id   text not null unique,
  direction          text not null check (direction in ('inbound','outbound','note')),
  from_email         text,
  from_name          text,
  to_emails          text[] not null default '{}',
  cc_emails          text[] not null default '{}',
  subject            text,
  body_text          text,
  body_html          text,
  attachments        jsonb not null default '[]',
  sent_at            timestamptz not null,
  relayed_by         text,
  created_at         timestamptz not null default now()
);
create index brief_messages_brief_idx on public.brief_messages (brief_id, sent_at);

alter table public.briefs
  add column gmail_thread_id_unique text unique
    generated always as (gmail_thread_id) stored,
  add column last_message_at timestamptz,
  add column message_count int not null default 0;

create table public.relay_secrets (
  id          uuid primary key default gen_random_uuid(),
  user_email  text not null unique,
  secret_hash text not null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
```

`brief_messages.attachments` JSON shape: `[{ name, storage_path, mime, size }]`. Synthetic `gmail_message_id` for internal notes: `note-<uuid>`.

### Edge function `gmail-relay`

Endpoint: `POST /functions/v1/gmail-relay`

Auth headers: `x-relay-user`, `x-relay-signature` (`hex(hmac_sha256(body, secret))`). Look up `relay_secrets` by user email, bcrypt-compare against `secret_hash`. Reject 401 on miss/revoked.

Body shape:

```ts
{
  thread_id: string,
  thread_subject: string,
  messages: Array<{
    message_id: string,
    direction: 'inbound' | 'outbound',
    from: { email: string, name?: string },
    to: string[], cc: string[],
    subject: string,
    sent_at: string,    // ISO 8601
    body_text: string,
    body_html: string,
    attachments: Array<{ name: string, mime: string, size: number, base64: string }>
  }>
}
```

Logic:

1. Resolve client: `select id from clients where primary_domain = split_part(messages[0].from.email, '@', 2)`. Null if no match.
2. Upsert brief on `gmail_thread_id`. If new: `source='gmail_relay'`, `status='new'`, `raw_subject=thread_subject`, `raw_body=messages[0].body_text`, `sender_email=messages[0].from.email`, `client_id=resolved_or_null`.
3. For each message: skip if `gmail_message_id` exists. Else upload each attachment to `brief-attachments/<brief_id>/<uuid>-<safe_name>`, then insert `brief_messages` row with `attachments` metadata (no base64 in DB).
4. Update `briefs.last_message_at = max(messages.sent_at)`, `message_count = (select count(*) from brief_messages where brief_id = ...)`.
5. Return `{ brief_id, inserted_message_count }`.

Idempotent — Apps Script can re-POST safely.

### Apps Script template

Distributed via Settings → "Connect Gmail" page in the calculator. Per-teammate setup (~5 min, one-time):

1. Visit `script.google.com/create`, paste template.
2. In Calculator Settings → "Connect Gmail" → "Generate token" — token shown once, hash stored in `relay_secrets`. Paste `RELAY_URL`, `RELAY_USER`, `RELAY_SECRET` into script properties.
3. Run `setup()` once — authorises Gmail scope; creates labels `→Inbox/Push` (inbound) and `→Inbox/Push-Sent` (outbound); installs 5-min time trigger.
4. Done.

Trigger logic: every 5 min, `GmailApp.search('(label:inbox-push OR label:inbox-push-sent) -label:inbox-pushed')`. For each thread:

- Build payload (set `direction` per source label per message)
- POST with HMAC
- On 2xx: add `inbox-pushed`, remove source labels
- On 4xx/5xx: leave labels, log; next run retries

### Error handling

| Failure | Behaviour |
|---|---|
| HMAC mismatch | 401 + log; teammate sees retry next run |
| Storage upload fails | abort that message insert, leave label, retry next run |
| Duplicate `gmail_message_id` | silently skip |
| Unknown sender domain | brief created with `client_id = null`, `status = new` — human triages |
| Apps Script trigger quota exceeded (90 min/day) | log to Apps Script execution log; volume too low to hit at agency scale |
| Edge function down | label stays applied, picked up next 5 min |

### Tests

- Unit (Vitest): HMAC signing/validation, attachment upload helper, dedup logic
- Integration: synthetic POST → assert brief + messages + storage rows; replay → assert no duplicates
- Manual: Brendan installs Apps Script in his own Gmail, sends one test thread end-to-end before team rollout

## Phase 2 — Inbox v2 UI

### Schema (migration `0024_brief_assignee.sql`)

```sql
alter table public.briefs
  add column assignee_id uuid references public.team_members(id) on delete set null;
create index briefs_assignee_idx on public.briefs (assignee_id) where assignee_id is not null;
```

Internal notes reuse `brief_messages` with `direction='note'` and synthetic `gmail_message_id = 'note-' || uuid`.

### Routes & components

```
/inbox             → Inbox.tsx (rewrite — tabs + virtualised list)
/inbox/:briefId    → Inbox.tsx with conversation pane open (route param,
                     not a separate page; list stays visible behind pane)
```

Components:

- **Inbox.tsx** (rewrite): `Tabs` from `@radix-ui/react-tabs` (already installed). Tabs: `Mine` (`assignee_id = currentUserId`), `Unassigned` (`assignee_id is null`), `Waiting` (`status = 'needs_info'`), `All`. Each tab body is a `<BriefList>`. Default tab = `Mine` if signed in as a team member; else `All`.
- **BriefList.tsx** (new): virtualised list of `<BriefRow>`s, sorted by `last_message_at desc nulls last, received_at desc`. Per-tab empty state copy.
- **BriefRow.tsx** (extend existing): additions — assignee avatar (or "—"), `message_count` badge, downstream-link chip (Quote #4567 / Project: Acme Site / Scope), `last_message_at` as relative time. Click → navigate to `/inbox/:briefId`.
- **BriefConversation.tsx** (new): drawer/right-pane on `lg:` screens, full-screen modal on mobile. Header: subject, client chip, assignee picker, "Open scope →" / "Open quote →" / "Open project →" deep-links. Body: scrollable timeline of `brief_messages` ordered by `sent_at`. Footer: "Add internal note" textarea + button.
- **MessageItem.tsx** (new): three variants —
  - `inbound`: aligned left, sender + time, sanitised HTML or text fallback, attachment list.
  - `outbound`: aligned right, "You / <relayed_by>" + time, same rendering.
  - `note`: full-width yellow card, "Internal note · <author>" + time, markdown rendered.
- **AssigneePicker.tsx** (new): popover listing `team_members` + "Unassigned"; PATCH `briefs.assignee_id`.

### Hooks

- **useBriefs** (extend existing): accepts `{ scope: 'mine' | 'unassigned' | 'waiting' | 'all' }`. SQL filtered + ordered as above. React Query keyed by tab name.
- **useBriefMessages(briefId)** (new): `select * from brief_messages where brief_id = $1 order by sent_at`. Subscribes to Supabase Realtime on insert so a new Apps Script relay during a triage session updates the open pane live.
- **useUpdateBriefAssignee** (new): mutation.
- **useAddInternalNote(briefId)** (new): mutation that inserts `direction='note'` row.
- **useBriefDownstream(briefId)** (new): returns `{ kind: 'project' | 'quote' | 'scope' | 'none', id, label }` by checking `projects` → `quotes` → `scopes` linked to this brief.

### HTML rendering safety

- Add `dompurify` (single npm dep)
- Allowed tags: `a, p, br, strong, em, u, ul, ol, li, blockquote, pre, code, img, table, thead, tbody, tr, td, th`
- Strip all `on*` attributes and `javascript:` URLs
- Render inside `<div class="email-body">` with CSS namespace so client styles don't bleed into the app shell

### Error handling

| Failure | Behaviour |
|---|---|
| `brief_messages` empty (legacy manual brief) | Conversation pane synthesizes one message from `briefs.raw_body` + `raw_subject` + `received_at` |
| HTML body fails to parse | Fall back to `body_text` in `<pre>` |
| Realtime subscription drops | TanStack Query `refetchInterval: 30000` fallback |
| Assignee user deleted | FK is `on delete set null` — UI shows "Unassigned" |

### Tests

- Component (Testing Library): tabs filter correctly, assignee picker writes through, internal note submission appears in pane immediately
- Snapshot tests for `MessageItem` (3 variants)
- Manual E2E: assign a brief → it disappears from Unassigned, appears in Mine

## Phase 3 — Wiki context for AI scoping

### Prerequisite (one-time, outside this codebase)

1. Push CC-Vault repo to a private GitHub repo (assumed: `convertedclick/cc-vault`).
2. Generate a fine-grained PAT scoped to that repo only — Contents: Read+Write (read for `draft-scope`, write for `provision-client-wiki`).
3. Store PAT as Supabase secret `WIKI_GITHUB_PAT`. Store `convertedclick/cc-vault` as `WIKI_GITHUB_REPO`.

### Schema (migration `0025_clients_wiki_path.sql`)

```sql
alter table public.clients add column wiki_path text;

update public.clients
   set wiki_path = 'wiki/clients/' || regexp_replace(name, '[^A-Za-z0-9]+', '-', 'g')
 where wiki_path is null;

alter table public.scopes add column ai_context_snapshot text;
```

`wiki_path` is editable (Settings → Clients screen) for naming-convention exceptions. `ai_context_snapshot` stores the exact `<client_context>` payload the AI saw, for debugging.

### `draft-scope` modifications

Add `loadClientWikiContext(client)` helper in `supabase/functions/_shared/`:

1. `GET https://api.github.com/repos/<repo>/contents/<wiki_path>?ref=main` (header `Authorization: Bearer <PAT>`)
2. Recursively walk `.md` files inside that path
3. For each file: GET raw content, parse frontmatter via [gray-matter](https://github.com/jonschlinkert/gray-matter), skip if `context: hidden === true`
4. Concatenate into:

```
<client_context client_name="Kings College" wiki_path="wiki/clients/Kings-College">
  <note path="index.md">…content…</note>
  <note path="brand.md">…content…</note>
  …
</client_context>
```

5. When the scope row is written, snapshot the rendered block to `scopes.ai_context_snapshot`

System prompt block = cached (Anthropic prompt caching). `<client_context>` is per-request, not cached.

### Auto-provision new client wiki folder

New Edge Function `provision-client-wiki`:

- Called from `useCreateClient` after Supabase row insert (fire-and-forget; does NOT block client creation on failure)
- `PUT /repos/<repo>/contents/<wiki_path>/index.md` with starter template:

```markdown
---
type: client
title: "<Client Name>"
created: <ISO date>
status: active
tags: [client]
---

# <Client Name>

## About

## Brand

## Decisions
```

- 409 (file exists) → silent no-op
- 5xx → log; do NOT block client creation

### Token budget

Sample Kings College: 8 files ≈ ~6k tokens. Conservative full-folder ceiling: ~30k. Sonnet 4.6 has 200k context; ample headroom. No truncation logic in v1; revisit only if a client crosses ~80k tokens.

### Error handling

| Failure | Behaviour |
|---|---|
| GitHub API 404 (folder missing) | Empty `<client_context>` block; AI proceeds brief-only; warn-log |
| GitHub API 403 / rate-limited | Retry once after 1s; then proceed empty |
| GitHub API 5xx | Retry once; then proceed empty |
| Frontmatter parse error | Skip that one note; log; continue with the rest |
| Auto-provision 409 | Silent no-op |
| Auto-provision 5xx | Log; do NOT block client creation |

Principle: wiki context is best-effort. Never fail a brief over a context fetch.

### Tests

- Unit: frontmatter parsing + `context: hidden` filter; XML block assembly; file-path sanitisation (no `..`)
- Integration: mock GitHub API (Vitest msw); assert behaviour for missing folder, hidden notes, large file
- Manual: scope-draft on a known client; verify AI output references wiki content; verify `ai_context_snapshot` matches actual fetch

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Apps Script OAuth churn (Workspace policy resets) | Medium | Settings page surfaces `last_relay_at` per teammate; banner alert at 7d silence |
| HTML email rendering XSS | Low | DOMPurify strict allow-list; CSS-namespaced render div |
| GitHub PAT leaks | Low | Fine-grained scope (single repo); quarterly rotation |
| Wiki content drift across editors | Low | Effectively single-author at present |
| Dedup miss → duplicate `brief_messages` rows | Low | UNIQUE constraint on `gmail_message_id` is the backstop |
| Storage growth from attachments | Low | Defer cold-tiering until > 100 GB |
| Edge Function timeout on long Anthropic calls | Medium | Use background Edge Function (Supabase 150s limit); show "Drafting…" UI |
| Apps Script trigger drift > 5 min | Low | Acceptable; manual "Force sync" button in script for urgent cases |

## Effort & sequencing

| Phase | Scope | Dev-days |
|---|---|---|
| 1 | Schema (`brief_messages`, `relay_secrets`); `gmail-relay` Edge Function; Apps Script template; Settings → "Connect Gmail" page with token issuance | 4 |
| 2 | Schema (`assignee_id`); Inbox.tsx rewrite (tabs + virtualised list); BriefConversation drawer; AssigneePicker; internal notes; downstream link chips; DOMPurify integration; useBriefMessages with Realtime | 4 |
| 3 | Schema (`wiki_path`, `ai_context_snapshot`); push CC-Vault to GitHub; PAT issuance; `loadClientWikiContext` helper; `draft-scope` modification; `provision-client-wiki` function; Settings → Clients edit screen for `wiki_path` | 3 |
| **Total** | | **~11 dev-days** |

## Phase boundaries (writing-plans checkpoints)

- **After Phase 1**: Brendan label-relays 5 real client threads; confirm `briefs` + `brief_messages` rows + storage objects; sign-off before Phase 2.
- **After Phase 2**: Brendan + one teammate use the new inbox for 1 week of real briefs; sign-off before Phase 3.
- **After Phase 3**: Brendan runs scope-draft on 3 real new briefs; verifies AI uses wiki context meaningfully; spec complete.

## Open items requiring Brendan's hand

1. Push CC-Vault to private GitHub repo before Phase 3 starts.
2. Generate fine-grained PAT scoped to that repo (Contents: Read+Write); store as Supabase secret `WIKI_GITHUB_PAT`.
3. Store repo path as `WIKI_GITHUB_REPO` (e.g. `convertedclick/cc-vault`).
4. Decide Apps Script rollout cadence — recommendation: Brendan installs first, dogfoods ~3 days, then rolls to team with a 1-page setup guide.

## Cross-references

- Wiki decision page: [[CC Service Calculator Inbox v2 - Architectural Decisions v0.1]] (`wiki/decisions/`) — captures D1–D6 with rationale and revisit triggers.
- Existing related specs: `2026-04-23-clients-page-clickup-folders-design.md`, `2026-04-21-process-flow-checklist-design.md`.
- Existing related code: `src/pages/Inbox.tsx`, `src/pages/NewBrief.tsx`, `src/lib/brief-routing.ts`, `supabase/functions/_shared/`, `supabase/migrations/0005_intake_pipeline.sql`.
