create table clause_values (
  id          uuid  primary key default gen_random_uuid(),
  clause_key  text  not null references clause_schema(key),
  level_id    uuid  not null references sow_levels(id) on delete cascade,
  -- Polymorphic FK to the entity at this level:
  -- agency level  → null
  -- service level → services.id
  -- client level  → clients.id
  -- project level → projects.id
  scope_id    uuid,
  value_text  text,
  value_number numeric,
  value_bool  boolean,
  updated_at  timestamptz not null default now(),
  unique (clause_key, level_id, scope_id)
);

create index on clause_values (level_id, scope_id);
create index on clause_values (clause_key);

alter table clause_values enable row level security;
create policy "authenticated rw clause_values" on clause_values
  for all to authenticated using (true) with check (true);

create trigger trg_clause_values_touch
  before update on clause_values
  for each row execute function public.tg_touch_updated_at();

-- Resolution RPC
-- Returns JSONB: { value, value_type, merge_strategy, source_level_id, source_level_name }
-- replace: walks levels highest→lowest priority, returns first match
-- append:  walks lowest→highest, collects all string[] values and concatenates
create or replace function resolve_sow_clause(
  p_clause_key  text,
  p_project_id  uuid  default null,
  p_client_id   uuid  default null,
  p_service_id  uuid  default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_schema        clause_schema%rowtype;
  v_levels        sow_levels[];
  v_level         sow_levels;
  v_val           clause_values%rowtype;
  v_items         text[] := '{}';
  v_scope_id      uuid;
begin
  select * into v_schema from clause_schema where key = p_clause_key;
  if not found then return null; end if;

  if v_schema.merge_strategy = 'replace' then
    select array_agg(l order by l.priority desc) into v_levels from sow_levels l;
  else
    select array_agg(l order by l.priority asc)  into v_levels from sow_levels l;
  end if;

  foreach v_level in array v_levels loop
    v_scope_id := case v_level.level_type
      when 'project' then p_project_id
      when 'client'  then p_client_id
      when 'service' then p_service_id
      else null
    end;

    select * into v_val
    from   clause_values
    where  clause_key = p_clause_key
    and    level_id   = v_level.id
    and    (
             (scope_id = v_scope_id)
             or (scope_id is null and v_scope_id is null)
           )
    limit 1;

    if found then
      if v_schema.merge_strategy = 'replace' then
        return jsonb_build_object(
          'value',             coalesce(v_val.value_text, v_val.value_number::text, v_val.value_bool::text),
          'value_type',        v_schema.value_type,
          'merge_strategy',    v_schema.merge_strategy,
          'source_level_id',   v_level.id,
          'source_level_name', v_level.name
        );
      else
        if v_val.value_text is not null then
          v_items := v_items || array(
            select jsonb_array_elements_text(v_val.value_text::jsonb)
          );
        end if;
      end if;
    end if;
  end loop;

  if v_schema.merge_strategy = 'append' and array_length(v_items, 1) > 0 then
    return jsonb_build_object(
      'value',             to_jsonb(v_items),
      'value_type',        v_schema.value_type,
      'merge_strategy',    v_schema.merge_strategy,
      'source_level_id',   null,
      'source_level_name', 'multiple levels'
    );
  end if;

  return null;
end;
$$;
