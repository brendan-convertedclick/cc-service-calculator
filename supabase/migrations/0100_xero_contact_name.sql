-- 0100_xero_contact_name.sql
--
-- xero-sync links xero_invoices to clients by matching xero_contact_name to
-- clients.name — but Xero contacts carry legal-entity names (e.g. "Trellicor
-- (PTY) LTD", "Really Secure Company UkLtd t/a Trellidor UK") that rarely
-- match Conductor's short client names exactly. This column is a manual
-- alias, same pattern as clients.clickup_client_name, so an operator can
-- record the real Xero contact name once per client.

alter table clients add column if not exists xero_contact_name text;

comment on column clients.xero_contact_name is
  'Xero contact Name for this client (legal entity name), used by xero-sync to link invoices. Set manually — Xero legal names rarely match clients.name exactly.';
