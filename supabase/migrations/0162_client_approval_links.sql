-- 0162_client_approval_links.sql
-- Apply via mcp__cc-supabase__apply_migration (name: client_approval_links)
--
-- The thing an ask is about usually lives somewhere else — a mock-up in Figma,
-- a staging page, a Google Doc. Until now the only place to put that address
-- was `detail`, which renders as plain pre-wrapped text on the client's page:
-- a URL pasted there is something they have to select and copy, and half of
-- them will not.
--
-- text[] and not a table, for the same reason as 0129's system_definitions.doc_links:
-- a link here has no attributes of its own — no ordinal anyone reorders, no
-- owner, no state — so a row per link is a join to fetch a string. The two
-- columns share `normaliseDocLink` and `DocLinksField`, so a link is validated
-- and edited the same way wherever it hangs.
--
-- IT IS CLIENT-VISIBLE BY CONSTRUCTION. These render as chips on the sign-off
-- page and in the present view, which is the entire point of the column — but
-- it means an internal ClickUp or Notion URL pasted here reaches the client.
-- The editor says so out loud; nothing here can enforce it.
--
-- not null default '{}' so every reader treats it as an array and skips the
-- null branch. RLS needs nothing new: client_approvals_authed_all already
-- covers any authenticated write, and the client-facing edge function reads
-- it through its own service-role client.

alter table client_approvals
  add column links text[] not null default '{}';

comment on column client_approvals.links is
  'Web addresses this ask is about — a mock-up, a staging page, a doc. CLIENT-VISIBLE: rendered as chips on the sign-off page. Validated with normaliseDocLink (http/https, no credentials).';
