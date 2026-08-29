-- End-to-end coverage for the queued, hash-guarded 384-dimensional embedding
-- pipeline. The transaction rolls back the test Vault token and queue rows.

begin;
set local search_path = public, extensions;

select plan(4);

-- The suite may run against a developer's already-migrated local database.
-- PGMQ mutations are transactional, so rollback restores any prior messages.
select pgmq.purge_queue(queue_name => 'lemma_step_embeddings');

select vault.update_secret(
  secret_id => (
    select secret.id
    from vault.decrypted_secrets as secret
    where secret.name = 'lemma_embedding_worker_token'
    order by secret.updated_at desc, secret.id desc
    limit 1
  ),
  new_secret => 'queued-step-embeddings-test-token'
);

insert into auth.users (id)
values ('33333333-3333-4333-8333-333333333333');

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

do $setup$
declare
  workspace_uuid uuid;
  objective_uuid uuid;
  branch_uuid uuid;
  response jsonb;
begin
  response := public.create_workspace(
    'Queued embeddings workspace',
    'queued-embedding-workspace-create-0001'
  );
  workspace_uuid := (response ->> 'workspace_id')::uuid;

  response := public.create_objective(
    workspace_uuid,
    'Queued embeddings objective',
    'Exercise the asynchronous embedding lifecycle.',
    '',
    'queued-embedding-objective-create-0001'
  );
  objective_uuid := (response ->> 'objective_id')::uuid;

  response := public.create_strategy(
    workspace_uuid,
    objective_uuid,
    'Queued embeddings strategy',
    'queued-embedding-strategy-create-0001'
  );
  branch_uuid := (response ->> 'root_branch_id')::uuid;

  response := public.create_step(
    branch_uuid,
    'Embedding candidate',
    'The vector worker should embed this active step.',
    1,
    'queued-embedding-step-create-0001'
  );

  perform set_config('lemma_test.embedding_workspace_id', workspace_uuid::text, true);
  perform set_config('lemma_test.embedding_step_id', (response ->> 'step_id'), true);
end;
$setup$;

reset role;
set local role service_role;

do $worker_completion$
declare
  claimed record;
  completion jsonb;
  embedding_value extensions.vector(384);
  step_uuid uuid := current_setting('lemma_test.embedding_step_id')::uuid;
begin
  begin
    perform public.claim_step_embedding_jobs(
      p_worker_token => 'wrong-token',
      p_max_jobs => 1,
      p_visibility_timeout_seconds => 120
    );
    raise exception 'invalid embedding worker token was accepted';
  exception
    when insufficient_privilege then null;
  end;

  select job.*
  into claimed
  from public.claim_step_embedding_jobs(
    p_worker_token => 'queued-step-embeddings-test-token',
    p_max_jobs => 8,
    p_visibility_timeout_seconds => 120
  ) as job
  where job.step_id = step_uuid;

  if not found then
    raise exception 'created step was not enqueued for embedding';
  end if;

  embedding_value := (
    '[' || array_to_string(array_fill('0.125'::text, array[384]), ',') || ']'
  )::extensions.vector(384);
  completion := public.complete_step_embedding_job(
    p_worker_token => 'queued-step-embeddings-test-token',
    p_message_id => claimed.message_id,
    p_step_id => step_uuid,
    p_content_hash => claimed.content_hash,
    p_embedding => embedding_value,
    p_embedding_model => 'gte-small:384:mean-pool-normalized:v1'
  );

  if completion ->> 'status' <> 'completed'
    or not coalesce((completion ->> 'completed')::boolean, false)
    or completion ->> 'embedding_model'
      <> 'gte-small:384:mean-pool-normalized:v1' then
    raise exception 'embedding completion did not persist the active model';
  end if;
end;
$worker_completion$;

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

do $semantic_search$
declare
  workspace_uuid uuid := current_setting('lemma_test.embedding_workspace_id')::uuid;
  step_uuid uuid := current_setting('lemma_test.embedding_step_id')::uuid;
  embedding_value extensions.vector(384);
  result_count integer;
begin
  embedding_value := (
    '[' || array_to_string(array_fill('0.125'::text, array[384]), ',') || ']'
  )::extensions.vector(384);

  select count(*)
  into result_count
  from public.find_steps(
    p_workspace_id => workspace_uuid,
    p_query_text => 'zzzxqv-no-lexical-match',
    p_query_embedding => embedding_value,
    p_embedding_model => 'gte-small:384:mean-pool-normalized:v1',
    p_full_text_weight => 0,
    p_semantic_weight => 1
  ) as found
  where found.step_id = step_uuid
    and found.semantic_rank is not null;

  if result_count <> 1 then
    raise exception 'semantic retrieval did not return the completed embedding';
  end if;
end;
$semantic_search$;

do $queue_first_revision$
declare
  step_uuid uuid := current_setting('lemma_test.embedding_step_id')::uuid;
begin
  perform public.update_step(
    step_uuid,
    1,
    'queued-embedding-step-update-0001',
    p_body_markdown => 'First content refresh should enqueue a fresh vector job.'
  );
end;
$queue_first_revision$;

reset role;
set local role service_role;

do $claim_stale_candidate$
declare
  claimed record;
  step_uuid uuid := current_setting('lemma_test.embedding_step_id')::uuid;
begin
  select job.*
  into claimed
  from public.claim_step_embedding_jobs(
    p_worker_token => 'queued-step-embeddings-test-token',
    p_max_jobs => 8,
    p_visibility_timeout_seconds => 120
  ) as job
  where job.step_id = step_uuid;

  if not found then
    raise exception 'content hash refresh was not enqueued';
  end if;

  perform set_config('lemma_test.stale_message_id', claimed.message_id::text, true);
  perform set_config('lemma_test.stale_content_hash', claimed.content_hash, true);
end;
$claim_stale_candidate$;

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

do $queue_second_revision$
declare
  step_uuid uuid := current_setting('lemma_test.embedding_step_id')::uuid;
begin
  perform public.update_step(
    step_uuid,
    2,
    'queued-embedding-step-update-0002',
    p_body_markdown => 'Second refresh makes the previously claimed hash stale.'
  );
end;
$queue_second_revision$;

reset role;
set local role service_role;

do $stale_and_retry$
declare
  stale_completion jsonb;
  retry_result jsonb;
  claimed record;
  embedding_value extensions.vector(384);
  step_uuid uuid := current_setting('lemma_test.embedding_step_id')::uuid;
begin
  embedding_value := (
    '[' || array_to_string(array_fill('0.125'::text, array[384]), ',') || ']'
  )::extensions.vector(384);
  stale_completion := public.complete_step_embedding_job(
    p_worker_token => 'queued-step-embeddings-test-token',
    p_message_id => current_setting('lemma_test.stale_message_id')::bigint,
    p_step_id => step_uuid,
    p_content_hash => current_setting('lemma_test.stale_content_hash'),
    p_embedding => embedding_value,
    p_embedding_model => 'gte-small:384:mean-pool-normalized:v1'
  );

  if stale_completion ->> 'status' <> 'stale'
    or not coalesce((stale_completion ->> 'stale')::boolean, false) then
    raise exception 'a stale content hash overwrote the current search document';
  end if;

  select job.*
  into claimed
  from public.claim_step_embedding_jobs(
    p_worker_token => 'queued-step-embeddings-test-token',
    p_max_jobs => 8,
    p_visibility_timeout_seconds => 120
  ) as job
  where job.step_id = step_uuid;

  if not found then
    raise exception 'latest search document was not available after stale completion';
  end if;

  perform set_config('lemma_test.retry_message_id', claimed.message_id::text, true);
  perform set_config('lemma_test.retry_attempt', claimed.attempt::text, true);

  retry_result := public.retry_step_embedding_job(
    p_worker_token => 'queued-step-embeddings-test-token',
    p_message_id => claimed.message_id,
    p_attempt => claimed.attempt,
    p_error => E'worker\nerror',
    p_visibility_timeout_seconds => 30
  );
  if retry_result ->> 'status' <> 'retry_scheduled' then
    raise exception 'retry did not set a visibility timeout';
  end if;

  retry_result := public.retry_step_embedding_job(
    p_worker_token => 'queued-step-embeddings-test-token',
    p_message_id => claimed.message_id,
    p_attempt => 5,
    p_error => 'terminal worker error',
    p_visibility_timeout_seconds => 30
  );
  if retry_result ->> 'status' <> 'archived'
    or not coalesce((retry_result ->> 'terminal')::boolean, false)
    or not coalesce((retry_result ->> 'message_archived')::boolean, false) then
    raise exception 'retry observability or terminal archiving failed';
  end if;
end;
$stale_and_retry$;

reset role;

select ok(
  exists (
    select 1
    from private.step_embedding_job_attempts as attempt_log
    where attempt_log.message_id = current_setting('lemma_test.retry_message_id')::bigint
      and attempt_log.attempt = current_setting('lemma_test.retry_attempt')::integer
      and not attempt_log.terminal
      and attempt_log.error_message = 'worker error'
  ),
  'retry failure is recorded for worker observability'
);

select ok(
  exists (
    select 1
    from private.step_embedding_job_attempts as attempt_log
    where attempt_log.message_id = current_setting('lemma_test.retry_message_id')::bigint
      and attempt_log.attempt = 5
      and attempt_log.terminal
      and attempt_log.error_message = 'terminal worker error'
  ),
  'terminal worker failure is recorded'
);

select ok(
  exists (
    select 1
    from pgmq.a_lemma_step_embeddings as archived
    where archived.msg_id = current_setting('lemma_test.retry_message_id')::bigint
  ),
  'terminal embedding job is archived'
);

select pass('queued embeddings claim, complete, semantic retrieval, stale protection, and retries succeed');
select * from finish();
rollback;
