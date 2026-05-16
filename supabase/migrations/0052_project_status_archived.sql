-- Add 'archived' to project_status so projects can be archived from the
-- Projects page (mirrors the brief archive flow on the Inbox).
alter type public.project_status add value if not exists 'archived';
