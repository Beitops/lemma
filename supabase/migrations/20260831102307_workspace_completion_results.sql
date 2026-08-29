-- One editable, current conclusion for each workspace. The source branch is
-- explicit so a final result never has to be inferred from Markdown prose.
create table public.workspace_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique
    references public.workspaces (id) on delete cascade,
  branch_id uuid not null,
  source_branch_revision bigint not null check (source_branch_revision > 0),
  result_markdown text not null check (
    char_length(btrim(result_markdown)) between 1 and 100000
  ),
  author_type text not null check (author_type in ('human', 'agent')),
  author_user_id uuid references auth.users (id) on delete cascade default auth.uid(),
  author_agent_name text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, workspace_id)
    references public.branches (id, workspace_id) on delete restrict,
  check (
    (author_type = 'human' and author_user_id is not null and author_agent_name is null)
    or (
      author_type = 'agent'
      and author_user_id is not null
      and nullif(btrim(author_agent_name), '') is not null
    )
  )
);

-- The unique workspace key indexes that FK. This covers the composite branch
-- FK in the opposite lookup direction and keeps branch deletes/references fast.
create index workspace_results_branch_workspace_fk_idx
  on public.workspace_results (branch_id, workspace_id);

-- A direct table write still cannot claim an unfinished branch or invent a
-- source revision. The RPCs below acquire the branch lock before this trigger;
-- the trigger itself deliberately performs a non-locking read so it cannot
-- invert the RPC's workspace -> branch -> result lock order.
create or replace function private.enforce_workspace_result_source_branch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  branch_row public.branches%rowtype;
begin
  select * into branch_row
  from public.branches as branch
  where branch.id = new.branch_id
    and branch.workspace_id = new.workspace_id;

  if not found then
    raise exception 'LEMMA_BRANCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  if branch_row.status <> 'completed' then
    raise exception 'LEMMA_WORKSPACE_RESULT_REQUIRES_COMPLETED_BRANCH'
      using errcode = '23514';
  end if;

  if new.source_branch_revision <> branch_row.revision then
    raise exception 'LEMMA_WORKSPACE_RESULT_SOURCE_REVISION_CONFLICT: branch is at revision %',
      branch_row.revision
      using errcode = '40001';
  end if;

  return new;
end;
$$;

-- Result activity deliberately stores only structural provenance. The conclusion
-- itself remains in workspace_results and is not duplicated into the activity log.
create or replace function private.record_workspace_result_activity_event()
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
  if actor_kind is null or actor_kind not in ('human', 'agent', 'system') then
    actor_kind := case when (select auth.uid()) is null then 'system' else 'human' end;
  end if;

  agent_name := nullif(current_setting('lemma.actor_agent_name', true), '');

  insert into public.activity_events (
    workspace_id,
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
    'workspace_result',
    new.id,
    lower(tg_op),
    actor_kind,
    (select auth.uid()),
    case when actor_kind = 'agent' then agent_name else null end,
    new.revision,
    jsonb_build_object(
      'branch_id', new.branch_id,
      'source_branch_revision', new.source_branch_revision
    )
  );

  return new;
end;
$$;

-- The author is intentionally mutable: every insert or update records the
-- current caller (or the agent context set by the mutation RPC) as the latest
-- editor. This makes a direct owner write safe as well: absent agent context,
-- it is recorded as a human edit rather than retaining stale agent provenance.
create or replace function private.stamp_workspace_result_author()
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

create trigger a_workspace_results_actor
before insert or update on public.workspace_results
for each row execute function private.stamp_workspace_result_author();
create trigger b_workspace_results_immutable
before update on public.workspace_results
for each row execute function private.prevent_column_changes(
  'id', 'workspace_id', 'created_at'
);
create trigger c_workspace_results_source_branch
before insert or update on public.workspace_results
for each row execute function private.enforce_workspace_result_source_branch();
create trigger d_workspace_results_revision
before update on public.workspace_results
for each row execute function private.enforce_revision_bump();
create trigger z_workspace_results_activity
after insert or update on public.workspace_results
for each row execute function private.record_workspace_result_activity_event();

alter table public.workspace_results enable row level security;

create policy workspace_results_select_owner on public.workspace_results
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));
create policy workspace_results_insert_owner on public.workspace_results
for insert to authenticated
with check ((select private.is_workspace_owner(workspace_id)));
create policy workspace_results_update_owner on public.workspace_results
for update to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

revoke all on table public.workspace_results from anon, authenticated;
grant select, insert, update on table public.workspace_results to authenticated;

revoke execute on function private.enforce_workspace_result_source_branch()
  from public, anon, authenticated;
revoke execute on function private.record_workspace_result_activity_event()
  from public, anon, authenticated;
revoke execute on function private.stamp_workspace_result_author()
  from public, anon, authenticated;

-- Atomically complete the selected active branch and its strategy. A completed
-- strategy may retain other active branches, but an abandoned strategy cannot
-- be completed through this path.
create function public.mark_branch_completed(
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
    initial_branch.workspace_id,
    p_idempotency_key,
    'mark_branch_completed'
  );
  if not is_new then
    return cached;
  end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  -- Lock order is fixed for every completion: strategy, then branch.
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
    'strategy_id', strategy_row.id,
    'strategy_status', strategy_row.status,
    'strategy_revision', strategy_row.revision,
    'branch_id', branch_row.id,
    'branch_status', branch_row.status,
    'branch_revision', branch_row.revision
  );

  perform private.finish_mutation(
    branch_row.workspace_id,
    p_idempotency_key,
    branch_row.id,
    result
  );
  return result;
end;
$$;

-- Create or replace the workspace's current final result. The source can move
-- to a different completed branch during an edit, while the row identity and
-- workspace ownership remain stable.
create function public.set_workspace_result(
  p_workspace_id uuid,
  p_branch_id uuid,
  p_expected_branch_revision bigint,
  p_expected_result_revision bigint,
  p_result_markdown text,
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
  workspace_row public.workspaces%rowtype;
  branch_row public.branches%rowtype;
  workspace_result_row public.workspace_results%rowtype;
  is_new boolean;
  cached jsonb;
  result jsonb;
begin
  if p_expected_branch_revision is null or p_expected_branch_revision <= 0 then
    raise exception 'LEMMA_INVALID_EXPECTED_BRANCH_REVISION' using errcode = '22023';
  end if;

  if p_expected_result_revision is not null and p_expected_result_revision <= 0 then
    raise exception 'LEMMA_INVALID_EXPECTED_RESULT_REVISION' using errcode = '22023';
  end if;

  if nullif(btrim(p_result_markdown), '') is null
    or char_length(btrim(p_result_markdown)) > 100000 then
    raise exception 'LEMMA_INVALID_WORKSPACE_RESULT' using errcode = '22023';
  end if;

  select claimed, cached_response into is_new, cached
  from private.claim_mutation(
    p_workspace_id,
    p_idempotency_key,
    'set_workspace_result'
  );
  if not is_new then
    return cached;
  end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  -- Lock order is fixed for result mutations: workspace, branch, then result.
  select * into workspace_row
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  if not found then
    raise exception 'LEMMA_WORKSPACE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into branch_row
  from public.branches as branch
  where branch.id = p_branch_id
    and branch.workspace_id = workspace_row.id
  for update;

  if not found then
    raise exception 'LEMMA_BRANCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into workspace_result_row
  from public.workspace_results as workspace_result
  where workspace_result.workspace_id = workspace_row.id
  for update;

  if branch_row.revision <> p_expected_branch_revision then
    raise exception 'LEMMA_REVISION_CONFLICT: branch is at revision %', branch_row.revision
      using errcode = '40001';
  end if;

  if branch_row.status <> 'completed' then
    raise exception 'LEMMA_WORKSPACE_RESULT_REQUIRES_COMPLETED_BRANCH'
      using errcode = '23514';
  end if;

  if p_expected_result_revision is null then
    if found then
      raise exception 'LEMMA_WORKSPACE_RESULT_ALREADY_EXISTS' using errcode = '40001';
    end if;

    insert into public.workspace_results (
      workspace_id,
      branch_id,
      source_branch_revision,
      result_markdown,
      author_type,
      author_user_id,
      author_agent_name
    ) values (
      workspace_row.id,
      branch_row.id,
      branch_row.revision,
      btrim(p_result_markdown),
      p_author_type,
      (select auth.uid()),
      p_author_agent_name
    )
    returning * into workspace_result_row;
  else
    if not found then
      raise exception 'LEMMA_WORKSPACE_RESULT_NOT_FOUND' using errcode = '40001';
    end if;

    if workspace_result_row.revision <> p_expected_result_revision then
      raise exception 'LEMMA_REVISION_CONFLICT: workspace result is at revision %',
        workspace_result_row.revision
        using errcode = '40001';
    end if;

    update public.workspace_results
    set
      branch_id = branch_row.id,
      source_branch_revision = branch_row.revision,
      result_markdown = btrim(p_result_markdown),
      author_type = p_author_type,
      author_user_id = (select auth.uid()),
      author_agent_name = p_author_agent_name,
      revision = revision + 1
    where id = workspace_result_row.id
    returning * into workspace_result_row;
  end if;

  result := jsonb_build_object(
    'id', workspace_result_row.id,
    'workspace_id', workspace_result_row.workspace_id,
    'branch_id', workspace_result_row.branch_id,
    'source_branch_revision', workspace_result_row.source_branch_revision,
    'result_markdown', workspace_result_row.result_markdown,
    'author_type', workspace_result_row.author_type,
    'author_user_id', workspace_result_row.author_user_id,
    'author_agent_name', workspace_result_row.author_agent_name,
    'revision', workspace_result_row.revision,
    'created_at', workspace_result_row.created_at,
    'updated_at', workspace_result_row.updated_at
  );

  perform private.finish_mutation(
    workspace_row.id,
    p_idempotency_key,
    workspace_result_row.id,
    result
  );
  return result;
end;
$$;

revoke execute on function public.mark_branch_completed(
  uuid, bigint, bigint, text, text, text
) from public, anon;
revoke execute on function public.set_workspace_result(
  uuid, uuid, bigint, bigint, text, text, text, text
) from public, anon;

grant execute on function public.mark_branch_completed(
  uuid, bigint, bigint, text, text, text
) to authenticated;
grant execute on function public.set_workspace_result(
  uuid, uuid, bigint, bigint, text, text, text, text
) to authenticated;

comment on function public.mark_branch_completed(
  uuid, bigint, bigint, text, text, text
) is 'Atomically completes one active branch and its strategy with optimistic concurrency and idempotency.';
comment on function public.set_workspace_result(
  uuid, uuid, bigint, bigint, text, text, text, text
) is 'Creates or edits the current workspace result from a completed branch with optimistic concurrency and idempotency.';
