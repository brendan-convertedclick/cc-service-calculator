-- 0010_storage_buckets.sql
-- Apply via mcp__cc-supabase__apply_migration (name: storage_buckets)

insert into storage.buckets (id, name, public) values
  ('brief-attachments', 'brief-attachments', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public) values
  ('quote-pdfs', 'quote-pdfs', false)
on conflict (id) do nothing;

-- Phase 1 runs without RLS; single shared login has full access.
-- When per-user auth lands, add storage.policies gated on auth.uid().
