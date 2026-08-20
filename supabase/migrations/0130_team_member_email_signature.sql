-- Per-person email signature, appended by send-outbound-email.
--
-- Both columns were already added by hand to the live database; this file
-- exists so a rebuild from migrations doesn't come up without them and take
-- send-outbound-email down with it. Idempotent on purpose.

alter table team_members
  add column if not exists email_signature text,
  add column if not exists email_signature_html text;

comment on column team_members.email_signature is 'Plain-text signature appended to outbound email.';
comment on column team_members.email_signature_html is 'HTML signature appended to outbound email; falls back to the plain-text one.';
