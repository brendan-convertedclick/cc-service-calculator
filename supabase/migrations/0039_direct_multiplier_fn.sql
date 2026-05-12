create or replace function get_direct_multiplier(
  p_start date,
  p_end   date,
  p_logged_by text default null
)
returns table (
  logged_by        text,
  display_name     text,
  human_hours      numeric,
  ai_session_hours numeric,
  ai_cost_zar      numeric
)
language sql
security definer
as $$
  select
    s.logged_by,
    coalesce(tm.full_name, s.logged_by) as display_name,
    round(sum(s.human_minutes) / 60.0, 2)          as human_hours,
    round(sum(s.ai_duration_minutes) / 60.0, 2)    as ai_session_hours,
    round(sum(s.ai_cost_zar), 2)                   as ai_cost_zar
  from ai_sessions s
  left join team_members tm on tm.email = s.logged_by
  where s.session_date >= p_start
    and s.session_date < p_end
    and s.engagement_type = 'task'
    and (p_logged_by is null or s.logged_by = p_logged_by)
  group by s.logged_by, tm.full_name
  order by ai_session_hours desc
$$;
