-- Phase: systems — verb + signal/noise per step.
--
-- Ported from the procedure-builder prototype. Two ideas:
--   1. `verb` is picked from a fixed set whose GROUP carries meaning — a verb
--      in the "checks or verifies" group is what makes signal_q3 ("is this the
--      only place that catches this risk?") relevant at all. The grouping
--      lives in the client (StepSignal.tsx); only the chosen word is stored,
--      so a hand-typed verb stays valid.
--   2. signal_q1..q5 are the keep/cut interrogation. NULL = not answered yet,
--      which is why these are nullable booleans and not `not null default false`
--      — "unanswered" and "answered no" decide differently.
--
-- `title` deliberately stays the outcome text only. It feeds canvas node
-- labels, the revision diff and ClickUp materialisation; composing verb into
-- it would rewrite every one of those on a dropdown change.
alter table process_steps
  add column verb text,
  add column signal_q1 boolean,
  add column signal_q2 boolean,
  add column signal_q3 boolean,
  add column signal_q4 boolean,
  add column signal_q5 boolean,
  add column keep_decision text not null default 'auto'
    check (keep_decision in ('auto', 'keep', 'cut'));

comment on column process_steps.verb is
  'The one verb this step performs (Create, Brief, Verify, …). Outcome text stays in title.';
comment on column process_steps.signal_q1 is
  'Would the client notice if this step vanished? NULL = unanswered.';
comment on column process_steps.signal_q2 is
  'Does the step produce or transform something? NULL = unanswered.';
comment on column process_steps.signal_q3 is
  'Only asked of check/verify verbs: is this the only place that catches this specific risk? NULL = unanswered.';
comment on column process_steps.signal_q4 is
  'Does the step exist only to fix a mistake made in an earlier step? Flag only — never decides keep/cut.';
comment on column process_steps.signal_q5 is
  'Does skipping this cause real costs or failure? NULL = unanswered.';
comment on column process_steps.keep_decision is
  'auto = use the computed verdict from signal_q*; keep/cut = human override.';
