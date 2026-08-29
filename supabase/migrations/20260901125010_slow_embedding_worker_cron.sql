-- Keep the worker invocation below the embedding provider's concurrent-session limit.
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
    '30 seconds',
    'select private.invoke_embedding_worker();'
  );
end;
$$;
