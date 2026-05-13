-- 0045_queue_pending_sender_fn.sql
-- Apply via mcp__cc-supabase__apply_migration (name: queue_pending_sender_fn)
--
-- pending_senders.seen_count must increment on repeat appearances of the same
-- sender. Supabase JS upsert() can't express ON CONFLICT DO UPDATE with a
-- column-level increment, so we wrap the operation in a SECURITY DEFINER fn.

create or replace function public.queue_pending_sender(
  p_client_id uuid,
  p_email text,
  p_sample_subject text,
  p_sample_brief_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pending_senders (client_id, email, sample_subject, sample_brief_id, last_seen_at, seen_count)
  values (p_client_id, lower(p_email), p_sample_subject, p_sample_brief_id, now(), 1)
  on conflict (client_id, email) do update set
    seen_count = public.pending_senders.seen_count + 1,
    last_seen_at = now(),
    sample_subject = coalesce(excluded.sample_subject, public.pending_senders.sample_subject),
    sample_brief_id = coalesce(excluded.sample_brief_id, public.pending_senders.sample_brief_id);
end;
$$;

grant execute on function public.queue_pending_sender(uuid, text, text, uuid) to authenticated, service_role;
