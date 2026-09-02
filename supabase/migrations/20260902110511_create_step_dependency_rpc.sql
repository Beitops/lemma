-- Give agents the same receipt-backed mutation path as the browser for
-- explicit reasoning dependencies. The prerequisite is stored in
-- depends_on_step_id; step_id is the dependent conclusion.
create or replace function public.create_step_dependency(
  p_workspace_id uuid,
  p_source_step_id uuid,
  p_target_step_id uuid,
  p_idempotency_key uuid,
  p_author_type text default 'human',
  p_author_agent_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_objective_id uuid;
  target_objective_id uuid;
  dependency_row public.step_dependencies%rowtype;
  is_new boolean;
  cached jsonb;
  result jsonb;
begin
  if p_source_step_id = p_target_step_id then
    raise exception 'LEMMA_DEPENDENCY_CANNOT_REFERENCE_ITSELF' using errcode = '22023';
  end if;

  select claimed, cached_response into is_new, cached
  from private.claim_mutation(
    p_workspace_id,
    p_idempotency_key::text,
    'create_step_dependency'
  );
  if not is_new then
    return cached;
  end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  select strategy.objective_id into source_objective_id
  from public.steps as step
  join public.strategies as strategy on strategy.id = step.strategy_id
  where step.id = p_source_step_id
    and step.workspace_id = p_workspace_id;
  if not found then
    raise exception 'LEMMA_STEP_NOT_FOUND' using errcode = 'P0002';
  end if;

  select strategy.objective_id into target_objective_id
  from public.steps as step
  join public.strategies as strategy on strategy.id = step.strategy_id
  where step.id = p_target_step_id
    and step.workspace_id = p_workspace_id;
  if not found then
    raise exception 'LEMMA_STEP_NOT_FOUND' using errcode = 'P0002';
  end if;

  if source_objective_id <> target_objective_id then
    raise exception 'LEMMA_DEPENDENCY_OBJECTIVES_MUST_MATCH' using errcode = '23514';
  end if;

  -- Validate both endpoints before taking the workspace lock. The remaining
  -- lock scope serializes only the active-edge lookup and trigger-backed cycle
  -- check; no work outside Postgres occurs while it is held.
  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;
  if not found then
    raise exception 'LEMMA_WORKSPACE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select dependency.* into dependency_row
  from public.step_dependencies as dependency
  where dependency.workspace_id = p_workspace_id
    and dependency.depends_on_step_id = p_source_step_id
    and dependency.step_id = p_target_step_id
    and dependency.status = 'active';

  if found then
    result := jsonb_build_object(
      'step_dependency_id', dependency_row.id,
      'dependency_revision', dependency_row.revision,
      'workspace_id', p_workspace_id,
      'source_step_id', p_source_step_id,
      'target_step_id', p_target_step_id,
      'created', false
    );
    perform private.finish_mutation(
      p_workspace_id,
      p_idempotency_key::text,
      dependency_row.id,
      result
    );
    return result;
  end if;

  insert into public.step_dependencies (
    id,
    workspace_id,
    step_id,
    depends_on_step_id,
    relation_kind,
    rationale_markdown,
    status,
    author_type,
    author_user_id,
    author_agent_name
  ) values (
    p_idempotency_key,
    p_workspace_id,
    p_target_step_id,
    p_source_step_id,
    'logical',
    '',
    'active',
    p_author_type,
    (select auth.uid()),
    p_author_agent_name
  )
  on conflict (step_id, depends_on_step_id) do nothing
  returning * into dependency_row;

  if not found then
    -- The workspace lock prevents races between this RPC's callers. Retain a
    -- defensive fallback for an older/direct writer that raced this mutation.
    select dependency.* into dependency_row
    from public.step_dependencies as dependency
    where dependency.workspace_id = p_workspace_id
      and dependency.depends_on_step_id = p_source_step_id
      and dependency.step_id = p_target_step_id
      and dependency.status = 'active';

    if not found then
      raise exception 'LEMMA_DEPENDENCY_ALREADY_EXISTS' using errcode = '23514';
    end if;

    result := jsonb_build_object(
      'step_dependency_id', dependency_row.id,
      'dependency_revision', dependency_row.revision,
      'workspace_id', p_workspace_id,
      'source_step_id', p_source_step_id,
      'target_step_id', p_target_step_id,
      'created', false
    );
  else
    result := jsonb_build_object(
      'step_dependency_id', dependency_row.id,
      'dependency_revision', dependency_row.revision,
      'workspace_id', p_workspace_id,
      'source_step_id', p_source_step_id,
      'target_step_id', p_target_step_id,
      'created', true
    );
  end if;

  perform private.finish_mutation(
    p_workspace_id,
    p_idempotency_key::text,
    dependency_row.id,
    result
  );
  return result;
end;
$$;

revoke execute on function public.create_step_dependency(
  uuid, uuid, uuid, uuid, text, text
) from public, anon;
grant execute on function public.create_step_dependency(
  uuid, uuid, uuid, uuid, text, text
) to authenticated;

comment on function public.create_step_dependency(uuid, uuid, uuid, uuid, text, text)
  is 'Creates an active logical dependency from prerequisite source_step_id to dependent target_step_id with a receipt-backed UUID idempotency key.';
