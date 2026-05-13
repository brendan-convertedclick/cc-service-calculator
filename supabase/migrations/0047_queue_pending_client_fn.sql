-- 0047_queue_pending_client_fn.sql
-- Apply via mcp__cc-supabase__apply_migration (name: queue_pending_client_fn)
--
-- pending_clients.seen_count must increment on repeat appearances of the same
-- domain. Mirrors queue_pending_sender (0045): Supabase JS upsert() can't
-- express ON CONFLICT DO UPDATE with a column-level increment, so we wrap
-- the operation in a SECURITY DEFINER fn.

create or replace function public.queue_pending_client(
  p_domain text,
  p_sender text,
  p_subject text
) returns table (id uuid, seen_count int)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  insert into public.pending_clients (domain, sample_sender, sample_subject, last_seen_at, seen_count, dismissed_at)
  values (lower(p_domain), p_sender, p_subject, now(), 1, null)
  on conflict (domain) do update set
    seen_count = public.pending_clients.seen_count + 1,
    last_seen_at = now(),
    sample_sender = coalesce(excluded.sample_sender, public.pending_clients.sample_sender),
    sample_subject = coalesce(excluded.sample_subject, public.pending_clients.sample_subject),
    dismissed_at = null
  returning public.pending_clients.id, public.pending_clients.seen_count;
end;
$$;

grant execute on function public.queue_pending_client(text, text, text) to authenticated, service_role;
