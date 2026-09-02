-- Realtime consumers only need an authorization-filtered invalidation stream.
-- Publishing the append-only audit log avoids exposing every mutable graph
-- table and lets clients refetch the canonical, RLS-scoped graph snapshot.
do $$
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise exception 'LEMMA_REALTIME_PUBLICATION_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'activity_events'
  ) then
    execute 'alter publication supabase_realtime add table public.activity_events';
  end if;
end;
$$;

-- Keep the optimistic-concurrency check in the transaction that creates the
-- assumption relation. The prior API-only preflight could race a concurrent
-- step mutation between its read and this RPC's write.
create or replace function public.mark_assumption(
  p_step_id uuid,
  p_expected_step_revision bigint,
  p_label text,
  p_statement_markdown text,
  p_idempotency_key text,
  p_usage_kind text default 'used',
  p_assumption_status text default 'proposed',
  p_note_markdown text default '',
  p_author_type text default 'human',
  p_author_agent_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  step_row public.steps%rowtype;
  branch_row public.branches%rowtype;
  is_new boolean;
  cached jsonb;
  assumption_uuid uuid;
  relation_uuid uuid;
  result jsonb;
begin
  select * into step_row from public.steps where id = p_step_id;
  if not found then
    raise exception 'LEMMA_STEP_NOT_FOUND' using errcode = 'P0002';
  end if;

  select claimed, cached_response into is_new, cached
  from private.claim_mutation(
    step_row.workspace_id, p_idempotency_key, 'mark_assumption'
  );
  if not is_new then
    return cached;
  end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  -- Match update_step's branch-then-step lock order so an assumption mutation
  -- cannot deadlock with another mutation of the same step.
  select * into branch_row
  from public.branches
  where id = step_row.branch_id
  for update;

  select * into step_row
  from public.steps
  where id = p_step_id
  for update;
  if not found then
    raise exception 'LEMMA_STEP_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_expected_step_revision is null
    or step_row.revision <> p_expected_step_revision then
    raise exception 'LEMMA_REVISION_CONFLICT: step is at revision %', step_row.revision
      using errcode = '40001';
  end if;

  insert into public.assumptions (
    workspace_id,
    label,
    statement_markdown,
    status,
    author_type,
    author_user_id,
    author_agent_name
  ) values (
    step_row.workspace_id,
    p_label,
    p_statement_markdown,
    p_assumption_status,
    p_author_type,
    (select auth.uid()),
    p_author_agent_name
  ) returning id into assumption_uuid;

  insert into public.step_assumptions (
    workspace_id,
    step_id,
    assumption_id,
    usage_kind,
    note_markdown,
    author_type,
    author_user_id,
    author_agent_name
  ) values (
    step_row.workspace_id,
    step_row.id,
    assumption_uuid,
    p_usage_kind,
    coalesce(p_note_markdown, ''),
    p_author_type,
    (select auth.uid()),
    p_author_agent_name
  ) returning id into relation_uuid;

  update public.steps set revision = revision + 1 where id = step_row.id;
  update public.branches set revision = revision + 1 where id = branch_row.id;

  result := jsonb_build_object(
    'assumption_id', assumption_uuid,
    'step_assumption_id', relation_uuid,
    'step_id', step_row.id,
    'step_revision', step_row.revision + 1,
    'branch_revision', branch_row.revision + 1
  );
  perform private.finish_mutation(
    step_row.workspace_id, p_idempotency_key, assumption_uuid, result
  );
  return result;
end;
$$;

-- Keep the former signature as a compatibility wrapper during the Edge
-- Function rollout. It observes a revision and delegates to the locked,
-- checked overload, so changes after that observation fail atomically. Old
-- callers cannot forward the browser's captured revision, so this endpoint is
-- deliberately temporary. Remove it in a later contract migration after every
-- old Edge instance has drained.
create or replace function public.mark_assumption(
  p_step_id uuid,
  p_label text,
  p_statement_markdown text,
  p_idempotency_key text,
  p_usage_kind text default 'used',
  p_assumption_status text default 'proposed',
  p_note_markdown text default '',
  p_author_type text default 'human',
  p_author_agent_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  observed_revision bigint;
begin
  select revision
  into observed_revision
  from public.steps
  where id = p_step_id;

  if not found then
    raise exception 'LEMMA_STEP_NOT_FOUND' using errcode = 'P0002';
  end if;

  return public.mark_assumption(
    p_step_id => p_step_id,
    p_expected_step_revision => observed_revision,
    p_label => p_label,
    p_statement_markdown => p_statement_markdown,
    p_idempotency_key => p_idempotency_key,
    p_usage_kind => p_usage_kind,
    p_assumption_status => p_assumption_status,
    p_note_markdown => p_note_markdown,
    p_author_type => p_author_type,
    p_author_agent_name => p_author_agent_name
  );
end;
$$;

revoke execute on function public.mark_assumption(
  uuid, bigint, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.mark_assumption(
  uuid, bigint, text, text, text, text, text, text, text, text
) to authenticated;

revoke execute on function public.mark_assumption(
  uuid, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.mark_assumption(
  uuid, text, text, text, text, text, text, text, text
) to authenticated;

comment on function public.mark_assumption(
  uuid, bigint, text, text, text, text, text, text, text, text
) is 'Creates and attaches an assumption only when the locked step revision matches the caller expectation; retries reuse the original idempotency receipt.';

comment on function public.mark_assumption(
  uuid, text, text, text, text, text, text, text, text
) is 'Deprecated rollout-compatible wrapper; observes the current step revision and delegates to the locked revision-checked overload.';
