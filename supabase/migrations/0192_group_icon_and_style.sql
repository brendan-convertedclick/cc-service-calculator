-- 0192_group_icon_and_style.sql
--
-- A group on the planner and in Year results is marked by an icon in its
-- colour, both chosen by whoever runs the board, instead of a plain dot.
--
--  * results_groups.icon: a key from the fixed set in groupIcons.tsx. Null
--    means "the default for this group's name".
--  * The colour set grows from six to eight (sky, fuchsia), so a board with
--    planner-only groups can still give every group its own colour.
--  * pipeline_group_styles: planner-only groups (Account owner, Running the
--    account; 0184/0189) have no results_groups row, so their icon and colour
--    live here, per client and by group name, the same key the planner uses
--    to line groups up.

alter table public.results_groups add column if not exists icon text;

alter table public.results_groups drop constraint if exists results_groups_colour_check;
alter table public.results_groups add constraint results_groups_colour_check
  check (colour in ('violet', 'teal', 'amber', 'rose', 'blue', 'green', 'sky', 'fuchsia'));

create table if not exists public.pipeline_group_styles (
  client_id  uuid not null references public.clients(id) on delete cascade,
  name       text not null,
  icon       text,
  colour     text check (colour in ('violet', 'teal', 'amber', 'rose', 'blue', 'green', 'sky', 'fuchsia')),
  updated_at timestamptz not null default now(),
  primary key (client_id, name)
);

alter table public.pipeline_group_styles enable row level security;
drop policy if exists pipeline_group_styles_authed_all on public.pipeline_group_styles;
create policy pipeline_group_styles_authed_all on public.pipeline_group_styles
  for all to authenticated using (true) with check (true);
