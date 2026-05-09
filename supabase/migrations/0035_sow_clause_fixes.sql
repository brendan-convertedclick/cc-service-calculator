-- Fix 1: NULL uniqueness gap in clause_values unique constraint
-- PostgreSQL UNIQUE constraints treat NULL as distinct, so (clause_key, level_id, NULL)
-- can have multiple rows. Use partial indexes for correct semantics.
alter table clause_values
  drop constraint if exists clause_values_clause_key_level_id_scope_id_key;

create unique index if not exists clause_values_uq_with_scope
  on clause_values (clause_key, level_id, scope_id)
  where scope_id is not null;

create unique index if not exists clause_values_uq_null_scope
  on clause_values (clause_key, level_id)
  where scope_id is null;

-- Fix 2: Remove SECURITY DEFINER from resolve_sow_clause
-- The clause_values RLS policy is open (for all to authenticated), so SECURITY DEFINER
-- is not needed and introduces unnecessary privilege risk.
create or replace function resolve_sow_clause(
  p_clause_key  text,
  p_project_id  uuid  default null,
  p_client_id   uuid  default null,
  p_service_id  uuid  default null
)
returns jsonb
language plpgsql
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

-- Fix 3: Standardise RLS policies to established project pattern
drop policy if exists "authenticated write sow_levels" on sow_levels;
create policy "authenticated write sow_levels" on sow_levels
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated write clause_schema" on clause_schema;
create policy "authenticated write clause_schema" on clause_schema
  for all to authenticated using (true) with check (true);
