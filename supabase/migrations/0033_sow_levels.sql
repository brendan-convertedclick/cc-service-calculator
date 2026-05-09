create table sow_levels (
  id          uuid  primary key default gen_random_uuid(),
  name        text  not null,
  slug        text  not null unique,
  level_type  text  not null
              check (level_type in ('agency','service','client','project')),
  priority    int   not null,
  created_at  timestamptz not null default now()
);

create table clause_schema (
  key             text  primary key,
  label           text  not null,
  value_type      text  not null
                  check (value_type in ('string','number','string[]','boolean')),
  merge_strategy  text  not null default 'replace'
                  check (merge_strategy in ('replace','append')),
  section         text  not null
                  check (section in ('commercial','delivery','legal','scope')),
  sort_order      int   not null default 0
);

insert into sow_levels (name, slug, level_type, priority) values
  ('Business',       'business',       'agency',   10),
  ('Service Family', 'service-family', 'service',  20),
  ('Client',         'client',         'client',   30),
  ('Project',        'project',        'project',  40);

insert into clause_schema (key, label, value_type, merge_strategy, section, sort_order) values
  ('payment_terms',          'Payment terms',               'string',   'replace', 'commercial', 10),
  ('payment_schedule',       'Payment schedule',            'string',   'replace', 'commercial', 20),
  ('min_monthly_fee_zar',    'Minimum monthly fee (ZAR)',   'number',   'replace', 'commercial', 30),
  ('revision_rounds',        'Revision rounds included',    'number',   'replace', 'delivery',   10),
  ('revision_scope',         'What counts as a revision',   'string',   'replace', 'delivery',   20),
  ('trigger_to_start',       'Trigger to start',            'string',   'replace', 'delivery',   30),
  ('completion_definition',  'Completion definition',       'string',   'replace', 'delivery',   40),
  ('inclusions',             'Standard inclusions',         'string[]', 'append',  'scope',      10),
  ('exclusions',             'Standard exclusions',         'string[]', 'append',  'scope',      20),
  ('assumptions',            'Assumptions',                 'string[]', 'append',  'scope',      30),
  ('ip_ownership',           'IP ownership',                'string',   'replace', 'legal',      10),
  ('confidentiality',        'Confidentiality',             'string',   'replace', 'legal',      20),
  ('termination_notice_days','Termination notice (days)',   'number',   'replace', 'legal',      30),
  ('kill_fee_pct',           'Kill fee (%)',                'number',   'replace', 'legal',      40),
  ('liability_cap',          'Liability cap',               'string',   'replace', 'legal',      50);

alter table sow_levels   enable row level security;
alter table clause_schema enable row level security;

create policy "authenticated read sow_levels"    on sow_levels   for select using (auth.role() = 'authenticated');
create policy "authenticated write sow_levels"   on sow_levels   for all    using (auth.role() = 'authenticated');
create policy "authenticated read clause_schema" on clause_schema for select using (auth.role() = 'authenticated');
