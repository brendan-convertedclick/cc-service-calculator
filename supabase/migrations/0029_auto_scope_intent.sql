-- supabase/migrations/0029_auto_scope_intent.sql
ALTER TABLE public.briefs
  ADD COLUMN IF NOT EXISTS intent_type text
    CHECK (intent_type IN (
      'new_brief','project_thread','retainer_thread','general_query','quick_response'
    )),
  ADD COLUMN IF NOT EXISTS draft_reply text;

COMMENT ON COLUMN public.briefs.intent_type IS
  'AI-classified request type, set by auto-scope on ingest. NULL until auto-scope completes.';
COMMENT ON COLUMN public.briefs.draft_reply IS
  'AI-drafted reply text. Populated only for quick_response intent_type.';

ALTER TABLE public.scopes
  ADD COLUMN IF NOT EXISTS scope_type text
    CHECK (scope_type IN (
      'new_brief','project_thread','retainer_thread','general_query'
    ));

COMMENT ON COLUMN public.scopes.scope_type IS
  'Mirrors brief intent_type. Tells the UI which label set to use when rendering scope fields.';
