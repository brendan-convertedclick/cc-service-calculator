-- supabase/migrations/0030_project_scope_view.sql

-- Extend projects with client_id (denormalized), engagement_type, and scope_status
-- Note: projects already has a `status` enum (project_status: in_progress/completed/cancelled)
-- scope_status is a separate field for the client-facing health indicator
ALTER TABLE public.projects
  ADD COLUMN client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN engagement_type text NOT NULL DEFAULT 'fixed'
    CHECK (engagement_type IN ('fixed', 'retainer')),
  ADD COLUMN scope_status text NOT NULL DEFAULT 'on_track'
    CHECK (scope_status IN ('on_track', 'needs_attention', 'overdue'));

-- Backfill client_id: project → quote → scope → brief → client
UPDATE public.projects p
SET client_id = b.client_id
FROM public.quotes q
JOIN public.scopes sc ON sc.id = q.scope_id
JOIN public.briefs b  ON b.id  = sc.brief_id
WHERE p.quote_id = q.id
  AND b.client_id IS NOT NULL;

-- Add parent_project_id to briefs (null = Inbox item, set = linked to project)
ALTER TABLE public.briefs
  ADD COLUMN parent_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

-- Performance indexes for sidebar queries
CREATE INDEX idx_projects_client_id ON public.projects(client_id)
  WHERE client_id IS NOT NULL;
CREATE INDEX idx_projects_client_scope_status ON public.projects(client_id, scope_status)
  WHERE client_id IS NOT NULL;
CREATE INDEX idx_briefs_parent_project_id ON public.briefs(parent_project_id)
  WHERE parent_project_id IS NOT NULL;
CREATE INDEX idx_briefs_inbox ON public.briefs(created_at DESC)
  WHERE parent_project_id IS NULL;
