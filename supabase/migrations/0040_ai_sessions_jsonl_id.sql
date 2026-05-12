alter table ai_sessions
  add column if not exists jsonl_id text unique;
