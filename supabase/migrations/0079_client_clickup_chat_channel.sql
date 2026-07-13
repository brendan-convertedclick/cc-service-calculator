-- Per-client ClickUp Chat channel, used to notify the assignee when a brief is
-- briefed (manual quick-brief or scoped push).

alter table public.clients add column if not exists clickup_chat_channel_id text;

comment on column public.clients.clickup_chat_channel_id is
  'ClickUp Chat channel id for this client; used to notify the assignee when a brief is briefed (manual or scoped).';

-- Backfill from ClickUp chat channel ids matched by name (2026-07-13).
-- Ambiguous clients (e.g. The Converted Click) left null for manual mapping.
update public.clients set clickup_chat_channel_id = case id
  when '57935198-398e-4973-84e9-f0db2995c35d' then '13kp3g-29752'  -- Biolux
  when '0e39addb-f21a-46c2-b260-4f6195d8142e' then '13kp3g-30972'  -- Crawford & Co / Chedza
  when '56664650-d0a8-4847-80b6-914ef8bdf1ab' then '13kp3g-26652'  -- Dovetail RSA -> Dovetail
  when '8fa21f43-591f-494e-9c19-971c6bbdc141' then '13kp3g-26672'  -- Kings College -> King's College
  when '0af9b046-350c-464f-a53a-4d19f8fae1b6' then '13kp3g-27072'  -- Little Flock School -> Little Flock
  when '3f5629d0-fc38-48e5-860d-163e53f26e68' then '13kp3g-26932'  -- Pebble
  when '20d46eee-3ebf-4d97-986a-22a7a15e27ec' then '13kp3g-26692'  -- Pimms
  when '25a78243-36d6-4e9f-842e-540f5c4966d2' then '13kp3g-27012'  -- Sigen Solar Zambia -> Sigen Solar
  when 'f646b6fc-dad7-46fb-a035-0d917ee4b6c2' then '13kp3g-27052'  -- The Media Mixology -> Media Mixology
  when '4e549277-8f8d-4daf-9f89-d8bd7111169d' then '13kp3g-26632'  -- Trellidor
  when '00d6ba08-2e22-4f8e-8aff-f16f21229c49' then '13kp3g-26712'  -- Trellidor UK
  else clickup_chat_channel_id end
where clickup_chat_channel_id is null and id in (
  '57935198-398e-4973-84e9-f0db2995c35d','0e39addb-f21a-46c2-b260-4f6195d8142e',
  '56664650-d0a8-4847-80b6-914ef8bdf1ab','8fa21f43-591f-494e-9c19-971c6bbdc141',
  '0af9b046-350c-464f-a53a-4d19f8fae1b6','3f5629d0-fc38-48e5-860d-163e53f26e68',
  '20d46eee-3ebf-4d97-986a-22a7a15e27ec','25a78243-36d6-4e9f-842e-540f5c4966d2',
  'f646b6fc-dad7-46fb-a035-0d917ee4b6c2','4e549277-8f8d-4daf-9f89-d8bd7111169d',
  '00d6ba08-2e22-4f8e-8aff-f16f21229c49');
