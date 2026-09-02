-- Structural checks for the multi-objective schema (`supabase test db`).

begin;
set local search_path = public, extensions;

select plan(88);

select has_extension('vector', 'pgvector is installed');
select has_extension('pgtap', 'pgTAP is installed');
select has_extension('pgmq', 'pgmq is installed for durable embedding jobs');
select has_extension('pg_net', 'pg_net is installed for the embedding worker invoker');
select has_extension('pg_cron', 'pg_cron is installed for the embedding worker scheduler');
select has_schema('private', 'private helper schema exists');

select ok(
  (
    select format_type(attribute.atttypid, attribute.atttypmod)
    from pg_attribute as attribute
    where attribute.attrelid = 'private.step_search_documents'::regclass
      and attribute.attname = 'embedding'
      and not attribute.attisdropped
  ) like '%vector(384)',
  'step embeddings use the active 384-dimensional vector type'
);
select ok(
  to_regclass('pgmq.q_lemma_step_embeddings') is not null
  and to_regclass('pgmq.a_lemma_step_embeddings') is not null,
  'the durable embedding queue and archive exist'
);
select ok(
  exists (
    select 1
    from pg_trigger as trigger_row
    where trigger_row.tgrelid = 'private.step_search_documents'::regclass
      and trigger_row.tgname = 'z_step_search_documents_enqueue_embedding'
      and not trigger_row.tgisinternal
  ),
  'search-document content changes enqueue embedding work'
);
select ok(
  exists (
    select 1
    from cron.job as job
    where job.jobname = 'lemma-step-embedding-worker'
      and job.schedule = '30 seconds'
      and job.command = 'select private.invoke_embedding_worker();'
  ),
  'the embedding worker cron job is scheduled every thirty seconds'
);
select ok(
  pg_get_functiondef('private.invoke_embedding_worker()'::regprocedure)
    ~* 'no_visible_jobs',
  'the invoker skips HTTP when the embedding queue has no visible work'
);
select ok(
  exists (
    select 1
    from vault.decrypted_secrets as secret
    where secret.name = 'lemma_embedding_worker_token'
  ),
  'the embedding worker token is stored in Vault'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_step_embedding_jobs(text,integer,integer)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.complete_step_embedding_job(text,bigint,uuid,text,extensions.vector,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.retry_step_embedding_job(text,bigint,integer,text,integer)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_step_embedding_jobs(text,integer,integer)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.complete_step_embedding_job(text,bigint,uuid,text,extensions.vector,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.retry_step_embedding_job(text,bigint,integer,text,integer)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.claim_step_embedding_jobs(text,integer,integer)',
    'execute'
  ),
  'embedding worker RPCs are executable only by service_role'
);
select ok(
  to_regprocedure('public.set_step_embedding(uuid,extensions.vector,text,text)') is null
  and not has_table_privilege('authenticated', 'private.step_search_documents', 'update'),
  'authenticated callers cannot set embeddings or update search documents directly'
);
select ok(
  pg_get_functiondef(
    'public.find_steps(uuid,text,extensions.vector,uuid,uuid,uuid,text,integer,double precision,double precision,integer,text)'::regprocedure
  ) ~* 'not materialized'
  and pg_get_functiondef(
    'public.find_steps(uuid,text,extensions.vector,uuid,uuid,uuid,text,integer,double precision,double precision,integer,text)'::regprocedure
  ) ~* 'embedding_model = p_embedding_model',
  'find_steps inlines scope candidates and filters semantic rows by model'
);

select has_table('public', 'workspaces', 'workspaces table exists');
select has_table('public', 'objectives', 'objectives table exists');
select has_table('public', 'context_items', 'context_items table exists');
select has_table('public', 'strategies', 'strategies table exists');
select has_table('public', 'reasoning_results', 'reasoning_results table exists');
select has_table('private', 'workspace_creation_receipts', 'workspace creation receipts exist');
select ok(to_regclass('public.workspace_results') is null, 'legacy workspace_results is removed');

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workspaces'
      and column_name = 'objective_markdown'
  ),
  'workspaces no longer own objective_markdown'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workspaces'
      and column_name = 'constraints_markdown'
  ),
  'workspaces no longer own constraints_markdown'
);
select ok(
  exists (
    select 1
    from pg_constraint as con_row
    where con_row.conrelid = 'public.objectives'::regclass
      and con_row.contype = 'c'
      and pg_get_constraintdef(con_row.oid) like '%active%completed%archived%'
  ),
  'objectives constrain status to active, completed, or archived'
);
select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'strategies'
      and column_name = 'objective_id'
      and is_nullable = 'NO'
  ),
  'strategies require objective_id'
);
select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'context_items'
      and column_name = 'objective_id'
      and is_nullable = 'YES'
  ),
  'context_items can be workspace-general'
);
select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'decisions'
      and column_name = 'objective_id'
      and is_nullable = 'YES'
  ),
  'decisions can target an objective'
);
select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'activity_events'
      and column_name = 'objective_id'
      and is_nullable = 'YES'
  ),
  'activity events can carry objective scope'
);

select ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'activity_events'
  ),
  'activity events are published as the bounded Realtime invalidation stream'
);
select ok(
  to_regprocedure(
    'public.mark_assumption(uuid,bigint,text,text,text,text,text,text,text,text)'
  ) is not null,
  'mark_assumption exposes the revision-checked signature'
);
select ok(
  to_regprocedure(
    'public.mark_assumption(uuid,text,text,text,text,text,text,text,text)'
  ) is not null,
  'the deprecated mark_assumption wrapper remains available for a safe Edge rollout'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.mark_assumption(uuid,bigint,text,text,text,text,text,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.mark_assumption(uuid,bigint,text,text,text,text,text,text,text,text)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.mark_assumption(uuid,text,text,text,text,text,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.mark_assumption(uuid,text,text,text,text,text,text,text,text)',
    'execute'
  ),
  'only authenticated callers can execute either assumption mutation signature'
);

select ok((select relrowsecurity from pg_class where oid = 'public.objectives'::regclass), 'objectives has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.reasoning_results'::regclass), 'reasoning_results has RLS');
select ok((select relrowsecurity from pg_class where oid = 'private.workspace_creation_receipts'::regclass), 'workspace creation receipts has RLS');
select ok(
  (
    select bool_and(class.relrowsecurity)
    from pg_class as class
    join pg_namespace as namespace on namespace.oid = class.relnamespace
    where class.relkind = 'r'
      and (namespace.nspname, class.relname) in (
        ('public', 'workspaces'), ('public', 'objectives'), ('public', 'context_items'),
        ('public', 'strategies'), ('public', 'branches'), ('public', 'steps'),
        ('public', 'step_dependencies'), ('public', 'decisions'),
        ('public', 'activity_events'), ('public', 'reasoning_results'),
        ('private', 'step_search_documents'), ('private', 'step_embedding_job_attempts'),
        ('private', 'mutation_receipts'),
        ('private', 'workspace_creation_receipts')
      )
  ),
  'RLS remains enabled on all exposed and private multi-objective tables'
);

select ok(
  exists (
    select 1 from pg_constraint as con_row
    where con_row.conrelid = 'public.context_items'::regclass
      and con_row.contype = 'f'
      and pg_get_constraintdef(con_row.oid) like 'FOREIGN KEY (objective_id, workspace_id)%'
  ),
  'context objective FK also fixes its workspace'
);
select ok(
  exists (
    select 1 from pg_constraint as con_row
    where con_row.conrelid = 'public.strategies'::regclass
      and con_row.contype = 'f'
      and pg_get_constraintdef(con_row.oid) like 'FOREIGN KEY (objective_id, workspace_id)%'
  ),
  'strategy objective FK also fixes its workspace'
);
select ok(
  exists (
    select 1 from pg_constraint as con_row
    where con_row.conrelid = 'public.decisions'::regclass
      and con_row.contype = 'f'
      and pg_get_constraintdef(con_row.oid) like 'FOREIGN KEY (objective_id, workspace_id)%'
  ),
  'decision objective FK also fixes its workspace'
);
select ok(
  exists (
    select 1 from pg_constraint as con_row
    where con_row.conrelid = 'public.activity_events'::regclass
      and con_row.contype = 'f'
      and pg_get_constraintdef(con_row.oid) like 'FOREIGN KEY (objective_id, workspace_id)%'
  ),
  'activity objective FK also fixes its workspace'
);
select ok(
  exists (
    select 1 from pg_constraint as con_row
    where con_row.conrelid = 'public.reasoning_results'::regclass
      and con_row.contype = 'f'
      and pg_get_constraintdef(con_row.oid) like 'FOREIGN KEY (objective_id, workspace_id)%'
  ),
  'reasoning result objective FK also fixes its workspace'
);
select ok(
  exists (
    select 1 from pg_constraint as con_row
    where con_row.conrelid = 'public.reasoning_results'::regclass
      and con_row.contype = 'f'
      and pg_get_constraintdef(con_row.oid) like 'FOREIGN KEY (strategy_id, objective_id, workspace_id)%'
  ),
  'reasoning result strategy FK fixes strategy, objective, and workspace'
);
select ok(
  exists (
    select 1 from pg_constraint as con_row
    where con_row.conrelid = 'public.reasoning_results'::regclass
      and con_row.contype = 'f'
      and pg_get_constraintdef(con_row.oid) like 'FOREIGN KEY (branch_id, strategy_id, workspace_id)%'
  ),
  'reasoning result branch FK fixes branch, strategy, and workspace'
);
select ok(
  (
    select count(*)
    from pg_attribute as attribute
    where attribute.attrelid = 'public.reasoning_results'::regclass
      and attribute.attname in ('target_type', 'target_id')
      and attribute.attgenerated = 's'
  ) = 2,
  'result target_type and target_id are derived columns'
);
select ok(
  exists (
    select 1 from pg_constraint as con_row
    where con_row.conrelid = 'public.reasoning_results'::regclass
      and con_row.contype = 'c'
      and pg_get_constraintdef(con_row.oid) like '%target_type = ''strategy''%target_type = ''branch''%'
  ),
  'result target check keeps target type coherent with branch_id'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'reasoning_results_one_strategy_target_idx'
      and indexdef like '%UNIQUE%'
      and indexdef like '%WHERE (branch_id IS NULL)%'
  ),
  'at most one strategy-targeted result exists per strategy'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'reasoning_results_one_branch_target_idx'
      and indexdef like '%UNIQUE%'
      and indexdef like '%WHERE (branch_id IS NOT NULL)%'
  ),
  'at most one branch-targeted result exists per branch'
);

select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'context_items_objective_workspace_fk_idx'), 'context FK has a child-side index');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'decisions_objective_workspace_fk_idx'), 'decision FK has a child-side index');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'activity_events_objective_workspace_fk_idx'), 'activity FK has a child-side index');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'reasoning_results_objective_workspace_fk_idx'), 'result objective FK has a child-side index');
select ok(exists (select 1 from pg_indexes where schemaname = 'private' and indexname = 'workspace_creation_receipts_workspace_fk_idx'), 'workspace creation receipt FK has a child-side index');

select ok(exists (select 1 from pg_trigger where tgrelid = 'public.context_items'::regclass and tgname = 'a_context_items_immutable' and not tgisinternal), 'context scope is immutable');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.strategies'::regclass and tgname = 'a_strategies_immutable' and not tgisinternal), 'strategy objective scope is immutable');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.step_dependencies'::regclass and tgname = 'b_step_dependencies_same_objective' and not tgisinternal), 'dependencies enforce one objective');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.step_sources'::regclass and tgname = 'a_step_sources_context_scope' and not tgisinternal), 'specific context source links enforce one objective');

select ok(
  to_regprocedure('public.find_steps(uuid,text,extensions.vector,uuid,uuid,uuid,text,integer,double precision,double precision,integer,text)') is not null,
  'find_steps accepts optional scope filters and an embedding-model filter'
);
select ok(
  to_regprocedure('public.find_steps(uuid,text,extensions.vector,uuid,uuid,uuid,text,integer,double precision,double precision,integer)') is null,
  'unversioned find_steps signature is removed'
);
select ok(to_regprocedure('public.create_workspace(text,text,text,text)') is not null, 'create_workspace RPC exists');
select ok(to_regprocedure('public.update_workspace(uuid,bigint,text,text,text,text,text)') is not null, 'update_workspace RPC exists');
select ok(to_regprocedure('public.create_objective(uuid,text,text,text,text,text,text)') is not null, 'create_objective RPC exists');
select ok(to_regprocedure('public.update_objective(uuid,uuid,bigint,text,text,text,text,text,text,text)') is not null, 'update_objective RPC exists');
select ok(
  to_regprocedure('public.create_context_item(uuid,uuid,text,text,text,text,uuid,text,text,text,text,text,bigint,jsonb,text,text,text)') is not null,
  'idempotent context creation RPC exists'
);
select ok(to_regprocedure('public.create_strategy(uuid,uuid,text,text,text,text,text,text)') is not null, 'objective-scoped create_strategy RPC exists');
select ok(
  to_regprocedure(
    'public.create_step(uuid,text,text,bigint,text,text,text[],text[],text,uuid,text,text,uuid[])'
  ) is not null
  and to_regprocedure(
    'public.create_step(uuid,text,text,bigint,text,text,text[],text[],text,uuid,text,text)'
  ) is null,
  'create_step has one dependency-aware signature and the legacy overload is removed'
);
select ok(
  exists (
    select 1
    from pg_proc as procedure
    join pg_language as language on language.oid = procedure.prolang
    where procedure.oid = (
      'public.create_step(uuid,text,text,bigint,text,text,text[],text[],text,uuid,text,text,uuid[])'
    )::regprocedure
      and language.lanname = 'plpgsql'
      and not procedure.prosecdef
  )
  and has_function_privilege(
    'authenticated',
    'public.create_step(uuid,text,text,bigint,text,text,text[],text[],text,uuid,text,text,uuid[])',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.create_step(uuid,text,text,bigint,text,text,text[],text[],text,uuid,text,text,uuid[])',
    'execute'
  ),
  'dependency-aware create_step is security-invoker and executable only by authenticated callers'
);
select ok(
  to_regprocedure('public.create_step_dependency(uuid,uuid,uuid,uuid,text,text)') is not null
  and to_regprocedure('public.create_step_dependency(uuid,uuid,uuid,text,text,text)') is null,
  'agent-aware create_step_dependency uses UUID idempotency and explicit source/target arguments'
);
select ok(
  exists (
    select 1
    from pg_proc as procedure
    join pg_language as language on language.oid = procedure.prolang
    where procedure.oid = 'public.create_step_dependency(uuid,uuid,uuid,uuid,text,text)'::regprocedure
      and language.lanname = 'plpgsql'
      and not procedure.prosecdef
  )
  and has_function_privilege(
    'authenticated',
    'public.create_step_dependency(uuid,uuid,uuid,uuid,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.create_step_dependency(uuid,uuid,uuid,uuid,text,text)',
    'execute'
  ),
  'step dependency mutation is security-invoker and executable only by authenticated callers'
);
select ok(to_regprocedure('public.set_reasoning_result(uuid,uuid,text,uuid,bigint,bigint,text,text,text,text,text)') is not null, 'set_reasoning_result RPC exists');
select ok(to_regprocedure('public.request_human_decision(uuid,text,text,uuid,uuid,uuid,uuid,text,text,text)') is not null, 'objective-targeted decision RPC exists');
select ok(to_regprocedure('public.get_workspace_overview(uuid)') is not null, 'get_workspace_overview RPC exists');
select ok(to_regprocedure('public.get_objective_graph(uuid)') is not null, 'get_objective_graph RPC exists');
select ok(to_regprocedure('public.get_context(uuid,uuid)') is not null, 'get_context RPC exists');
select ok(to_regprocedure('public.get_general_context(uuid)') is not null, 'get_general_context RPC exists');
select ok(to_regprocedure('public.list_workspace_summaries()') is not null, 'list_workspace_summaries RPC exists');
select ok(to_regprocedure('public.get_workspace_graph(uuid)') is null, 'legacy workspace graph RPC is removed');
select ok(
  exists (
    select 1
    from pg_proc as procedure
    join pg_language as language on language.oid = procedure.prolang
    where procedure.oid = 'public.get_objective_graph(uuid)'::regprocedure
      and language.lanname = 'plpgsql'
      and procedure.provolatile = 's'
      and not procedure.prosecdef
  ),
  'objective graph is a stable security-invoker function'
);
select ok(
  has_function_privilege('authenticated', 'public.get_objective_graph(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.get_objective_graph(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.create_context_item(uuid,uuid,text,text,text,text,uuid,text,text,text,text,text,bigint,jsonb,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.create_context_item(uuid,uuid,text,text,text,text,uuid,text,text,text,text,text,bigint,jsonb,text,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.set_reasoning_result(uuid,uuid,text,uuid,bigint,bigint,text,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.set_reasoning_result(uuid,uuid,text,uuid,bigint,bigint,text,text,text,text,text)', 'execute'),
  'new graph and result RPCs are executable only by authenticated callers'
);
select ok(
  exists (select 1 from storage.buckets where id = 'workspace-context' and not public),
  'workspace-context remains private'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'decisions'
      and column_name = 'resolution_outcome'
      and is_nullable = 'YES'
  ),
  'decisions retain a nullable typed resolution outcome for legacy rows'
);
select ok(
  exists (
    select 1
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.decisions'::regclass
      and constraint_row.conname = 'decisions_resolution_outcome_check'
      and constraint_row.convalidated
      and pg_get_constraintdef(constraint_row.oid) like '%accepted%'
      and pg_get_constraintdef(constraint_row.oid) like '%redirected%'
  ),
  'decision outcome is constrained to accepted or redirected when present'
);
select ok(
  exists (
    select 1
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.decisions'::regclass
      and constraint_row.conname = 'decisions_resolution_outcome_requires_resolution_check'
      and constraint_row.convalidated
  ),
  'typed decision outcomes require a resolved decision and the check is validated'
);
select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'decisions_pending_idx'
      and indexdef like '%(workspace_id, created_at, id)%'
      and indexdef like '%WHERE (status = ''pending''::text)%'
  ),
  'pending decision inbox has a partial workspace and deterministic-order index'
);
select ok(
  to_regprocedure('public.resolve_human_decision(uuid,bigint,text,text,text)') is not null
  and to_regprocedure('public.resolve_human_decision(uuid,bigint,text,text,text,text)') is null,
  'human resolution uses the typed five-argument RPC without caller-selected author fields'
);
select ok(
  exists (
    select 1
    from pg_proc as procedure
    join pg_language as language on language.oid = procedure.prolang
    where procedure.oid = 'public.list_pending_decisions(uuid)'::regprocedure
      and language.lanname = 'plpgsql'
      and procedure.provolatile = 's'
      and not procedure.prosecdef
  ),
  'pending-decision inbox is a stable security-invoker RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.list_pending_decisions(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.list_pending_decisions(uuid)', 'execute')
  and has_function_privilege(
    'authenticated',
    'public.resolve_human_decision(uuid,bigint,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.resolve_human_decision(uuid,bigint,text,text,text)',
    'execute'
  ),
  'only authenticated callers can list or resolve human decisions'
);
select ok(
  pg_get_functiondef(
    'public.request_human_decision(uuid,text,text,uuid,uuid,uuid,uuid,text,text,text)'::regprocedure
  ) ~* 'ancestry',
  'decision requests return derived graph ancestry for navigation'
);

select * from finish();
rollback;
