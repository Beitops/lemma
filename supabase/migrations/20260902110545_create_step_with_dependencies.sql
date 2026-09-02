-- Replace the legacy create_step signature instead of overloading it so
-- PostgREST callers have one unambiguous mutation endpoint. Dependencies are
-- attached in the same transaction as the new step and are therefore never
-- visible without their target step.
drop function public.create_step(
  uuid, text, text, bigint, text, text, text[], text[], text, uuid, text, text
);

create function public.create_step(
  p_branch_id uuid,
  p_title text,
  p_body_markdown text,
  p_expected_branch_revision bigint,
  p_idempotency_key text,
  p_summary text default null,
  p_concepts text[] default '{}'::text[],
  p_theorem_tags text[] default '{}'::text[],
  p_status text default 'active',
  p_supersedes_step_id uuid default null,
  p_author_type text default 'human',
  p_author_agent_name text default null,
  p_depends_on_step_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  branch_row public.branches%rowtype;
  old_step public.steps%rowtype;
  branch_objective_id uuid;
  is_new boolean;
  cached jsonb;
  next_ordinal integer;
  step_uuid uuid;
  prerequisite_count integer;
  objective_prerequisite_count integer;
  dependency_results jsonb := '[]'::jsonb;
  result jsonb;
begin
  select * into branch_row from public.branches where id = p_branch_id;
  if not found then
    raise exception 'LEMMA_BRANCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  select claimed, cached_response into is_new, cached
  from private.claim_mutation(
    branch_row.workspace_id, p_idempotency_key, 'create_step'
  );
  if not is_new then
    -- Legacy receipts intentionally keep their original response shape. The
    -- API contract supplies an empty dependency list for those responses.
    return cached;
  end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  if p_depends_on_step_ids is null
    or array_position(p_depends_on_step_ids, null::uuid) is not null then
    raise exception 'LEMMA_DEPENDENCY_IDS_MUST_NOT_CONTAIN_NULLS' using errcode = '22023';
  end if;

  if cardinality(p_depends_on_step_ids) > 64 then
    raise exception 'LEMMA_TOO_MANY_STEP_DEPENDENCIES' using errcode = '22023';
  end if;

  if cardinality(p_depends_on_step_ids) <> (
    select count(distinct prerequisite.prerequisite_id)
    from unnest(p_depends_on_step_ids) as prerequisite(prerequisite_id)
  ) then
    raise exception 'LEMMA_DUPLICATE_STEP_DEPENDENCY' using errcode = '22023';
  end if;

  -- Any dependency insert will take this same workspace lock in its cycle
  -- trigger. Acquire it before the branch lock to keep graph mutations in a
  -- consistent order and avoid a workspace/branch lock inversion.
  if cardinality(p_depends_on_step_ids) > 0 then
    perform 1
    from public.workspaces as workspace
    where workspace.id = branch_row.workspace_id
    for update;
    if not found then
      raise exception 'LEMMA_WORKSPACE_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  select * into branch_row
  from public.branches
  where id = p_branch_id
  for update;

  if branch_row.revision <> p_expected_branch_revision then
    raise exception 'LEMMA_REVISION_CONFLICT: branch is at revision %', branch_row.revision
      using errcode = '40001';
  end if;

  if branch_row.status <> 'active' then
    raise exception 'LEMMA_BRANCH_NOT_ACTIVE' using errcode = '23514';
  end if;

  if cardinality(p_depends_on_step_ids) > 0 then
    select strategy.objective_id into branch_objective_id
    from public.strategies as strategy
    where strategy.id = branch_row.strategy_id
      and strategy.workspace_id = branch_row.workspace_id;
    if not found then
      raise exception 'LEMMA_OBJECTIVE_NOT_FOUND' using errcode = 'P0002';
    end if;

    select count(*) into prerequisite_count
    from public.steps as prerequisite
    where prerequisite.workspace_id = branch_row.workspace_id
      and prerequisite.id = any(p_depends_on_step_ids);
    if prerequisite_count <> cardinality(p_depends_on_step_ids) then
      raise exception 'LEMMA_DEPENDENCY_STEP_NOT_FOUND' using errcode = 'P0002';
    end if;

    select count(*) into objective_prerequisite_count
    from public.steps as prerequisite
    join public.strategies as prerequisite_strategy
      on prerequisite_strategy.id = prerequisite.strategy_id
      and prerequisite_strategy.workspace_id = prerequisite.workspace_id
    where prerequisite.workspace_id = branch_row.workspace_id
      and prerequisite.id = any(p_depends_on_step_ids)
      and prerequisite_strategy.objective_id = branch_objective_id;
    if objective_prerequisite_count <> cardinality(p_depends_on_step_ids) then
      raise exception 'LEMMA_DEPENDENCY_OBJECTIVES_MUST_MATCH' using errcode = '23514';
    end if;
  end if;

  if p_supersedes_step_id is not null then
    select * into old_step
    from public.steps
    where id = p_supersedes_step_id
    for update;

    if not found or old_step.branch_id <> branch_row.id then
      raise exception 'LEMMA_SUPERSEDED_STEP_MUST_SHARE_BRANCH' using errcode = '23514';
    end if;

    update public.steps
    set status = 'superseded', revision = revision + 1
    where id = old_step.id;
  end if;

  select coalesce(max(ordinal), 0) + 1 into next_ordinal
  from public.steps
  where branch_id = p_branch_id;

  insert into public.steps (
    workspace_id,
    strategy_id,
    branch_id,
    ordinal,
    title,
    summary,
    body_markdown,
    concepts,
    theorem_tags,
    status,
    supersedes_step_id,
    author_type,
    author_user_id,
    author_agent_name
  ) values (
    branch_row.workspace_id,
    branch_row.strategy_id,
    branch_row.id,
    next_ordinal,
    p_title,
    p_summary,
    p_body_markdown,
    coalesce(p_concepts, '{}'::text[]),
    coalesce(p_theorem_tags, '{}'::text[]),
    p_status,
    p_supersedes_step_id,
    p_author_type,
    (select auth.uid()),
    p_author_agent_name
  ) returning id into step_uuid;

  -- One set-based insert keeps the step and every declared prerequisite in the
  -- same transaction. Existing relation triggers remain the authoritative
  -- enforcement point for RLS, same-objective checks, and cycle prevention.
  with inserted_dependencies as (
    insert into public.step_dependencies (
      workspace_id,
      step_id,
      depends_on_step_id,
      relation_kind,
      rationale_markdown,
      status,
      author_type,
      author_user_id,
      author_agent_name
    )
    select
      branch_row.workspace_id,
      step_uuid,
      prerequisite.prerequisite_id,
      'logical',
      '',
      'active',
      p_author_type,
      (select auth.uid()),
      p_author_agent_name
    from unnest(p_depends_on_step_ids) as prerequisite(prerequisite_id)
    returning id, revision, depends_on_step_id, step_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'step_dependency_id', inserted_dependencies.id,
        'dependency_revision', inserted_dependencies.revision,
        'source_step_id', inserted_dependencies.depends_on_step_id,
        'target_step_id', inserted_dependencies.step_id
      )
      order by array_position(
        p_depends_on_step_ids,
        inserted_dependencies.depends_on_step_id
      )
    ),
    '[]'::jsonb
  ) into dependency_results
  from inserted_dependencies;

  update public.branches
  set revision = revision + 1
  where id = branch_row.id;

  result := jsonb_build_object(
    'step_id', step_uuid,
    'step_revision', 1,
    'branch_id', branch_row.id,
    'branch_revision', branch_row.revision + 1,
    'ordinal', next_ordinal
  );
  if cardinality(p_depends_on_step_ids) > 0 then
    result := result || jsonb_build_object('step_dependencies', dependency_results);
  end if;
  perform private.finish_mutation(
    branch_row.workspace_id, p_idempotency_key, step_uuid, result
  );
  return result;
end;
$$;

revoke execute on function public.create_step(
  uuid, text, text, bigint, text, text, text[], text[], text, uuid, text, text, uuid[]
) from public, anon;
grant execute on function public.create_step(
  uuid, text, text, bigint, text, text, text[], text[], text, uuid, text, text, uuid[]
) to authenticated;

comment on function public.create_step(
  uuid, text, text, bigint, text, text, text[], text[], text, uuid, text, text, uuid[]
) is 'Appends one step and its active logical prerequisite dependencies atomically, with optimistic branch concurrency and receipt-backed idempotency.';
