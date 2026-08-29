-- Human-decision checkpoint: typed resolutions and a workspace-wide inbox.
-- The generic decision model remains intact; only completed resolutions gain a
-- machine-readable outcome so agents can react without interpreting prose.

alter table public.decisions
  add column if not exists resolution_outcome text;

do $$
begin
  if exists (
    select 1
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.decisions'::regclass
      and constraint_row.conname = 'decisions_resolution_outcome_check'
  ) then
    alter table public.decisions
      drop constraint decisions_resolution_outcome_check;
  end if;
end;
$$;

alter table public.decisions
  add constraint decisions_resolution_outcome_check
  check (resolution_outcome is null or resolution_outcome in ('accepted', 'redirected'))
  not valid;

alter table public.decisions
  add constraint decisions_resolution_outcome_requires_resolution_check
  check (resolution_outcome is null or status = 'resolved')
  not valid;

alter table public.decisions
  validate constraint decisions_resolution_outcome_check;
alter table public.decisions
  validate constraint decisions_resolution_outcome_requires_resolution_check;

-- This is the exact access path for the workspace-wide pending-decision inbox.
-- It already exists on recent databases, so preserve it instead of creating a
-- redundant duplicate index during the forward migration.
create index if not exists decisions_pending_idx
  on public.decisions (workspace_id, created_at, id)
  where status = 'pending';

create or replace function private.decision_ancestry(p_decision_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'objective_id', coalesce(
      decision.objective_id,
      direct_strategy.objective_id,
      direct_branch_strategy.objective_id,
      direct_step_strategy.objective_id
    ),
    'strategy_id', coalesce(
      decision.strategy_id,
      direct_branch.strategy_id,
      direct_step.strategy_id
    ),
    'branch_id', coalesce(decision.branch_id, direct_step.branch_id),
    'step_id', decision.step_id
  )
  from public.decisions as decision
  left join public.strategies as direct_strategy
    on direct_strategy.id = decision.strategy_id
    and direct_strategy.workspace_id = decision.workspace_id
  left join public.branches as direct_branch
    on direct_branch.id = decision.branch_id
    and direct_branch.workspace_id = decision.workspace_id
  left join public.strategies as direct_branch_strategy
    on direct_branch_strategy.id = direct_branch.strategy_id
    and direct_branch_strategy.workspace_id = direct_branch.workspace_id
  left join public.steps as direct_step
    on direct_step.id = decision.step_id
    and direct_step.workspace_id = decision.workspace_id
  left join public.strategies as direct_step_strategy
    on direct_step_strategy.id = direct_step.strategy_id
    and direct_step_strategy.workspace_id = direct_step.workspace_id
  where decision.id = p_decision_id;
$$;

revoke execute on function private.decision_ancestry(uuid) from public, anon;
grant execute on function private.decision_ancestry(uuid) to authenticated;

create or replace function public.request_human_decision(
  p_workspace_id uuid,
  p_question_markdown text,
  p_idempotency_key text,
  p_objective_id uuid default null,
  p_strategy_id uuid default null,
  p_branch_id uuid default null,
  p_step_id uuid default null,
  p_kind text default 'human_decision',
  p_author_type text default 'agent',
  p_author_agent_name text default 'Codex'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  is_new boolean;
  cached jsonb;
  decision_uuid uuid;
  ancestry jsonb;
  result jsonb;
begin
  if num_nonnulls(p_objective_id, p_strategy_id, p_branch_id, p_step_id) > 1 then
    raise exception 'LEMMA_DECISION_MAY_TARGET_ONLY_ONE_ENTITY' using errcode = '23514';
  end if;

  if p_objective_id is not null and not exists (
    select 1
    from public.objectives as objective
    where objective.id = p_objective_id
      and objective.workspace_id = p_workspace_id
  ) then
    raise exception 'LEMMA_OBJECTIVE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_strategy_id is not null and not exists (
    select 1
    from public.strategies as strategy
    where strategy.id = p_strategy_id
      and strategy.workspace_id = p_workspace_id
  ) then
    raise exception 'LEMMA_STRATEGY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_branch_id is not null and not exists (
    select 1
    from public.branches as branch
    where branch.id = p_branch_id
      and branch.workspace_id = p_workspace_id
  ) then
    raise exception 'LEMMA_BRANCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_step_id is not null and not exists (
    select 1
    from public.steps as step
    where step.id = p_step_id
      and step.workspace_id = p_workspace_id
  ) then
    raise exception 'LEMMA_STEP_NOT_FOUND' using errcode = 'P0002';
  end if;

  select claimed, cached_response into is_new, cached
  from private.claim_mutation(
    p_workspace_id, p_idempotency_key, 'request_human_decision'
  );
  if not is_new then
    ancestry := private.decision_ancestry((cached ->> 'decision_id')::uuid);
    return cached || jsonb_build_object('ancestry', ancestry);
  end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  insert into public.decisions (
    workspace_id,
    objective_id,
    strategy_id,
    branch_id,
    step_id,
    kind,
    question_markdown,
    requested_by_type,
    requested_by_user_id,
    requested_by_agent_name
  ) values (
    p_workspace_id,
    p_objective_id,
    p_strategy_id,
    p_branch_id,
    p_step_id,
    p_kind,
    p_question_markdown,
    p_author_type,
    (select auth.uid()),
    p_author_agent_name
  ) returning id into decision_uuid;

  ancestry := private.decision_ancestry(decision_uuid);
  result := jsonb_build_object(
    'decision_id', decision_uuid,
    'decision_revision', 1,
    'status', 'pending',
    'workspace_id', p_workspace_id,
    'objective_id', p_objective_id,
    'ancestry', ancestry
  );
  perform private.finish_mutation(
    p_workspace_id, p_idempotency_key, decision_uuid, result
  );
  return result;
end;
$$;

drop function public.resolve_human_decision(uuid, bigint, text, text, text, text);

create function public.resolve_human_decision(
  p_decision_id uuid,
  p_expected_revision bigint,
  p_resolution_outcome text,
  p_resolution_markdown text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  decision_row public.decisions%rowtype;
  is_new boolean;
  cached jsonb;
  result jsonb;
begin
  if p_resolution_outcome is null
    or p_resolution_outcome not in ('accepted', 'redirected') then
    raise exception 'LEMMA_INVALID_RESOLUTION_OUTCOME' using errcode = '22023';
  end if;
  if nullif(btrim(p_resolution_markdown), '') is null then
    raise exception 'LEMMA_RESOLUTION_REQUIRED' using errcode = '22023';
  end if;

  select * into decision_row from public.decisions where id = p_decision_id;
  if not found then
    raise exception 'LEMMA_DECISION_NOT_FOUND' using errcode = 'P0002';
  end if;

  select claimed, cached_response into is_new, cached
  from private.claim_mutation(
    decision_row.workspace_id, p_idempotency_key, 'resolve_human_decision'
  );
  if not is_new then
    return cached || jsonb_build_object('resolution_outcome', decision_row.resolution_outcome);
  end if;

  -- A resolution is a human checkpoint. The request may be agent-authored,
  -- but an API caller cannot declare the resolver to be an agent.
  perform private.set_actor_context('human', null);

  update public.decisions
  set
    status = 'resolved',
    resolution_outcome = p_resolution_outcome,
    resolution_markdown = btrim(p_resolution_markdown),
    resolved_by_user_id = (select auth.uid()),
    resolved_at = clock_timestamp(),
    revision = revision + 1
  where id = p_decision_id
    and revision = p_expected_revision
    and status = 'pending'
  returning * into decision_row;

  if not found then
    raise exception 'LEMMA_REVISION_CONFLICT_OR_DECISION_CLOSED' using errcode = '40001';
  end if;

  result := jsonb_build_object(
    'decision_id', decision_row.id,
    'decision_revision', decision_row.revision,
    'status', decision_row.status,
    'resolution_outcome', decision_row.resolution_outcome,
    'resolved_at', decision_row.resolved_at
  );
  perform private.finish_mutation(
    decision_row.workspace_id, p_idempotency_key, decision_row.id, result
  );
  return result;
end;
$$;

create or replace function public.list_pending_decisions(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not exists (
    select 1
    from public.workspaces as workspace
    where workspace.id = p_workspace_id
  ) then
    raise exception 'LEMMA_WORKSPACE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'decision', to_jsonb(decision),
        'ancestry', private.decision_ancestry(decision.id)
      )
      order by decision.created_at, decision.id
    ),
    '[]'::jsonb
  ) into result
  from (
    select pending.*
    from public.decisions as pending
    where pending.workspace_id = p_workspace_id
      and pending.status = 'pending'
    order by pending.created_at, pending.id
    limit 1000
  ) as decision;

  return result;
end;
$$;

-- Keep activity events compact, but let the graph audit distinguish the two
-- typed human outcomes without duplicating user-authored Markdown.
create or replace function private.record_activity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb := to_jsonb(new);
  workspace_uuid uuid;
  objective_uuid uuid;
  entity_uuid uuid;
  actor_kind text;
  agent_name text;
  row_revision bigint;
begin
  workspace_uuid := case
    when tg_table_name = 'workspaces' then new.id
    else (row_data ->> 'workspace_id')::uuid
  end;
  objective_uuid := private.resolve_activity_objective_id(tg_table_name, row_data);
  entity_uuid := new.id;

  actor_kind := nullif(current_setting('lemma.actor_type', true), '');
  if actor_kind not in ('human', 'agent', 'system') then
    actor_kind := case when (select auth.uid()) is null then 'system' else 'human' end;
  end if;

  agent_name := nullif(current_setting('lemma.actor_agent_name', true), '');
  row_revision := nullif(row_data ->> 'revision', '')::bigint;

  insert into public.activity_events (
    workspace_id,
    objective_id,
    entity_type,
    entity_id,
    event_type,
    actor_type,
    actor_user_id,
    actor_agent_name,
    entity_revision,
    details
  ) values (
    workspace_uuid,
    objective_uuid,
    tg_table_name,
    entity_uuid,
    lower(tg_op),
    actor_kind,
    (select auth.uid()),
    case when actor_kind = 'agent' then agent_name else null end,
    row_revision,
    jsonb_strip_nulls(jsonb_build_object(
      'status', coalesce(row_data ->> 'status', row_data ->> 'outcome_status'),
      'title', row_data ->> 'title',
      'resolution_outcome', row_data ->> 'resolution_outcome'
    ))
  );

  return new;
end;
$$;

revoke execute on function public.resolve_human_decision(uuid, bigint, text, text, text)
  from public, anon;
grant execute on function public.resolve_human_decision(uuid, bigint, text, text, text)
  to authenticated;
revoke execute on function public.list_pending_decisions(uuid) from public, anon;
grant execute on function public.list_pending_decisions(uuid) to authenticated;

comment on function public.list_pending_decisions(uuid)
  is 'Returns up to 1000 authorized pending decisions for one workspace in deterministic created_at/id order with derived graph ancestry.';
