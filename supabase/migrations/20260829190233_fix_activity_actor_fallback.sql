-- SQL three-valued logic makes `NULL NOT IN (...)` evaluate to NULL, not TRUE.
-- Treat an unset actor context explicitly so normal signed-in writes are
-- recorded as human actions and server-side writes as system actions.

create or replace function private.record_activity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb := to_jsonb(new);
  workspace_uuid uuid;
  entity_uuid uuid;
  actor_kind text;
  agent_name text;
  row_revision bigint;
begin
  workspace_uuid := case
    when tg_table_name = 'workspaces' then new.id
    else (row_data ->> 'workspace_id')::uuid
  end;
  entity_uuid := new.id;

  actor_kind := nullif(current_setting('lemma.actor_type', true), '');
  if actor_kind is null or actor_kind not in ('human', 'agent', 'system') then
    actor_kind := case when (select auth.uid()) is null then 'system' else 'human' end;
  end if;

  agent_name := nullif(current_setting('lemma.actor_agent_name', true), '');
  row_revision := nullif(row_data ->> 'revision', '')::bigint;

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
    workspace_uuid,
    tg_table_name,
    entity_uuid,
    lower(tg_op),
    actor_kind,
    (select auth.uid()),
    case when actor_kind = 'agent' then agent_name else null end,
    row_revision,
    jsonb_strip_nulls(jsonb_build_object(
      'status', row_data ->> 'status',
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
    (row_data ->> 'workspace_id')::uuid,
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

create or replace function private.record_step_revision()
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

  insert into public.step_revisions (
    workspace_id,
    step_id,
    revision,
    title,
    summary,
    body_markdown,
    concepts,
    theorem_tags,
    status,
    changed_by_type,
    changed_by_user_id,
    changed_by_agent_name,
    change_kind
  ) values (
    new.workspace_id,
    new.id,
    new.revision,
    new.title,
    new.summary,
    new.body_markdown,
    new.concepts,
    new.theorem_tags,
    new.status,
    actor_kind,
    (select auth.uid()),
    case when actor_kind = 'agent' then agent_name else null end,
    case when tg_op = 'INSERT' then 'created' else 'revised' end
  );

  return new;
end;
$$;

revoke execute on function private.record_activity_event() from public, anon, authenticated;
revoke execute on function private.record_relation_activity_event() from public, anon, authenticated;
revoke execute on function private.record_step_revision() from public, anon, authenticated;
