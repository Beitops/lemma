-- Lemma: multi-objective workspaces.
--
-- This beta migration intentionally discards every existing workspace and its
-- dependent graph before changing the aggregate boundary. A pre-migration
-- export was frozen in supabase/baselines/20260831_pre_multi_objective_migrations.
-- Do not remove this reset until a reviewed, non-destructive backfill exists.

-- ---------------------------------------------------------------------------
-- Beta reset and removal of the legacy workspace-level result model
-- ---------------------------------------------------------------------------

delete from public.workspaces;

drop function if exists public.get_workspace_graph(uuid);
drop function if exists public.set_workspace_result(
  uuid, uuid, bigint, bigint, text, text, text, text
);
drop table if exists public.workspace_results cascade;

drop function if exists private.enforce_workspace_result_source_branch();
drop function if exists private.record_workspace_result_activity_event();
drop function if exists private.stamp_workspace_result_author();

-- A workspace is now a shell: its objectives are independent records.
alter table public.workspaces
  drop column objective_markdown,
  drop column constraints_markdown;

-- ---------------------------------------------------------------------------
-- Objectives and objective-scoped structural references
-- ---------------------------------------------------------------------------

create table public.objectives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  objective_markdown text not null check (
    char_length(btrim(objective_markdown)) between 1 and 100000
  ),
  constraints_markdown text not null default '' check (
    char_length(constraints_markdown) <= 50000
  ),
  status text not null default 'active' check (
    status in ('active', 'completed', 'archived')
  ),
  author_type text not null default 'human' check (
    author_type in ('human', 'agent', 'system')
  ),
  author_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  author_agent_name text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  check (
    (author_type = 'human' and author_user_id is not null and author_agent_name is null)
    or (author_type = 'agent' and author_user_id is not null and nullif(btrim(author_agent_name), '') is not null)
    or (author_type = 'system' and author_user_id is null)
  )
);

create index objectives_workspace_status_created_idx
  on public.objectives (workspace_id, status, created_at, id);
create index objectives_author_user_id_idx
  on public.objectives (author_user_id) where author_user_id is not null;

alter table public.context_items
  add column objective_id uuid,
  add constraint context_items_objective_workspace_fkey
    foreign key (objective_id, workspace_id)
    references public.objectives (id, workspace_id)
    on delete cascade;

create index context_items_workspace_objective_created_idx
  on public.context_items (workspace_id, objective_id, created_at desc, id);
create index context_items_objective_workspace_fk_idx
  on public.context_items (objective_id, workspace_id);

alter table public.strategies
  add column objective_id uuid not null,
  add constraint strategies_id_objective_workspace_key
    unique (id, objective_id, workspace_id),
  add constraint strategies_objective_workspace_fkey
    foreign key (objective_id, workspace_id)
    references public.objectives (id, workspace_id)
    on delete cascade;

create index strategies_objective_workspace_fk_idx
  on public.strategies (objective_id, workspace_id);
create index strategies_workspace_objective_status_idx
  on public.strategies (workspace_id, objective_id, status, created_at, id);

alter table public.decisions
  add column objective_id uuid,
  add constraint decisions_objective_workspace_fkey
    foreign key (objective_id, workspace_id)
    references public.objectives (id, workspace_id)
    on delete cascade;

do $$
declare
  target_constraint text;
begin
  select con_row.conname
  into target_constraint
  from pg_constraint as con_row
  where con_row.conrelid = 'public.decisions'::regclass
    and con_row.contype = 'c'
    and pg_get_constraintdef(con_row.oid)
      like '%num_nonnulls(strategy_id, branch_id, step_id)%';

  if target_constraint is not null then
    execute format('alter table public.decisions drop constraint %I', target_constraint);
  end if;
end;
$$;

alter table public.decisions
  add constraint decisions_single_target_check
  check (num_nonnulls(objective_id, strategy_id, branch_id, step_id) <= 1);

create index decisions_objective_id_idx
  on public.decisions (objective_id) where objective_id is not null;
create index decisions_objective_workspace_fk_idx
  on public.decisions (objective_id, workspace_id);

alter table public.activity_events
  add column objective_id uuid,
  add constraint activity_events_objective_workspace_fkey
    foreign key (objective_id, workspace_id)
    references public.objectives (id, workspace_id)
    on delete cascade;

create index activity_events_workspace_objective_cursor_idx
  on public.activity_events (workspace_id, objective_id, created_at desc, id);
create index activity_events_objective_workspace_fk_idx
  on public.activity_events (objective_id, workspace_id);

-- ---------------------------------------------------------------------------
-- Generalized editable reasoning results
-- ---------------------------------------------------------------------------

create table public.reasoning_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  objective_id uuid not null,
  strategy_id uuid not null,
  branch_id uuid,
  target_type text generated always as (
    case when branch_id is null then 'strategy' else 'branch' end
  ) stored,
  target_id uuid generated always as (coalesce(branch_id, strategy_id)) stored,
  target_revision bigint not null check (target_revision > 0),
  outcome_status text not null check (
    outcome_status in ('successful', 'unsuccessful', 'inconclusive')
  ),
  result_markdown text not null check (
    char_length(btrim(result_markdown)) between 1 and 100000
  ),
  author_type text not null check (author_type in ('human', 'agent')),
  author_user_id uuid references auth.users (id) on delete cascade default auth.uid(),
  author_agent_name text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id) references public.workspaces (id) on delete cascade,
  foreign key (objective_id, workspace_id)
    references public.objectives (id, workspace_id) on delete cascade,
  foreign key (strategy_id, objective_id, workspace_id)
    references public.strategies (id, objective_id, workspace_id) on delete cascade,
  foreign key (branch_id, strategy_id, workspace_id)
    references public.branches (id, strategy_id, workspace_id) on delete cascade,
  check (
    (target_type = 'strategy' and branch_id is null and target_id = strategy_id)
    or (target_type = 'branch' and branch_id is not null and target_id = branch_id)
  ),
  check (
    (author_type = 'human' and author_user_id is not null and author_agent_name is null)
    or (
      author_type = 'agent'
      and author_user_id is not null
      and nullif(btrim(author_agent_name), '') is not null
    )
  )
);

create unique index reasoning_results_one_strategy_target_idx
  on public.reasoning_results (strategy_id)
  where branch_id is null;
create unique index reasoning_results_one_branch_target_idx
  on public.reasoning_results (branch_id)
  where branch_id is not null;
create index reasoning_results_objective_created_idx
  on public.reasoning_results (workspace_id, objective_id, created_at desc, id);
create index reasoning_results_objective_workspace_fk_idx
  on public.reasoning_results (objective_id, workspace_id);
create index reasoning_results_strategy_objective_workspace_fk_idx
  on public.reasoning_results (strategy_id, objective_id, workspace_id);
create index reasoning_results_branch_strategy_workspace_fk_idx
  on public.reasoning_results (branch_id, strategy_id, workspace_id)
  where branch_id is not null;
create index reasoning_results_author_user_id_idx
  on public.reasoning_results (author_user_id) where author_user_id is not null;

-- Workspace creation has no workspace UUID to use as a mutation-receipt key.
-- Keep its receipt per authenticated owner instead of making browser retries
-- create duplicate empty workspaces.
create table private.workspace_creation_receipts (
  owner_id uuid not null references auth.users (id) on delete cascade,
  idempotency_key text not null check (
    char_length(btrim(idempotency_key)) between 8 and 200
  ),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (owner_id, idempotency_key)
);

create index workspace_creation_receipts_workspace_fk_idx
  on private.workspace_creation_receipts (workspace_id)
  where workspace_id is not null;

alter table private.workspace_creation_receipts enable row level security;

create policy workspace_creation_receipts_select_owner
on private.workspace_creation_receipts for select to authenticated
using ((select auth.uid()) = owner_id);
create policy workspace_creation_receipts_insert_owner
on private.workspace_creation_receipts for insert to authenticated
with check ((select auth.uid()) = owner_id);
create policy workspace_creation_receipts_update_owner
on private.workspace_creation_receipts for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

revoke all on table private.workspace_creation_receipts from anon, authenticated;
grant select, insert, update on table private.workspace_creation_receipts to authenticated;

-- ---------------------------------------------------------------------------
-- Scope-preserving triggers, activity metadata, and objective isolation
-- ---------------------------------------------------------------------------

drop trigger a_context_items_immutable on public.context_items;
create trigger a_context_items_immutable
before update on public.context_items
for each row execute function private.prevent_column_changes(
  'id', 'workspace_id', 'objective_id', 'author_type', 'author_user_id',
  'author_agent_name'
);

drop trigger a_strategies_immutable on public.strategies;
create trigger a_strategies_immutable
before update on public.strategies
for each row execute function private.prevent_column_changes(
  'id', 'workspace_id', 'objective_id', 'author_type', 'author_user_id',
  'author_agent_name'
);

drop trigger a_decisions_immutable on public.decisions;
create trigger a_decisions_immutable
before update on public.decisions
for each row execute function private.prevent_column_changes(
  'id', 'workspace_id', 'objective_id', 'strategy_id', 'branch_id', 'step_id',
  'kind', 'question_markdown', 'requested_by_type', 'requested_by_user_id',
  'requested_by_agent_name'
);

-- A source's link to a context item is structural. Keeping it immutable
-- prevents changing a previously valid general source into another
-- objective's specific context after it has already been cited by steps.
drop trigger a_sources_immutable on public.sources;
create trigger a_sources_immutable
before update on public.sources
for each row execute function private.prevent_column_changes(
  'id', 'workspace_id', 'context_item_id', 'author_type', 'author_user_id',
  'author_agent_name'
);

create trigger a_objectives_actor before insert on public.objectives
for each row execute function private.enforce_actor_is_caller('author_type', 'author_user_id');
create trigger a_objectives_immutable before update on public.objectives
for each row execute function private.prevent_column_changes(
  'id', 'workspace_id', 'author_type', 'author_user_id', 'author_agent_name'
);
create trigger b_objectives_revision before update on public.objectives
for each row execute function private.enforce_revision_bump();
create trigger z_objectives_activity after insert or update on public.objectives
for each row execute function private.record_activity_event();

create or replace function private.resolve_activity_objective_id(
  p_table_name text,
  p_row_data jsonb
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resolved_objective_id uuid;
  row_uuid uuid;
begin
  if nullif(p_row_data ->> 'objective_id', '') is not null then
    return (p_row_data ->> 'objective_id')::uuid;
  end if;

  if nullif(p_row_data ->> 'strategy_id', '') is not null then
    select strategy.objective_id into resolved_objective_id
    from public.strategies as strategy
    where strategy.id = (p_row_data ->> 'strategy_id')::uuid;
    return resolved_objective_id;
  end if;

  if nullif(p_row_data ->> 'branch_id', '') is not null then
    select strategy.objective_id into resolved_objective_id
    from public.branches as branch
    join public.strategies as strategy on strategy.id = branch.strategy_id
    where branch.id = (p_row_data ->> 'branch_id')::uuid;
    return resolved_objective_id;
  end if;

  if nullif(p_row_data ->> 'step_id', '') is not null then
    select strategy.objective_id into resolved_objective_id
    from public.steps as step
    join public.strategies as strategy on strategy.id = step.strategy_id
    where step.id = (p_row_data ->> 'step_id')::uuid;
    return resolved_objective_id;
  end if;

  if p_table_name = 'objectives' then
    return (p_row_data ->> 'id')::uuid;
  end if;

  if p_table_name = 'sources'
    and nullif(p_row_data ->> 'context_item_id', '') is not null then
    select context_item.objective_id into resolved_objective_id
    from public.context_items as context_item
    where context_item.id = (p_row_data ->> 'context_item_id')::uuid;
    return resolved_objective_id;
  end if;

  -- Workspace-level assumptions and free-standing sources deliberately remain
  -- unscoped activity: they can later be linked from several objectives.
  return null;
end;
$$;

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
      'title', row_data ->> 'title'
    ))
  );

  return new;
end;
$$;

create or replace function private.record_relation_activity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  actor_kind text;
  agent_name text;
begin
  actor_kind := nullif(current_setting('lemma.actor_type', true), '');
  if actor_kind not in ('human', 'agent', 'system') then
    actor_kind := case when (select auth.uid()) is null then 'system' else 'human' end;
  end if;
  agent_name := nullif(current_setting('lemma.actor_agent_name', true), '');

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
    (row_data ->> 'workspace_id')::uuid,
    private.resolve_activity_objective_id(tg_table_name, row_data),
    tg_table_name,
    (row_data ->> 'id')::uuid,
    lower(tg_op),
    actor_kind,
    (select auth.uid()),
    case when actor_kind = 'agent' then agent_name else null end,
    nullif(row_data ->> 'revision', '')::bigint,
    row_data - array['body_markdown', 'statement_markdown', 'rationale_markdown', 'note_markdown']
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.enforce_dependency_same_objective()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_objective_id uuid;
  target_objective_id uuid;
begin
  select strategy.objective_id into source_objective_id
  from public.steps as step
  join public.strategies as strategy on strategy.id = step.strategy_id
  where step.id = new.step_id
    and step.workspace_id = new.workspace_id;

  select strategy.objective_id into target_objective_id
  from public.steps as step
  join public.strategies as strategy on strategy.id = step.strategy_id
  where step.id = new.depends_on_step_id
    and step.workspace_id = new.workspace_id;

  if source_objective_id is null or target_objective_id is null then
    raise exception 'LEMMA_DEPENDENCY_STEP_NOT_FOUND' using errcode = 'P0002';
  end if;

  if source_objective_id <> target_objective_id then
    raise exception 'LEMMA_DEPENDENCY_OBJECTIVES_MUST_MATCH' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger b_step_dependencies_same_objective
before insert or update on public.step_dependencies
for each row execute function private.enforce_dependency_same_objective();

create or replace function private.enforce_step_source_context_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  context_objective_id uuid;
  step_objective_id uuid;
begin
  select context_item.objective_id into context_objective_id
  from public.sources as source
  left join public.context_items as context_item
    on context_item.id = source.context_item_id
    and context_item.workspace_id = source.workspace_id
  where source.id = new.source_id
    and source.workspace_id = new.workspace_id;

  if not found then
    raise exception 'LEMMA_SOURCE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- General workspace context is intentionally reusable. A source pointing to
  -- specific context is not: it would otherwise leak one objective's premise
  -- into a different board through a source relation.
  if context_objective_id is not null then
    select strategy.objective_id into step_objective_id
    from public.steps as step
    join public.strategies as strategy on strategy.id = step.strategy_id
    where step.id = new.step_id
      and step.workspace_id = new.workspace_id;

    if step_objective_id is null then
      raise exception 'LEMMA_STEP_NOT_FOUND' using errcode = 'P0002';
    end if;
    if step_objective_id <> context_objective_id then
      raise exception 'LEMMA_STEP_SOURCE_CONTEXT_OBJECTIVES_MUST_MATCH'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger a_step_sources_context_scope
before insert or update on public.step_sources
for each row execute function private.enforce_step_source_context_scope();

revoke execute on function private.resolve_activity_objective_id(text, jsonb)
  from public, anon, authenticated;
revoke execute on function private.enforce_dependency_same_objective()
  from public, anon, authenticated;
revoke execute on function private.enforce_step_source_context_scope()
  from public, anon, authenticated;

create or replace function private.stamp_reasoning_result_author()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_kind text;
  agent_name text;
  caller_id uuid;
begin
  caller_id := (select auth.uid());
  if caller_id is null then
    raise exception 'LEMMA_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  actor_kind := nullif(current_setting('lemma.actor_type', true), '');
  agent_name := nullif(btrim(current_setting('lemma.actor_agent_name', true)), '');
  if actor_kind is null then
    actor_kind := 'human';
  end if;

  if actor_kind not in ('human', 'agent') then
    raise exception 'LEMMA_INVALID_ACTOR_TYPE' using errcode = '22023';
  end if;
  if actor_kind = 'agent' and agent_name is null then
    raise exception 'LEMMA_AGENT_NAME_REQUIRED' using errcode = '22023';
  end if;

  new.author_type := actor_kind;
  new.author_user_id := caller_id;
  new.author_agent_name := case when actor_kind = 'agent' then agent_name else null end;
  return new;
end;
$$;

create or replace function private.enforce_reasoning_result_target()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_target_revision bigint;
begin
  if new.branch_id is null then
    select strategy.revision into current_target_revision
    from public.strategies as strategy
    where strategy.id = new.strategy_id
      and strategy.objective_id = new.objective_id
      and strategy.workspace_id = new.workspace_id
    for key share;
  else
    select branch.revision into current_target_revision
    from public.branches as branch
    where branch.id = new.branch_id
      and branch.strategy_id = new.strategy_id
      and branch.workspace_id = new.workspace_id
    for key share;
  end if;

  if current_target_revision is null then
    raise exception 'LEMMA_REASONING_RESULT_TARGET_NOT_FOUND' using errcode = 'P0002';
  end if;

  if new.target_revision <> current_target_revision then
    raise exception 'LEMMA_REASONING_RESULT_TARGET_REVISION_CONFLICT: target is at revision %',
      current_target_revision using errcode = '40001';
  end if;

  return new;
end;
$$;

create or replace function private.record_reasoning_result_activity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_kind text;
  agent_name text;
begin
  actor_kind := nullif(current_setting('lemma.actor_type', true), '');
  if actor_kind not in ('human', 'agent', 'system') then
    actor_kind := case when (select auth.uid()) is null then 'system' else 'human' end;
  end if;
  agent_name := nullif(current_setting('lemma.actor_agent_name', true), '');

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
    new.workspace_id,
    new.objective_id,
    'reasoning_result',
    new.id,
    lower(tg_op),
    actor_kind,
    (select auth.uid()),
    case when actor_kind = 'agent' then agent_name else null end,
    new.revision,
    jsonb_build_object(
      'target_type', new.target_type,
      'target_id', new.target_id,
      'target_revision', new.target_revision,
      'outcome_status', new.outcome_status
    )
  );

  return new;
end;
$$;

create trigger a_reasoning_results_actor
before insert or update on public.reasoning_results
for each row execute function private.stamp_reasoning_result_author();
create trigger b_reasoning_results_immutable
before update on public.reasoning_results
for each row execute function private.prevent_column_changes(
  'id', 'workspace_id', 'objective_id', 'strategy_id', 'branch_id', 'created_at'
);
create trigger c_reasoning_results_target
before insert or update on public.reasoning_results
for each row execute function private.enforce_reasoning_result_target();
create trigger d_reasoning_results_revision
before update on public.reasoning_results
for each row execute function private.enforce_revision_bump();
create trigger z_reasoning_results_activity
after insert or update on public.reasoning_results
for each row execute function private.record_reasoning_result_activity_event();

alter table public.objectives enable row level security;
alter table public.reasoning_results enable row level security;

create policy objectives_select_owner on public.objectives
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));
create policy objectives_insert_owner on public.objectives
for insert to authenticated
with check ((select private.is_workspace_owner(workspace_id)));
create policy objectives_update_owner on public.objectives
for update to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

create policy reasoning_results_select_owner on public.reasoning_results
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));
create policy reasoning_results_insert_owner on public.reasoning_results
for insert to authenticated
with check ((select private.is_workspace_owner(workspace_id)));
create policy reasoning_results_update_owner on public.reasoning_results
for update to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

revoke all on table public.objectives, public.reasoning_results from anon, authenticated;
grant select, insert, update on table public.objectives, public.reasoning_results to authenticated;

revoke execute on function private.stamp_reasoning_result_author()
  from public, anon, authenticated;
revoke execute on function private.enforce_reasoning_result_target()
  from public, anon, authenticated;
revoke execute on function private.record_reasoning_result_activity_event()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Transactional workspace, objective, strategy, and result mutations
-- ---------------------------------------------------------------------------

create function public.create_workspace(
  p_title text,
  p_idempotency_key text,
  p_author_type text default 'human',
  p_author_agent_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid;
  was_claimed boolean := false;
  cached jsonb;
  workspace_row public.workspaces%rowtype;
  result jsonb;
begin
  caller_id := (select auth.uid());
  if caller_id is null then
    raise exception 'LEMMA_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null
    or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'LEMMA_INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;

  insert into private.workspace_creation_receipts (owner_id, idempotency_key)
  values (caller_id, p_idempotency_key)
  on conflict (owner_id, idempotency_key) do nothing
  returning true into was_claimed;

  if not coalesce(was_claimed, false) then
    select receipt.response into cached
    from private.workspace_creation_receipts as receipt
    where receipt.owner_id = caller_id
      and receipt.idempotency_key = p_idempotency_key;

    if cached is null then
      raise exception 'LEMMA_MUTATION_INCOMPLETE' using errcode = '40001';
    end if;
    return cached;
  end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  insert into public.workspaces (owner_id, title)
  values (caller_id, p_title)
  returning * into workspace_row;

  result := jsonb_build_object(
    'workspace_id', workspace_row.id,
    'workspace_revision', workspace_row.revision
  );

  update private.workspace_creation_receipts
  set workspace_id = workspace_row.id,
      response = result
  where owner_id = caller_id
    and idempotency_key = p_idempotency_key;

  return result;
end;
$$;

create function public.update_workspace(
  p_workspace_id uuid,
  p_expected_revision bigint,
  p_title text,
  p_status text,
  p_idempotency_key text,
  p_author_type text default 'human',
  p_author_agent_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  initial_workspace public.workspaces%rowtype;
  workspace_row public.workspaces%rowtype;
  is_new boolean;
  cached jsonb;
  result jsonb;
begin
  if p_expected_revision is null or p_expected_revision <= 0 then
    raise exception 'LEMMA_INVALID_EXPECTED_REVISION' using errcode = '22023';
  end if;
  if p_title is null and p_status is null then
    raise exception 'LEMMA_WORKSPACE_UPDATE_EMPTY' using errcode = '22023';
  end if;

  select * into initial_workspace
  from public.workspaces as workspace
  where workspace.id = p_workspace_id;
  if not found then
    raise exception 'LEMMA_WORKSPACE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select claimed, cached_response into is_new, cached
  from private.claim_mutation(p_workspace_id, p_idempotency_key, 'update_workspace');
  if not is_new then
    return cached;
  end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  select * into workspace_row
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;
  if not found then
    raise exception 'LEMMA_WORKSPACE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if workspace_row.revision <> p_expected_revision then
    raise exception 'LEMMA_REVISION_CONFLICT: workspace is at revision %', workspace_row.revision
      using errcode = '40001';
  end if;

  update public.workspaces
  set title = coalesce(p_title, title),
      status = coalesce(p_status, status),
      revision = revision + 1
  where id = workspace_row.id
  returning * into workspace_row;

  result := jsonb_build_object(
    'workspace_id', workspace_row.id,
    'workspace_revision', workspace_row.revision,
    'status', workspace_row.status
  );
  perform private.finish_mutation(
    workspace_row.id, p_idempotency_key, workspace_row.id, result
  );
  return result;
end;
$$;

create function public.create_objective(
  p_workspace_id uuid,
  p_title text,
  p_objective_markdown text,
  p_constraints_markdown text,
  p_idempotency_key text,
  p_author_type text default 'human',
  p_author_agent_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  is_new boolean;
  cached jsonb;
  objective_row public.objectives%rowtype;
  result jsonb;
begin
  select claimed, cached_response into is_new, cached
  from private.claim_mutation(p_workspace_id, p_idempotency_key, 'create_objective');
  if not is_new then
    return cached;
  end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  insert into public.objectives (
    workspace_id,
    title,
    objective_markdown,
    constraints_markdown,
    author_type,
    author_user_id,
    author_agent_name
  ) values (
    p_workspace_id,
    p_title,
    p_objective_markdown,
    coalesce(p_constraints_markdown, ''),
    p_author_type,
    (select auth.uid()),
    p_author_agent_name
  ) returning * into objective_row;

  result := jsonb_build_object(
    'objective_id', objective_row.id,
    'objective_revision', objective_row.revision,
    'workspace_id', objective_row.workspace_id
  );
  perform private.finish_mutation(
    objective_row.workspace_id, p_idempotency_key, objective_row.id, result
  );
  return result;
end;
$$;

create function public.update_objective(
  p_workspace_id uuid,
  p_objective_id uuid,
  p_expected_revision bigint,
  p_idempotency_key text,
  p_title text default null,
  p_objective_markdown text default null,
  p_constraints_markdown text default null,
  p_status text default null,
  p_author_type text default 'human',
  p_author_agent_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  initial_objective public.objectives%rowtype;
  objective_row public.objectives%rowtype;
  is_new boolean;
  cached jsonb;
  result jsonb;
begin
  if p_expected_revision is null or p_expected_revision <= 0 then
    raise exception 'LEMMA_INVALID_EXPECTED_REVISION' using errcode = '22023';
  end if;
  if p_title is null
    and p_objective_markdown is null
    and p_constraints_markdown is null
    and p_status is null then
    raise exception 'LEMMA_OBJECTIVE_UPDATE_EMPTY' using errcode = '22023';
  end if;

  select * into initial_objective
  from public.objectives as objective
  where objective.id = p_objective_id
    and objective.workspace_id = p_workspace_id;
  if not found then
    raise exception 'LEMMA_OBJECTIVE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select claimed, cached_response into is_new, cached
  from private.claim_mutation(
    p_workspace_id, p_idempotency_key, 'update_objective'
  );
  if not is_new then
    return cached;
  end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  select * into objective_row
  from public.objectives as objective
  where objective.id = p_objective_id
    and objective.workspace_id = p_workspace_id
  for update;
  if not found then
    raise exception 'LEMMA_OBJECTIVE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if objective_row.revision <> p_expected_revision then
    raise exception 'LEMMA_REVISION_CONFLICT: objective is at revision %', objective_row.revision
      using errcode = '40001';
  end if;

  update public.objectives
  set title = coalesce(p_title, title),
      objective_markdown = coalesce(p_objective_markdown, objective_markdown),
      constraints_markdown = coalesce(p_constraints_markdown, constraints_markdown),
      status = coalesce(p_status, status),
      revision = revision + 1
  where id = objective_row.id
  returning * into objective_row;

  result := jsonb_build_object(
    'objective_id', objective_row.id,
    'objective_revision', objective_row.revision,
    'workspace_id', objective_row.workspace_id,
    'status', objective_row.status
  );
  perform private.finish_mutation(
    p_workspace_id, p_idempotency_key, objective_row.id, result
  );
  return result;
end;
$$;

create function public.create_context_item(
  p_workspace_id uuid,
  p_objective_id uuid,
  p_scope text,
  p_kind text,
  p_title text,
  p_idempotency_key text,
  p_context_id uuid default null,
  p_body_markdown text default null,
  p_source_url text default null,
  p_storage_bucket text default null,
  p_storage_path text default null,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_metadata jsonb default '{}'::jsonb,
  p_processing_status text default 'ready',
  p_author_type text default 'human',
  p_author_agent_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  is_new boolean;
  cached jsonb;
  context_row public.context_items%rowtype;
  result jsonb;
begin
  if p_scope is null or p_scope not in ('workspace', 'objective') then
    raise exception 'LEMMA_INVALID_CONTEXT_SCOPE' using errcode = '22023';
  end if;
  if (p_scope = 'workspace' and p_objective_id is not null)
    or (p_scope = 'objective' and p_objective_id is null) then
    raise exception 'LEMMA_CONTEXT_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  if p_kind is null or p_kind not in ('text', 'note', 'image', 'pdf', 'paper', 'link') then
    raise exception 'LEMMA_INVALID_CONTEXT_KIND' using errcode = '22023';
  end if;
  if p_processing_status is null
    or p_processing_status not in ('pending', 'ready', 'failed') then
    raise exception 'LEMMA_INVALID_CONTEXT_PROCESSING_STATUS' using errcode = '22023';
  end if;
  if (p_storage_bucket is null) <> (p_storage_path is null) then
    raise exception 'LEMMA_CONTEXT_STORAGE_PAIR_REQUIRED' using errcode = '23514';
  end if;
  if p_size_bytes is not null and p_size_bytes < 0 then
    raise exception 'LEMMA_CONTEXT_SIZE_INVALID' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'LEMMA_CONTEXT_METADATA_OBJECT_REQUIRED' using errcode = '22023';
  end if;

  if p_kind in ('text', 'note')
    and nullif(btrim(p_body_markdown), '') is null then
    raise exception 'LEMMA_CONTEXT_BODY_REQUIRED' using errcode = '23514';
  end if;
  if p_kind in ('link', 'paper') and nullif(btrim(p_source_url), '') is null then
    raise exception 'LEMMA_CONTEXT_SOURCE_URL_REQUIRED' using errcode = '23514';
  end if;
  if p_kind in ('image', 'pdf')
    and (
      nullif(btrim(p_storage_bucket), '') is null
      or nullif(btrim(p_storage_path), '') is null
      or nullif(btrim(p_mime_type), '') is null
      or p_size_bytes is null
    ) then
    raise exception 'LEMMA_CONTEXT_UPLOAD_METADATA_REQUIRED' using errcode = '23514';
  end if;

  if p_objective_id is not null then
    perform 1
    from public.objectives as objective
    where objective.id = p_objective_id
      and objective.workspace_id = p_workspace_id;
    if not found then
      raise exception 'LEMMA_OBJECTIVE_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  select claimed, cached_response into is_new, cached
  from private.claim_mutation(
    p_workspace_id, p_idempotency_key, 'create_context_item'
  );
  if not is_new then
    return cached;
  end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  insert into public.context_items (
    id,
    workspace_id,
    objective_id,
    kind,
    title,
    body_markdown,
    source_url,
    storage_bucket,
    storage_path,
    mime_type,
    size_bytes,
    processing_status,
    metadata,
    author_type,
    author_user_id,
    author_agent_name
  ) values (
    coalesce(p_context_id, gen_random_uuid()),
    p_workspace_id,
    p_objective_id,
    p_kind,
    p_title,
    p_body_markdown,
    p_source_url,
    p_storage_bucket,
    p_storage_path,
    p_mime_type,
    p_size_bytes,
    p_processing_status,
    coalesce(p_metadata, '{}'::jsonb),
    p_author_type,
    (select auth.uid()),
    p_author_agent_name
  ) returning * into context_row;

  result := to_jsonb(context_row);
  perform private.finish_mutation(
    p_workspace_id, p_idempotency_key, context_row.id, result
  );
  return result;
end;
$$;

drop function public.create_strategy(uuid, text, text, text, text, text, text);

create function public.create_strategy(
  p_workspace_id uuid,
  p_objective_id uuid,
  p_title text,
  p_idempotency_key text,
  p_description_markdown text default '',
  p_root_branch_name text default 'Main',
  p_author_type text default 'human',
  p_author_agent_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  initial_objective public.objectives%rowtype;
  objective_row public.objectives%rowtype;
  is_new boolean;
  cached jsonb;
  strategy_uuid uuid;
  branch_uuid uuid;
  result jsonb;
begin
  select * into initial_objective
  from public.objectives as objective
  where objective.id = p_objective_id
    and objective.workspace_id = p_workspace_id;
  if not found then
    raise exception 'LEMMA_OBJECTIVE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select claimed, cached_response into is_new, cached
  from private.claim_mutation(
    p_workspace_id, p_idempotency_key, 'create_strategy'
  );
  if not is_new then
    return cached;
  end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  select * into objective_row
  from public.objectives as objective
  where objective.id = p_objective_id
    and objective.workspace_id = p_workspace_id
  for key share;
  if not found then
    raise exception 'LEMMA_OBJECTIVE_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.strategies (
    workspace_id,
    objective_id,
    title,
    description_markdown,
    author_type,
    author_user_id,
    author_agent_name
  ) values (
    objective_row.workspace_id,
    objective_row.id,
    p_title,
    coalesce(p_description_markdown, ''),
    p_author_type,
    (select auth.uid()),
    p_author_agent_name
  ) returning id into strategy_uuid;

  insert into public.branches (
    workspace_id,
    strategy_id,
    name,
    author_type,
    author_user_id,
    author_agent_name
  ) values (
    objective_row.workspace_id,
    strategy_uuid,
    p_root_branch_name,
    p_author_type,
    (select auth.uid()),
    p_author_agent_name
  ) returning id into branch_uuid;

  result := jsonb_build_object(
    'workspace_id', objective_row.workspace_id,
    'objective_id', objective_row.id,
    'strategy_id', strategy_uuid,
    'strategy_revision', 1,
    'root_branch_id', branch_uuid,
    'root_branch_revision', 1
  );
  perform private.finish_mutation(
    p_workspace_id, p_idempotency_key, strategy_uuid, result
  );
  return result;
end;
$$;

create or replace function public.mark_branch_completed(
  p_branch_id uuid,
  p_expected_branch_revision bigint,
  p_expected_strategy_revision bigint,
  p_idempotency_key text,
  p_author_type text default 'human',
  p_author_agent_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  initial_branch public.branches%rowtype;
  branch_row public.branches%rowtype;
  strategy_row public.strategies%rowtype;
  is_new boolean;
  cached jsonb;
  result jsonb;
begin
  if p_expected_branch_revision is null or p_expected_branch_revision <= 0
    or p_expected_strategy_revision is null or p_expected_strategy_revision <= 0 then
    raise exception 'LEMMA_INVALID_EXPECTED_REVISION' using errcode = '22023';
  end if;

  select * into initial_branch
  from public.branches as branch
  where branch.id = p_branch_id;
  if not found then
    raise exception 'LEMMA_BRANCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  select claimed, cached_response into is_new, cached
  from private.claim_mutation(
    initial_branch.workspace_id, p_idempotency_key, 'mark_branch_completed'
  );
  if not is_new then
    return cached;
  end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  -- Keep the same lock order as the pre-objective completion mutation.
  select * into strategy_row
  from public.strategies as strategy
  where strategy.id = initial_branch.strategy_id
    and strategy.workspace_id = initial_branch.workspace_id
  for update;
  if not found then
    raise exception 'LEMMA_STRATEGY_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into branch_row
  from public.branches as branch
  where branch.id = p_branch_id
    and branch.strategy_id = strategy_row.id
    and branch.workspace_id = strategy_row.workspace_id
  for update;
  if not found then
    raise exception 'LEMMA_BRANCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  if branch_row.revision <> p_expected_branch_revision then
    raise exception 'LEMMA_REVISION_CONFLICT: branch is at revision %', branch_row.revision
      using errcode = '40001';
  end if;
  if strategy_row.revision <> p_expected_strategy_revision then
    raise exception 'LEMMA_REVISION_CONFLICT: strategy is at revision %', strategy_row.revision
      using errcode = '40001';
  end if;
  if branch_row.status <> 'active' then
    raise exception 'LEMMA_BRANCH_NOT_ACTIVE' using errcode = '23514';
  end if;
  if strategy_row.status = 'abandoned' then
    raise exception 'LEMMA_STRATEGY_ABANDONED' using errcode = '23514';
  end if;

  update public.branches
  set status = 'completed', revision = revision + 1
  where id = branch_row.id
  returning * into branch_row;

  update public.strategies
  set status = 'completed', revision = revision + 1
  where id = strategy_row.id
  returning * into strategy_row;

  result := jsonb_build_object(
    'workspace_id', branch_row.workspace_id,
    'objective_id', strategy_row.objective_id,
    'strategy_id', strategy_row.id,
    'strategy_status', strategy_row.status,
    'strategy_revision', strategy_row.revision,
    'branch_id', branch_row.id,
    'branch_status', branch_row.status,
    'branch_revision', branch_row.revision
  );
  perform private.finish_mutation(
    branch_row.workspace_id, p_idempotency_key, branch_row.id, result
  );
  return result;
end;
$$;

create function public.set_reasoning_result(
  p_workspace_id uuid,
  p_objective_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_expected_target_revision bigint,
  p_expected_result_revision bigint,
  p_result_markdown text,
  p_outcome_status text,
  p_idempotency_key text,
  p_author_type text default 'human',
  p_author_agent_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  initial_strategy public.strategies%rowtype;
  strategy_row public.strategies%rowtype;
  branch_row public.branches%rowtype;
  result_row public.reasoning_results%rowtype;
  is_new boolean;
  cached jsonb;
  result jsonb;
begin
  if p_target_type not in ('strategy', 'branch') then
    raise exception 'LEMMA_INVALID_REASONING_RESULT_TARGET_TYPE' using errcode = '22023';
  end if;
  if p_expected_target_revision is null or p_expected_target_revision <= 0 then
    raise exception 'LEMMA_INVALID_EXPECTED_TARGET_REVISION' using errcode = '22023';
  end if;
  if p_expected_result_revision is not null and p_expected_result_revision <= 0 then
    raise exception 'LEMMA_INVALID_EXPECTED_RESULT_REVISION' using errcode = '22023';
  end if;
  if nullif(btrim(p_result_markdown), '') is null
    or char_length(btrim(p_result_markdown)) > 100000 then
    raise exception 'LEMMA_INVALID_REASONING_RESULT' using errcode = '22023';
  end if;
  if p_outcome_status not in ('successful', 'unsuccessful', 'inconclusive') then
    raise exception 'LEMMA_INVALID_REASONING_OUTCOME_STATUS' using errcode = '22023';
  end if;

  if p_target_type = 'strategy' then
    select * into initial_strategy
    from public.strategies as strategy
    where strategy.id = p_target_id;
    if not found then
      raise exception 'LEMMA_STRATEGY_NOT_FOUND' using errcode = 'P0002';
    end if;
  else
    select * into branch_row
    from public.branches as branch
    where branch.id = p_target_id;
    if not found then
      raise exception 'LEMMA_BRANCH_NOT_FOUND' using errcode = 'P0002';
    end if;

    select * into initial_strategy
    from public.strategies as strategy
    where strategy.id = branch_row.strategy_id
      and strategy.workspace_id = branch_row.workspace_id;
    if not found then
      raise exception 'LEMMA_STRATEGY_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  if initial_strategy.workspace_id <> p_workspace_id
    or initial_strategy.objective_id <> p_objective_id then
    raise exception 'LEMMA_REASONING_RESULT_TARGET_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  select claimed, cached_response into is_new, cached
  from private.claim_mutation(
    initial_strategy.workspace_id, p_idempotency_key, 'set_reasoning_result'
  );
  if not is_new then
    return cached;
  end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  -- Lock order is strategy then branch then result for every target mutation.
  select * into strategy_row
  from public.strategies as strategy
  where strategy.id = initial_strategy.id
    and strategy.objective_id = initial_strategy.objective_id
    and strategy.workspace_id = initial_strategy.workspace_id
  for update;
  if not found then
    raise exception 'LEMMA_STRATEGY_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_target_type = 'branch' then
    select * into branch_row
    from public.branches as branch
    where branch.id = p_target_id
      and branch.strategy_id = strategy_row.id
      and branch.workspace_id = strategy_row.workspace_id
    for update;
    if not found then
      raise exception 'LEMMA_BRANCH_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  if p_target_type = 'strategy'
    and strategy_row.revision <> p_expected_target_revision then
    raise exception 'LEMMA_REVISION_CONFLICT: strategy is at revision %', strategy_row.revision
      using errcode = '40001';
  end if;
  if p_target_type = 'branch'
    and branch_row.revision <> p_expected_target_revision then
    raise exception 'LEMMA_REVISION_CONFLICT: branch is at revision %', branch_row.revision
      using errcode = '40001';
  end if;

  if p_target_type = 'strategy' then
    select * into result_row
    from public.reasoning_results as reasoning_result
    where reasoning_result.strategy_id = strategy_row.id
      and reasoning_result.branch_id is null
    for update;
  else
    select * into result_row
    from public.reasoning_results as reasoning_result
    where reasoning_result.branch_id = branch_row.id
    for update;
  end if;

  if p_expected_result_revision is null then
    if found then
      raise exception 'LEMMA_REASONING_RESULT_ALREADY_EXISTS' using errcode = '40001';
    end if;

    insert into public.reasoning_results (
      workspace_id,
      objective_id,
      strategy_id,
      branch_id,
      target_revision,
      outcome_status,
      result_markdown,
      author_type,
      author_user_id,
      author_agent_name
    ) values (
      strategy_row.workspace_id,
      strategy_row.objective_id,
      strategy_row.id,
      case when p_target_type = 'branch' then branch_row.id else null end,
      p_expected_target_revision,
      p_outcome_status,
      btrim(p_result_markdown),
      p_author_type,
      (select auth.uid()),
      p_author_agent_name
    ) returning * into result_row;
  else
    if not found then
      raise exception 'LEMMA_REASONING_RESULT_NOT_FOUND' using errcode = '40001';
    end if;
    if result_row.revision <> p_expected_result_revision then
      raise exception 'LEMMA_REVISION_CONFLICT: reasoning result is at revision %', result_row.revision
        using errcode = '40001';
    end if;

    update public.reasoning_results
    set target_revision = p_expected_target_revision,
        outcome_status = p_outcome_status,
        result_markdown = btrim(p_result_markdown),
        revision = revision + 1
    where id = result_row.id
    returning * into result_row;
  end if;

  result := to_jsonb(result_row);
  perform private.finish_mutation(
    strategy_row.workspace_id, p_idempotency_key, result_row.id, result
  );
  return result;
end;
$$;

drop function public.request_human_decision(
  uuid, text, text, uuid, uuid, uuid, text, text, text
);

create function public.request_human_decision(
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
    return cached;
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

  result := jsonb_build_object(
    'decision_id', decision_uuid,
    'decision_revision', 1,
    'status', 'pending',
    'workspace_id', p_workspace_id,
    'objective_id', p_objective_id
  );
  perform private.finish_mutation(
    p_workspace_id, p_idempotency_key, decision_uuid, result
  );
  return result;
end;
$$;

-- Retrieval remains intentionally workspace-wide unless an objective is
-- explicitly selected. The derived search document and its embeddings are not
-- rewritten: objective membership is obtained from the strategy join.
drop function public.find_steps(
  uuid, text, extensions.vector, uuid, uuid, text, integer, double precision, double precision, integer
);

create function public.find_steps(
  p_workspace_id uuid,
  p_query_text text,
  p_query_embedding extensions.vector(1536) default null,
  p_objective_id uuid default null,
  p_strategy_id uuid default null,
  p_branch_id uuid default null,
  p_status text default null,
  p_top_k integer default 10,
  p_full_text_weight double precision default 1,
  p_semantic_weight double precision default 1,
  p_rrf_k integer default 50
)
returns table (
  step_id uuid,
  workspace_id uuid,
  objective_id uuid,
  objective_title text,
  strategy_id uuid,
  strategy_title text,
  branch_id uuid,
  title text,
  snippet text,
  status text,
  step_revision bigint,
  full_text_rank bigint,
  semantic_rank bigint,
  combined_score double precision
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  scoped_strategy_objective_id uuid;
  scoped_branch_workspace_id uuid;
  scoped_branch_strategy_id uuid;
  scoped_branch_objective_id uuid;
begin
  if not exists (
    select 1 from public.workspaces as workspace where workspace.id = p_workspace_id
  ) then
    raise exception 'LEMMA_WORKSPACE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_objective_id is not null and not exists (
    select 1
    from public.objectives as objective
    where objective.id = p_objective_id
      and objective.workspace_id = p_workspace_id
  ) then
    raise exception 'LEMMA_OBJECTIVE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_strategy_id is not null then
    select strategy.objective_id into scoped_strategy_objective_id
    from public.strategies as strategy
    where strategy.id = p_strategy_id
      and strategy.workspace_id = p_workspace_id;
    if scoped_strategy_objective_id is null then
      raise exception 'LEMMA_STRATEGY_NOT_FOUND' using errcode = 'P0002';
    end if;
    if p_objective_id is not null
      and scoped_strategy_objective_id <> p_objective_id then
      raise exception 'LEMMA_STRATEGY_MUST_SHARE_OBJECTIVE' using errcode = '23514';
    end if;
  end if;

  if p_branch_id is not null then
    select
      branch.workspace_id,
      branch.strategy_id,
      strategy.objective_id
    into
      scoped_branch_workspace_id,
      scoped_branch_strategy_id,
      scoped_branch_objective_id
    from public.branches as branch
    join public.strategies as strategy on strategy.id = branch.strategy_id
    where branch.id = p_branch_id;

    if scoped_branch_workspace_id is null
      or scoped_branch_workspace_id <> p_workspace_id then
      raise exception 'LEMMA_BRANCH_NOT_FOUND' using errcode = 'P0002';
    end if;
    if p_objective_id is not null
      and scoped_branch_objective_id <> p_objective_id then
      raise exception 'LEMMA_BRANCH_MUST_SHARE_OBJECTIVE' using errcode = '23514';
    end if;
    if p_strategy_id is not null
      and scoped_branch_strategy_id <> p_strategy_id then
      raise exception 'LEMMA_BRANCH_MUST_SHARE_STRATEGY' using errcode = '23514';
    end if;
  end if;

  return query
  with settings as (
    select
      websearch_to_tsquery('simple', p_query_text) as text_query,
      least(greatest(p_top_k, 1), 20) as result_limit,
      least(greatest(p_top_k, 1), 20) * 3 as candidate_limit
  ),
  scoped as (
    select
      document.*,
      strategy.objective_id,
      objective.title as objective_title,
      strategy.title as strategy_title
    from private.step_search_documents as document
    join public.strategies as strategy
      on strategy.id = document.strategy_id
      and strategy.workspace_id = document.workspace_id
    join public.objectives as objective
      on objective.id = strategy.objective_id
      and objective.workspace_id = strategy.workspace_id
    where document.workspace_id = p_workspace_id
      and (p_objective_id is null or strategy.objective_id = p_objective_id)
      and (p_strategy_id is null or document.strategy_id = p_strategy_id)
      and (p_status is null or document.status = p_status)
      and (
        p_branch_id is null
        or document.step_id in (
          select branch_step.step_id
          from public.get_branch_path(p_branch_id) as branch_step
        )
      )
  ),
  full_text as (
    select
      scoped.step_id,
      row_number() over (
        order by ts_rank_cd(scoped.search_vector, settings.text_query) desc, scoped.step_id
      ) as rank_position
    from scoped
    cross join settings
    where nullif(btrim(p_query_text), '') is not null
      and scoped.search_vector @@ settings.text_query
    order by rank_position
    limit (select candidate_limit from settings)
  ),
  semantic as (
    select
      scoped.step_id,
      row_number() over (
        order by scoped.embedding operator(extensions.<=>) p_query_embedding, scoped.step_id
      ) as rank_position
    from scoped
    cross join settings
    where p_query_embedding is not null
      and scoped.embedding is not null
    order by rank_position
    limit (select candidate_limit from settings)
  ),
  fused as (
    select
      coalesce(full_text.step_id, semantic.step_id) as step_id,
      full_text.rank_position as full_text_rank,
      semantic.rank_position as semantic_rank,
      coalesce(
        greatest(p_full_text_weight, 0) /
          (greatest(p_rrf_k, 1) + full_text.rank_position),
        0
      ) + coalesce(
        greatest(p_semantic_weight, 0) /
          (greatest(p_rrf_k, 1) + semantic.rank_position),
        0
      ) as score
    from full_text
    full join semantic on semantic.step_id = full_text.step_id
  )
  select
    document.step_id,
    document.workspace_id,
    document.objective_id,
    document.objective_title,
    document.strategy_id,
    document.strategy_title,
    document.branch_id,
    document.title,
    left(document.search_text, 500),
    document.status,
    document.step_revision,
    fused.full_text_rank,
    fused.semantic_rank,
    fused.score
  from fused
  join scoped as document on document.step_id = fused.step_id
  order by fused.score desc, document.step_id
  limit (select result_limit from settings);
end;
$$;

create or replace function public.compare_branches(
  p_branch_a_id uuid,
  p_branch_b_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  branch_a public.branches%rowtype;
  branch_b public.branches%rowtype;
  objective_a_id uuid;
  objective_b_id uuid;
  result jsonb;
begin
  select * into branch_a from public.branches where id = p_branch_a_id;
  select * into branch_b from public.branches where id = p_branch_b_id;

  if branch_a.id is null or branch_b.id is null then
    raise exception 'LEMMA_BRANCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if branch_a.workspace_id <> branch_b.workspace_id then
    raise exception 'LEMMA_BRANCHES_MUST_SHARE_WORKSPACE' using errcode = '23514';
  end if;

  select strategy.objective_id into objective_a_id
  from public.strategies as strategy
  where strategy.id = branch_a.strategy_id
    and strategy.workspace_id = branch_a.workspace_id;
  select strategy.objective_id into objective_b_id
  from public.strategies as strategy
  where strategy.id = branch_b.strategy_id
    and strategy.workspace_id = branch_b.workspace_id;
  if objective_a_id is null or objective_b_id is null then
    raise exception 'LEMMA_STRATEGY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if objective_a_id <> objective_b_id then
    raise exception 'LEMMA_BRANCHES_MUST_SHARE_OBJECTIVE' using errcode = '23514';
  end if;

  with path_a as (
    select * from public.get_branch_path(p_branch_a_id)
  ),
  path_b as (
    select * from public.get_branch_path(p_branch_b_id)
  )
  select jsonb_build_object(
    'objective_id', objective_a_id,
    'branch_a', jsonb_build_object(
      'id', branch_a.id,
      'name', branch_a.name,
      'strategy_id', branch_a.strategy_id,
      'revision', branch_a.revision
    ),
    'branch_b', jsonb_build_object(
      'id', branch_b.id,
      'name', branch_b.name,
      'strategy_id', branch_b.strategy_id,
      'revision', branch_b.revision
    ),
    'common_steps', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'step_id', path_a.step_id,
          'title', path_a.title,
          'status', path_a.status
        ) order by path_a.path_position
      )
      from path_a
      join path_b using (step_id)
    ), '[]'::jsonb),
    'only_branch_a', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'step_id', path_a.step_id,
          'title', path_a.title,
          'status', path_a.status
        ) order by path_a.path_position
      )
      from path_a
      where not exists (select 1 from path_b where path_b.step_id = path_a.step_id)
    ), '[]'::jsonb),
    'only_branch_b', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'step_id', path_b.step_id,
          'title', path_b.title,
          'status', path_b.status
        ) order by path_b.path_position
      )
      from path_b
      where not exists (select 1 from path_a where path_a.step_id = path_b.step_id)
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.generate_clean_solution(p_branch_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  branch_row public.branches%rowtype;
  strategy_row public.strategies%rowtype;
  objective_row public.objectives%rowtype;
  workspace_row public.workspaces%rowtype;
  steps_markdown text;
  active_step_count integer;
begin
  select * into branch_row from public.branches where id = p_branch_id;
  if not found then
    raise exception 'LEMMA_BRANCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into strategy_row
  from public.strategies as strategy
  where strategy.id = branch_row.strategy_id
    and strategy.workspace_id = branch_row.workspace_id;
  if not found then
    raise exception 'LEMMA_STRATEGY_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into objective_row
  from public.objectives as objective
  where objective.id = strategy_row.objective_id
    and objective.workspace_id = strategy_row.workspace_id;
  if not found then
    raise exception 'LEMMA_OBJECTIVE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into workspace_row
  from public.workspaces as workspace
  where workspace.id = branch_row.workspace_id;

  select
    string_agg(
      format(
        '## %s. %s%s%s',
        path.path_position,
        path.title,
        E'\n\n',
        path.body_markdown
      ),
      E'\n\n'
      order by path.path_position
    ),
    count(*)::integer
  into steps_markdown, active_step_count
  from public.get_branch_path(p_branch_id) as path
  where path.status = 'active';

  return jsonb_build_object(
    'workspace_id', workspace_row.id,
    'objective_id', objective_row.id,
    'objective_revision', objective_row.revision,
    'strategy_id', strategy_row.id,
    'branch_id', branch_row.id,
    'branch_revision', branch_row.revision,
    'step_count', coalesce(active_step_count, 0),
    'body_markdown', concat_ws(
      E'\n\n',
      '# ' || workspace_row.title,
      '**Objective: ' || objective_row.title || '**',
      objective_row.objective_markdown,
      case
        when nullif(objective_row.constraints_markdown, '') is null then null
        else '**Constraints**' || E'\n\n' || objective_row.constraints_markdown
      end,
      '**Strategy: ' || strategy_row.title || '**',
      nullif(strategy_row.description_markdown, ''),
      nullif(steps_markdown, '')
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Objective-aware read models for the browser and WebMCP
-- ---------------------------------------------------------------------------

create function public.list_workspace_summaries()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'workspaces',
    coalesce(
      jsonb_agg(
        to_jsonb(workspace)
        || jsonb_build_object(
          'objective_count', objective_counts.objective_count,
          'active_objective_count', objective_counts.active_objective_count
        )
        order by workspace.updated_at desc, workspace.id
      ),
      '[]'::jsonb
    )
  )
  from public.workspaces as workspace
  left join lateral (
    select
      count(*)::integer as objective_count,
      count(*) filter (where objective.status = 'active')::integer as active_objective_count
    from public.objectives as objective
    where objective.workspace_id = workspace.id
  ) as objective_counts on true;
$$;

create function public.get_workspace_overview(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  workspace_row public.workspaces%rowtype;
  objectives jsonb;
  general_context_items jsonb;
begin
  select * into workspace_row
  from public.workspaces as workspace
  where workspace.id = p_workspace_id;
  if not found then
    raise exception 'LEMMA_WORKSPACE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(
      to_jsonb(objective)
      || jsonb_build_object(
        'strategy_count', counts.strategy_count,
        'branch_count', counts.branch_count,
        'step_count', counts.step_count
      )
      order by objective.created_at, objective.id
    ),
    '[]'::jsonb
  ) into objectives
  from public.objectives as objective
  left join lateral (
    select
      (
        select count(*)::integer
        from public.strategies as strategy
        where strategy.objective_id = objective.id
          and strategy.workspace_id = objective.workspace_id
      ) as strategy_count,
      (
        select count(*)::integer
        from public.branches as branch
        join public.strategies as strategy on strategy.id = branch.strategy_id
        where strategy.objective_id = objective.id
          and branch.workspace_id = objective.workspace_id
      ) as branch_count,
      (
        select count(*)::integer
        from public.steps as step
        join public.strategies as strategy on strategy.id = step.strategy_id
        where strategy.objective_id = objective.id
          and step.workspace_id = objective.workspace_id
      ) as step_count
  ) as counts on true
  where objective.workspace_id = p_workspace_id;

  select coalesce(
    jsonb_agg(to_jsonb(context_item) order by context_item.created_at desc, context_item.id),
    '[]'::jsonb
  ) into general_context_items
  from public.context_items as context_item
  where context_item.workspace_id = p_workspace_id
    and context_item.objective_id is null;

  return jsonb_build_object(
    'workspace', to_jsonb(workspace_row),
    'objectives', objectives,
    'general_context_items', general_context_items
  );
end;
$$;

create function public.get_context(
  p_workspace_id uuid,
  p_objective_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  general_context_items jsonb;
  objective_context_items jsonb;
begin
  if not exists (
    select 1 from public.workspaces as workspace where workspace.id = p_workspace_id
  ) then
    raise exception 'LEMMA_WORKSPACE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_objective_id is not null and not exists (
    select 1
    from public.objectives as objective
    where objective.id = p_objective_id
      and objective.workspace_id = p_workspace_id
  ) then
    raise exception 'LEMMA_OBJECTIVE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(context_item) order by context_item.created_at desc, context_item.id),
    '[]'::jsonb
  ) into general_context_items
  from public.context_items as context_item
  where context_item.workspace_id = p_workspace_id
    and context_item.objective_id is null;

  select coalesce(
    jsonb_agg(to_jsonb(context_item) order by context_item.created_at desc, context_item.id),
    '[]'::jsonb
  ) into objective_context_items
  from public.context_items as context_item
  where context_item.workspace_id = p_workspace_id
    and context_item.objective_id = p_objective_id;

  return jsonb_build_object(
    'workspace_id', p_workspace_id,
    'objective_id', p_objective_id,
    'general_context_items', general_context_items,
    'objective_context_items', objective_context_items,
    'effective_context_items', general_context_items || objective_context_items
  );
end;
$$;

create function public.get_general_context(p_workspace_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'workspace_id', context_payload -> 'workspace_id',
    'context_items', context_payload -> 'general_context_items'
  )
  from (select public.get_context(p_workspace_id) as context_payload) as payload;
$$;

create function public.get_objective_graph(p_objective_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  objective_row public.objectives%rowtype;
  workspace_row public.workspaces%rowtype;
  general_context_items jsonb;
  objective_context_items jsonb;
  strategies jsonb;
  branches jsonb;
  steps jsonb;
  assumptions jsonb;
  decisions jsonb;
  reasoning_results jsonb;
  step_dependencies jsonb;
  activity_events jsonb;
  sources jsonb;
  step_assumptions jsonb;
  step_sources jsonb;
begin
  select * into objective_row
  from public.objectives as objective
  where objective.id = p_objective_id;
  if not found then
    raise exception 'LEMMA_OBJECTIVE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into workspace_row
  from public.workspaces as workspace
  where workspace.id = objective_row.workspace_id;
  if not found then
    raise exception 'LEMMA_WORKSPACE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(context_item) order by context_item.created_at desc, context_item.id),
    '[]'::jsonb
  ) into general_context_items
  from public.context_items as context_item
  where context_item.workspace_id = objective_row.workspace_id
    and context_item.objective_id is null;

  select coalesce(
    jsonb_agg(to_jsonb(context_item) order by context_item.created_at desc, context_item.id),
    '[]'::jsonb
  ) into objective_context_items
  from public.context_items as context_item
  where context_item.workspace_id = objective_row.workspace_id
    and context_item.objective_id = objective_row.id;

  select coalesce(
    jsonb_agg(to_jsonb(strategy) order by strategy.created_at, strategy.id),
    '[]'::jsonb
  ) into strategies
  from public.strategies as strategy
  where strategy.workspace_id = objective_row.workspace_id
    and strategy.objective_id = objective_row.id;

  select coalesce(
    jsonb_agg(to_jsonb(branch) order by branch.created_at, branch.id),
    '[]'::jsonb
  ) into branches
  from public.branches as branch
  join public.strategies as strategy on strategy.id = branch.strategy_id
  where branch.workspace_id = objective_row.workspace_id
    and strategy.objective_id = objective_row.id;

  select coalesce(
    jsonb_agg(to_jsonb(step) order by step.updated_at, step.id),
    '[]'::jsonb
  ) into steps
  from public.steps as step
  join public.strategies as strategy on strategy.id = step.strategy_id
  where step.workspace_id = objective_row.workspace_id
    and strategy.objective_id = objective_row.id;

  select coalesce(
    jsonb_agg(to_jsonb(dependency) order by dependency.created_at, dependency.id),
    '[]'::jsonb
  ) into step_dependencies
  from public.step_dependencies as dependency
  join public.steps as step on step.id = dependency.step_id
  join public.strategies as strategy on strategy.id = step.strategy_id
  where dependency.workspace_id = objective_row.workspace_id
    and strategy.objective_id = objective_row.id;

  select coalesce(
    jsonb_agg(to_jsonb(relation) order by relation.created_at, relation.id),
    '[]'::jsonb
  ) into step_assumptions
  from public.step_assumptions as relation
  join public.steps as step on step.id = relation.step_id
  join public.strategies as strategy on strategy.id = step.strategy_id
  where relation.workspace_id = objective_row.workspace_id
    and strategy.objective_id = objective_row.id;

  select coalesce(
    jsonb_agg(to_jsonb(assumption) order by assumption.created_at, assumption.id),
    '[]'::jsonb
  ) into assumptions
  from public.assumptions as assumption
  where assumption.workspace_id = objective_row.workspace_id
    and exists (
      select 1
      from public.step_assumptions as relation
      join public.steps as step on step.id = relation.step_id
      join public.strategies as strategy on strategy.id = step.strategy_id
      where relation.assumption_id = assumption.id
        and strategy.objective_id = objective_row.id
    );

  select coalesce(
    jsonb_agg(to_jsonb(relation) order by relation.created_at, relation.id),
    '[]'::jsonb
  ) into step_sources
  from public.step_sources as relation
  join public.steps as step on step.id = relation.step_id
  join public.strategies as strategy on strategy.id = step.strategy_id
  where relation.workspace_id = objective_row.workspace_id
    and strategy.objective_id = objective_row.id;

  select coalesce(
    jsonb_agg(to_jsonb(source) order by source.created_at, source.id),
    '[]'::jsonb
  ) into sources
  from public.sources as source
  where source.workspace_id = objective_row.workspace_id
    and exists (
      select 1
      from public.step_sources as relation
      join public.steps as step on step.id = relation.step_id
      join public.strategies as strategy on strategy.id = step.strategy_id
      where relation.source_id = source.id
        and strategy.objective_id = objective_row.id
    );

  select coalesce(
    jsonb_agg(to_jsonb(decision) order by decision.created_at, decision.id),
    '[]'::jsonb
  ) into decisions
  from public.decisions as decision
  where decision.workspace_id = objective_row.workspace_id
    and (
      decision.objective_id = objective_row.id
      or (
        decision.status = 'pending'
        and decision.objective_id is null
        and decision.strategy_id is null
        and decision.branch_id is null
        and decision.step_id is null
      )
      or exists (
        select 1
        from public.strategies as strategy
        where strategy.id = decision.strategy_id
          and strategy.objective_id = objective_row.id
      )
      or exists (
        select 1
        from public.branches as branch
        join public.strategies as strategy on strategy.id = branch.strategy_id
        where branch.id = decision.branch_id
          and strategy.objective_id = objective_row.id
      )
      or exists (
        select 1
        from public.steps as step
        join public.strategies as strategy on strategy.id = step.strategy_id
        where step.id = decision.step_id
          and strategy.objective_id = objective_row.id
      )
    );

  select coalesce(
    jsonb_agg(to_jsonb(reasoning_result) order by reasoning_result.created_at, reasoning_result.id),
    '[]'::jsonb
  ) into reasoning_results
  from public.reasoning_results as reasoning_result
  where reasoning_result.workspace_id = objective_row.workspace_id
    and reasoning_result.objective_id = objective_row.id;

  select coalesce(
    jsonb_agg(to_jsonb(activity_event) order by activity_event.created_at desc, activity_event.id),
    '[]'::jsonb
  ) into activity_events
  from (
    select event.*
    from public.activity_events as event
    where event.workspace_id = objective_row.workspace_id
      and event.objective_id = objective_row.id
    order by event.created_at desc, event.id
    limit 2000
  ) as activity_event;

  return jsonb_build_object(
    'workspace', to_jsonb(workspace_row),
    'objective', to_jsonb(objective_row),
    'general_context_items', general_context_items,
    'objective_context_items', objective_context_items,
    'effective_context_items', general_context_items || objective_context_items,
    'strategies', strategies,
    'branches', branches,
    'steps', steps,
    'assumptions', assumptions,
    'decisions', decisions,
    'reasoning_results', reasoning_results,
    'step_dependencies', step_dependencies,
    'activity_events', activity_events,
    'sources', sources,
    'step_assumptions', step_assumptions,
    'step_sources', step_sources
  );
end;
$$;

-- Only normal authenticated callers can invoke public application RPCs. The
-- functions remain SECURITY INVOKER so their table reads/writes use the same
-- RLS policies as the browser and Edge API.
revoke execute on function public.create_workspace(text, text, text, text)
  from public, anon;
revoke execute on function public.update_workspace(
  uuid, bigint, text, text, text, text, text
) from public, anon;
revoke execute on function public.create_objective(
  uuid, text, text, text, text, text, text
) from public, anon;
revoke execute on function public.update_objective(
  uuid, uuid, bigint, text, text, text, text, text, text, text
) from public, anon;
revoke execute on function public.create_context_item(
  uuid, uuid, text, text, text, text, uuid, text, text, text, text, text, bigint,
  jsonb, text, text, text
) from public, anon;
revoke execute on function public.create_strategy(
  uuid, uuid, text, text, text, text, text, text
) from public, anon;
revoke execute on function public.mark_branch_completed(
  uuid, bigint, bigint, text, text, text
) from public, anon;
revoke execute on function public.set_reasoning_result(
  uuid, uuid, text, uuid, bigint, bigint, text, text, text, text, text
) from public, anon;
revoke execute on function public.request_human_decision(
  uuid, text, text, uuid, uuid, uuid, uuid, text, text, text
) from public, anon;
revoke execute on function public.find_steps(
  uuid, text, extensions.vector, uuid, uuid, uuid, text, integer,
  double precision, double precision, integer
) from public, anon;
revoke execute on function public.compare_branches(uuid, uuid) from public, anon;
revoke execute on function public.generate_clean_solution(uuid) from public, anon;
revoke execute on function public.list_workspace_summaries() from public, anon;
revoke execute on function public.get_workspace_overview(uuid) from public, anon;
revoke execute on function public.get_context(uuid, uuid) from public, anon;
revoke execute on function public.get_general_context(uuid) from public, anon;
revoke execute on function public.get_objective_graph(uuid) from public, anon;

grant execute on function public.create_workspace(text, text, text, text)
  to authenticated;
grant execute on function public.update_workspace(
  uuid, bigint, text, text, text, text, text
) to authenticated;
grant execute on function public.create_objective(
  uuid, text, text, text, text, text, text
) to authenticated;
grant execute on function public.update_objective(
  uuid, uuid, bigint, text, text, text, text, text, text, text
) to authenticated;
grant execute on function public.create_context_item(
  uuid, uuid, text, text, text, text, uuid, text, text, text, text, text, bigint,
  jsonb, text, text, text
) to authenticated;
grant execute on function public.create_strategy(
  uuid, uuid, text, text, text, text, text, text
) to authenticated;
grant execute on function public.mark_branch_completed(
  uuid, bigint, bigint, text, text, text
) to authenticated;
grant execute on function public.set_reasoning_result(
  uuid, uuid, text, uuid, bigint, bigint, text, text, text, text, text
) to authenticated;
grant execute on function public.request_human_decision(
  uuid, text, text, uuid, uuid, uuid, uuid, text, text, text
) to authenticated;
grant execute on function public.find_steps(
  uuid, text, extensions.vector, uuid, uuid, uuid, text, integer,
  double precision, double precision, integer
) to authenticated;
grant execute on function public.compare_branches(uuid, uuid) to authenticated;
grant execute on function public.generate_clean_solution(uuid) to authenticated;
grant execute on function public.list_workspace_summaries() to authenticated;
grant execute on function public.get_workspace_overview(uuid) to authenticated;
grant execute on function public.get_context(uuid, uuid) to authenticated;
grant execute on function public.get_general_context(uuid) to authenticated;
grant execute on function public.get_objective_graph(uuid) to authenticated;

comment on function public.create_workspace(text, text, text, text)
  is 'Creates an empty workspace with an owner-scoped idempotency receipt.';
comment on function public.update_workspace(uuid, bigint, text, text, text, text, text)
  is 'Updates the workspace shell with optimistic concurrency and idempotency.';
comment on function public.create_objective(uuid, text, text, text, text, text, text)
  is 'Creates one objective inside an authorized workspace with idempotency.';
comment on function public.update_objective(
  uuid, uuid, bigint, text, text, text, text, text, text, text
) is 'Updates one authorized objective with optimistic concurrency and idempotency.';
comment on function public.create_context_item(
  uuid, uuid, text, text, text, text, uuid, text, text, text, text, text, bigint,
  jsonb, text, text, text
) is 'Creates one workspace-general or objective-specific context item with idempotency.';
comment on function public.create_strategy(
  uuid, uuid, text, text, text, text, text, text
) is 'Creates one objective-scoped strategy and its root branch atomically.';
comment on function public.set_reasoning_result(
  uuid, uuid, text, uuid, bigint, bigint, text, text, text, text, text
) is 'Creates or edits one strategy- or branch-targeted outcome with optimistic concurrency.';
comment on function public.find_steps(
  uuid, text, extensions.vector, uuid, uuid, uuid, text, integer,
  double precision, double precision, integer
) is 'Runs workspace-wide hybrid retrieval, optionally filtered to one objective, strategy, or branch.';
comment on function public.get_workspace_overview(uuid)
  is 'Returns the workspace shell, objective sidebar summaries, and general context.';
comment on function public.get_objective_graph(uuid)
  is 'Returns one objective board plus workspace-general and objective-specific context.';
