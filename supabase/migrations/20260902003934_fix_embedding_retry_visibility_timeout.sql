-- pgmq 1.5 names the visibility-timeout argument `vt`. The previous
-- named call used `vt_offset`, so retries failed before their message
-- visibility could be extended.
create or replace function public.retry_step_embedding_job(
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
    vt => active_visibility_timeout
  );

  return jsonb_build_object(
    'status', 'retry_scheduled',
    'attempt', p_attempt,
    'visibility_timeout_seconds', active_visibility_timeout
  );
end;
$$;
