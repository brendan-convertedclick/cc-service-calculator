-- supabase/migrations/0037_productivity_goal.sql
alter table settings
  add column if not exists productivity_goal_points integer not null default 40;
