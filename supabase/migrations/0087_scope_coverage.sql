-- 0087: Scope coverage — client-facing reasons, assumed exclusions, untick.
--
-- brief_task_sow_placements gains the client-safe "why" for each line's
-- bucket (written by intake, or a deterministic template from the resolver),
-- an is_assumed flag for adjacent work the client likely assumes is bundled,
-- and an excluded flag for operator-unticked lines (hidden from client view
-- and the CE PDF, dimmed in operator view). brief_intelligence stores the
-- intake-generated assumed_exclusions payload that seeds those lines.

alter table brief_task_sow_placements
  add column if not exists client_reason text,
  add column if not exists is_assumed boolean not null default false,
  add column if not exists excluded boolean not null default false;

alter table brief_intelligence
  add column if not exists assumed_exclusions jsonb;

comment on column brief_task_sow_placements.client_reason is
  'Plain-language, client-facing explanation of why this line sits in its coverage bucket.';
comment on column brief_task_sow_placements.is_assumed is
  'Line was inferred as work the client likely assumes is bundled — not an explicit ask.';
comment on column brief_task_sow_placements.excluded is
  'Operator unticked this line: kept for audit, omitted from client view and the CE PDF.';
comment on column brief_intelligence.assumed_exclusions is
  'Intake-generated array of {item_title, assumption, reason, mapped_services?} — likely-assumed adjacent work that is not included.';
