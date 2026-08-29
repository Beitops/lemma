-- Lemma: durable asynchronous embeddings for step search documents.
--
-- The queue payload deliberately contains only immutable identifiers and the
-- content hash. The worker claims the current document again before embedding
-- it, and completion compares the hash atomically so an older delivery can
-- never overwrite a newer search representation.

create extension if not exists supabase_vault with schema vault;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgmq;
create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;

-- The Edge worker presents this value back to the service-only RPCs. It is
-- created once in Vault; only the environment-specific project URL remains
-- to be configured separately. Rotations can use vault.update_secret.
do $$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets as secret
    where secret.name = 'lemma_embedding_worker_token'
  ) then
    perform vault.create_secret(
      new_secret => encode(extensions.gen_random_bytes(32), 'hex'),
      new_name => 'lemma_embedding_worker_token',
      new_description => 'Authenticates the Lemma asynchronous embedding worker.'
    );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pgmq.list_queues() as queue_row
    where queue_row.queue_name = 'lemma_step_embeddings'
  ) then
    perform pgmq.create(queue_name => 'lemma_step_embeddings');
  end if;
end;
$$;

-- Embeddings from the former 1536-dimensional representation are not
-- compatible with the active model. Clear them before changing the typmod so
-- this migration is safe even on environments that already have embeddings.
revoke all on function public.set_step_embedding(
  uuid, extensions.vector, text, text
) from public, anon, authenticated, service_role;
drop function if exists public.set_step_embedding(uuid, extensions.vector, text, text);

update private.step_search_documents
set
  embedding_model = null,
  embedded_at = null,
  updated_at = clock_timestamp()
where embedding is not null
  or embedding_model is not null
  or embedded_at is not null;

alter table private.step_search_documents
  alter column embedding type extensions.vector(384)
  using null::extensions.vector(384);

create table private.step_embedding_job_attempts (
  id bigint generated always as identity primary key,
  message_id bigint not null check (message_id > 0),
  attempt integer not null check (attempt > 0),
  error_message text not null check (char_length(error_message) between 1 and 500),
  terminal boolean not null,
  created_at timestamptz not null default clock_timestamp()
);

create index step_embedding_job_attempts_message_created_idx
  on private.step_embedding_job_attempts (message_id, created_at desc);

alter table private.step_embedding_job_attempts enable row level security;
revoke all on table private.step_embedding_job_attempts from anon, authenticated;

comment on column private.step_search_documents.embedding is
  '384-dimensional gte-small embeddings; regenerated asynchronously when content_hash changes.';
comment on column private.step_search_documents.embedding_model is
  'Active embedding model: gte-small:384:mean-pool-normalized:v1.';

-- Direct document writes would let a workspace owner forge a vector or model.
-- The service worker below is the only supported mutation path.
drop policy if exists step_search_documents_update_owner
  on private.step_search_documents;
revoke update on table private.step_search_documents from authenticated;

create or replace function private.assert_step_embedding_worker_token(
  p_worker_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_token text;
begin
  if nullif(btrim(p_worker_token), '') is null then
    raise exception 'LEMMA_EMBEDDING_WORKER_UNAUTHORIZED' using errcode = '42501';
  end if;

  select secret.decrypted_secret
  into expected_token
  from vault.decrypted_secrets as secret
  where secret.name = 'lemma_embedding_worker_token'
  order by secret.updated_at desc, secret.id desc
  limit 1;

  if nullif(btrim(expected_token), '') is null
    or p_worker_token is distinct from expected_token then
    raise exception 'LEMMA_EMBEDDING_WORKER_UNAUTHORIZED' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.enqueue_step_embedding_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.content_hash is not distinct from new.content_hash then
      return new;
    end if;
  end if;

  perform pgmq.send(
    queue_name => 'lemma_step_embeddings',
    msg => jsonb_build_object(
      'workspace_id', new.workspace_id,
      'step_id', new.step_id,
      'content_hash', new.content_hash,
      'embedding_model', 'gte-small:384:mean-pool-normalized:v1'
    ),
    delay => 0
  );

  return new;
end;
$$;

drop trigger if exists z_step_search_documents_enqueue_embedding
  on private.step_search_documents;
create trigger z_step_search_documents_enqueue_embedding
after insert or update of content_hash on private.step_search_documents
for each row execute function private.enqueue_step_embedding_job();

-- Existing search documents need one initial delivery after the dimensional
-- migration. Later changes are covered by the trigger above.
select pgmq.send(
  queue_name => 'lemma_step_embeddings',
  msg => jsonb_build_object(
    'workspace_id', document.workspace_id,
    'step_id', document.step_id,
    'content_hash', document.content_hash,
    'embedding_model', 'gte-small:384:mean-pool-normalized:v1'
  ),
  delay => 0
)
from private.step_search_documents as document
where document.embedding is null
  or document.embedding_model is distinct from 'gte-small:384:mean-pool-normalized:v1';

create function public.claim_step_embedding_jobs(
  p_worker_token text,
  p_max_jobs integer default 8,
  p_visibility_timeout_seconds integer default 120
)
returns table (
  message_id bigint,
  attempt integer,
  workspace_id uuid,
  step_id uuid,
  content_hash text,
  search_text text,
  embedding_model text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  queue_message record;
  document_row private.step_search_documents%rowtype;
  payload_workspace_id uuid;
  payload_step_id uuid;
  payload_content_hash text;
  payload_embedding_model text;
  visibility_timeout integer;
  job_limit integer;
  active_embedding_model constant text := 'gte-small:384:mean-pool-normalized:v1';
begin
  perform private.assert_step_embedding_worker_token(p_worker_token);

  if p_max_jobs is null or p_max_jobs not between 1 and 32 then
    raise exception 'LEMMA_INVALID_EMBEDDING_JOB_LIMIT' using errcode = '22023';
  end if;
  if p_visibility_timeout_seconds is null
    or p_visibility_timeout_seconds not between 30 and 900 then
    raise exception 'LEMMA_INVALID_EMBEDDING_VISIBILITY_TIMEOUT' using errcode = '22023';
  end if;

  job_limit := p_max_jobs;
  visibility_timeout := p_visibility_timeout_seconds;

  for queue_message in
    select *
    from pgmq.read(
      queue_name => 'lemma_step_embeddings',
      vt => visibility_timeout,
      qty => job_limit
    )
  loop
    -- A fifth failed delivery is archived by retry_step_embedding_job. This
    -- also clears messages whose worker died after receiving attempt five.
    if queue_message.read_ct > 5 then
      perform pgmq.archive(
        queue_name => 'lemma_step_embeddings',
        msg_id => queue_message.msg_id
      );
      continue;
    end if;

    begin
      payload_workspace_id := (queue_message.message ->> 'workspace_id')::uuid;
      payload_step_id := (queue_message.message ->> 'step_id')::uuid;
      payload_content_hash := nullif(queue_message.message ->> 'content_hash', '');
      payload_embedding_model := nullif(queue_message.message ->> 'embedding_model', '');
    exception
      when invalid_text_representation then
        perform pgmq.archive(
          queue_name => 'lemma_step_embeddings',
          msg_id => queue_message.msg_id
        );
        continue;
    end;

    if payload_workspace_id is null
      or payload_step_id is null
      or payload_content_hash is null
      or payload_embedding_model is distinct from active_embedding_model then
      perform pgmq.archive(
        queue_name => 'lemma_step_embeddings',
        msg_id => queue_message.msg_id
      );
      continue;
    end if;

    select document.*
    into document_row
    from private.step_search_documents as document
    where document.step_id = payload_step_id
      and document.workspace_id = payload_workspace_id
      and document.content_hash = payload_content_hash
      and (
        document.embedding is null
        or document.embedding_model is distinct from active_embedding_model
      );

    if not found or nullif(btrim(document_row.search_text), '') is null then
      perform pgmq.archive(
        queue_name => 'lemma_step_embeddings',
        msg_id => queue_message.msg_id
      );
      continue;
    end if;

    message_id := queue_message.msg_id;
    attempt := queue_message.read_ct::integer;
    workspace_id := document_row.workspace_id;
    step_id := document_row.step_id;
    content_hash := document_row.content_hash;
    search_text := document_row.search_text;
    embedding_model := active_embedding_model;
    return next;
  end loop;
end;
$$;

create function public.complete_step_embedding_job(
  p_worker_token text,
  p_message_id bigint,
  p_step_id uuid,
  p_content_hash text,
  p_embedding extensions.vector(384),
  p_embedding_model text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_row private.step_search_documents%rowtype;
  queue_message_deleted boolean := false;
  queue_message_archived boolean := false;
  active_embedding_model constant text := 'gte-small:384:mean-pool-normalized:v1';
begin
  perform private.assert_step_embedding_worker_token(p_worker_token);

  if p_message_id is null or p_message_id <= 0
    or p_step_id is null
    or nullif(btrim(p_content_hash), '') is null
    or p_embedding is null then
    raise exception 'LEMMA_INVALID_EMBEDDING_COMPLETION' using errcode = '22023';
  end if;
  if p_embedding_model is distinct from active_embedding_model then
    raise exception 'LEMMA_UNSUPPORTED_EMBEDDING_MODEL' using errcode = '22023';
  end if;

  update private.step_search_documents
  set
    embedding = p_embedding,
    embedding_model = active_embedding_model,
    embedded_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where step_id = p_step_id
    and content_hash = p_content_hash
  returning * into document_row;

  if found then
    select pgmq.delete(
      queue_name => 'lemma_step_embeddings',
      msg_id => p_message_id
    ) into queue_message_deleted;

    return jsonb_build_object(
      'status', 'completed',
      'completed', true,
      'step_id', document_row.step_id,
      'content_hash', document_row.content_hash,
      'embedding_model', document_row.embedding_model,
      'message_deleted', coalesce(queue_message_deleted, false)
    );
  end if;

  select pgmq.archive(
    queue_name => 'lemma_step_embeddings',
    msg_id => p_message_id
  ) into queue_message_archived;

  return jsonb_build_object(
    'status', 'stale',
    'stale', true,
    'step_id', p_step_id,
    'content_hash', p_content_hash,
    'message_archived', coalesce(queue_message_archived, false)
  );
end;
$$;

create function public.retry_step_embedding_job(
  p_worker_token text,
  p_message_id bigint,
  p_attempt integer,
  p_error text,
  p_visibility_timeout_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  queue_message_archived boolean := false;
  active_visibility_timeout integer;
  sanitized_error text;
begin
  perform private.assert_step_embedding_worker_token(p_worker_token);

  if p_message_id is null or p_message_id <= 0
    or p_attempt is null or p_attempt <= 0
    or nullif(btrim(p_error), '') is null
    or char_length(p_error) > 1000 then
    raise exception 'LEMMA_INVALID_EMBEDDING_RETRY' using errcode = '22023';
  end if;
  if p_visibility_timeout_seconds is null
    or p_visibility_timeout_seconds not between 1 and 3600 then
    raise exception 'LEMMA_INVALID_EMBEDDING_VISIBILITY_TIMEOUT' using errcode = '22023';
  end if;

  sanitized_error := left(
    regexp_replace(btrim(p_error), '[[:cntrl:]]+', ' ', 'g'),
    500
  );
  insert into private.step_embedding_job_attempts (
    message_id,
    attempt,
    error_message,
    terminal
  ) values (
    p_message_id,
    p_attempt,
    sanitized_error,
    p_attempt >= 5
  );

  if p_attempt >= 5 then
    select pgmq.archive(
      queue_name => 'lemma_step_embeddings',
      msg_id => p_message_id
    ) into queue_message_archived;

    return jsonb_build_object(
      'status', 'archived',
      'terminal', true,
      'attempt', p_attempt,
      'message_archived', coalesce(queue_message_archived, false)
    );
  end if;

  active_visibility_timeout := p_visibility_timeout_seconds;
  perform pgmq.set_vt(
    queue_name => 'lemma_step_embeddings',
    msg_id => p_message_id,
    vt_offset => active_visibility_timeout
  );

  return jsonb_build_object(
    'status', 'retry_scheduled',
    'attempt', p_attempt,
    'visibility_timeout_seconds', active_visibility_timeout
  );
end;
$$;

-- Keep the workspace mandatory. `NOT MATERIALIZED` lets Postgres inline the
-- scoped relation separately for the FTS and vector candidates instead of
-- materializing it three times and losing the regular scope/GIN indexes.
drop function if exists public.find_steps(
  uuid, text, extensions.vector, uuid, uuid, uuid, text, integer,
  double precision, double precision, integer
);
drop function if exists public.find_steps(
  uuid, text, extensions.vector, uuid, uuid, uuid, text, integer,
  double precision, double precision, integer, text
);

create function public.find_steps(
  p_workspace_id uuid,
  p_query_text text,
  p_query_embedding extensions.vector(384) default null,
  p_objective_id uuid default null,
  p_strategy_id uuid default null,
  p_branch_id uuid default null,
  p_status text default null,
  p_top_k integer default 10,
  p_full_text_weight double precision default 1,
  p_semantic_weight double precision default 1,
  p_rrf_k integer default 50,
  p_embedding_model text default 'gte-small:384:mean-pool-normalized:v1'
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
  if nullif(btrim(p_embedding_model), '') is null then
    raise exception 'LEMMA_INVALID_EMBEDDING_MODEL' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.workspaces as workspace
    where workspace.id = p_workspace_id
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
  scoped as not materialized (
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
      and scoped.embedding_model = p_embedding_model
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

create or replace function private.invoke_embedding_worker()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  worker_token text;
  request_id bigint;
begin
  select secret.decrypted_secret
  into project_url
  from vault.decrypted_secrets as secret
  where secret.name = 'lemma_project_url'
  order by secret.updated_at desc, secret.id desc
  limit 1;

  project_url := nullif(btrim(project_url), '');
  if project_url is null then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'lemma_project_url_not_configured'
    );
  end if;

  select secret.decrypted_secret
  into worker_token
  from vault.decrypted_secrets as secret
  where secret.name = 'lemma_embedding_worker_token'
  order by secret.updated_at desc, secret.id desc
  limit 1;

  worker_token := nullif(btrim(worker_token), '');
  if worker_token is null then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'lemma_embedding_worker_token_not_configured'
    );
  end if;

  if project_url !~ '^https?://' then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'lemma_project_url_invalid'
    );
  end if;

  if not exists (
    select 1
    from pgmq.q_lemma_step_embeddings as queue_message
    where queue_message.vt <= clock_timestamp()
  ) then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'no_visible_jobs'
    );
  end if;

  project_url := rtrim(project_url, '/');
  select net.http_post(
    url => project_url || '/functions/v1/embed-steps',
    body => jsonb_build_object('source', 'pg_cron'),
    headers => jsonb_build_object(
      'Content-Type', 'application/json',
      'x-lemma-embedding-worker-token', worker_token
    ),
    timeout_milliseconds => 110000
  ) into request_id;

  return jsonb_build_object(
    'status', 'queued',
    'request_id', request_id
  );
end;
$$;

do $$
begin
  if exists (
    select 1
    from cron.job as job
    where job.jobname = 'lemma-step-embedding-worker'
  ) then
    perform cron.unschedule('lemma-step-embedding-worker');
  end if;

  perform cron.schedule(
    'lemma-step-embedding-worker',
    '10 seconds',
    'select private.invoke_embedding_worker();'
  );
end;
$$;

-- The queue itself stays private. Do not alter broad pgmq/net/cron grants:
-- other project integrations may share those extension schemas.
grant all on table pgmq.q_lemma_step_embeddings, pgmq.a_lemma_step_embeddings
  to postgres;
revoke all on table pgmq.q_lemma_step_embeddings, pgmq.a_lemma_step_embeddings
  from public, anon, authenticated;

revoke all on function private.assert_step_embedding_worker_token(text)
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_step_embedding_job()
  from public, anon, authenticated, service_role;
revoke all on function private.invoke_embedding_worker()
  from public, anon, authenticated, service_role;

revoke all on function public.claim_step_embedding_jobs(text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_step_embedding_job(
  text, bigint, uuid, text, extensions.vector, text
) from public, anon, authenticated, service_role;
revoke all on function public.retry_step_embedding_job(text, bigint, integer, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_step_embedding_jobs(text, integer, integer)
  to service_role;
grant execute on function public.complete_step_embedding_job(
  text, bigint, uuid, text, extensions.vector, text
) to service_role;
grant execute on function public.retry_step_embedding_job(text, bigint, integer, text, integer)
  to service_role;

revoke all on function public.find_steps(
  uuid, text, extensions.vector, uuid, uuid, uuid, text, integer,
  double precision, double precision, integer, text
) from public, anon;
grant execute on function public.find_steps(
  uuid, text, extensions.vector, uuid, uuid, uuid, text, integer,
  double precision, double precision, integer, text
) to authenticated;

comment on function public.claim_step_embedding_jobs(text, integer, integer) is
  'Service-only claim of current step embedding jobs; Vault token required.';
comment on function public.complete_step_embedding_job(
  text, bigint, uuid, text, extensions.vector, text
) is 'Service-only, hash-guarded embedding completion; stale jobs are archived.';
comment on function public.retry_step_embedding_job(text, bigint, integer, text, integer) is
  'Service-only visibility-timeout retry; attempt five is archived permanently.';
comment on function public.find_steps(
  uuid, text, extensions.vector, uuid, uuid, uuid, text, integer,
  double precision, double precision, integer, text
) is 'Runs workspace-wide hybrid retrieval with optional objective, strategy, branch, and status filters.';
