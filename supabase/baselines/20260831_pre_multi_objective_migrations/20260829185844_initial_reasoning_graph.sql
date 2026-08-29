-- Lemma: initial persisted reasoning graph.
-- This migration is intentionally self-contained so a new environment can be
-- brought to the same state with one reviewed, atomic change.

create extension if not exists vector with schema extensions;
create extension if not exists pgtap with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Core workspace and reasoning graph
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  objective_markdown text not null check (
    char_length(btrim(objective_markdown)) between 1 and 100000
  ),
  constraints_markdown text not null default '' check (
    char_length(constraints_markdown) <= 50000
  ),
  status text not null default 'active' check (status in ('active', 'archived')),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.context_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('text', 'note', 'image', 'pdf', 'paper', 'link')),
  title text not null check (char_length(btrim(title)) between 1 and 240),
  body_markdown text check (body_markdown is null or char_length(body_markdown) <= 200000),
  source_url text,
  storage_bucket text,
  storage_path text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  processing_status text not null default 'ready' check (
    processing_status in ('pending', 'ready', 'failed')
  ),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  author_type text not null default 'human' check (author_type in ('human', 'agent', 'system')),
  author_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  author_agent_name text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  check ((storage_bucket is null) = (storage_path is null)),
  check (
    processing_status <> 'ready'
    or num_nonnulls(nullif(btrim(body_markdown), ''), source_url, storage_path) > 0
  ),
  check (
    (author_type = 'human' and author_user_id is not null and author_agent_name is null)
    or (author_type = 'agent' and author_user_id is not null and nullif(btrim(author_agent_name), '') is not null)
    or (author_type = 'system' and author_user_id is null)
  )
);

create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  description_markdown text not null default '' check (
    char_length(description_markdown) <= 100000
  ),
  status text not null default 'active' check (
    status in ('proposed', 'active', 'completed', 'abandoned')
  ),
  author_type text not null default 'human' check (author_type in ('human', 'agent', 'system')),
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

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  strategy_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  status text not null default 'active' check (status in ('active', 'completed', 'dead_end')),
  parent_branch_id uuid,
  forked_from_step_id uuid,
  author_type text not null default 'human' check (author_type in ('human', 'agent', 'system')),
  author_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  author_agent_name text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (id, strategy_id, workspace_id),
  foreign key (strategy_id, workspace_id)
    references public.strategies (id, workspace_id) on delete cascade,
  foreign key (parent_branch_id, strategy_id, workspace_id)
    references public.branches (id, strategy_id, workspace_id) on delete restrict,
  check ((parent_branch_id is null) = (forked_from_step_id is null)),
  check (
    (author_type = 'human' and author_user_id is not null and author_agent_name is null)
    or (author_type = 'agent' and author_user_id is not null and nullif(btrim(author_agent_name), '') is not null)
    or (author_type = 'system' and author_user_id is null)
  )
);

create unique index branches_one_root_per_strategy_idx
  on public.branches (strategy_id)
  where parent_branch_id is null;

create table public.steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  strategy_id uuid not null,
  branch_id uuid not null,
  ordinal integer not null check (ordinal > 0),
  title text not null check (char_length(btrim(title)) between 1 and 240),
  summary text check (summary is null or char_length(summary) <= 2000),
  body_markdown text not null check (char_length(body_markdown) <= 200000),
  concepts text[] not null default '{}'::text[],
  theorem_tags text[] not null default '{}'::text[],
  status text not null default 'active' check (
    status in ('draft', 'active', 'superseded', 'dead_end')
  ),
  supersedes_step_id uuid,
  author_type text not null default 'human' check (author_type in ('human', 'agent', 'system')),
  author_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  author_agent_name text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, ordinal),
  unique (id, workspace_id),
  unique (id, branch_id),
  unique (id, strategy_id, workspace_id),
  foreign key (branch_id, strategy_id, workspace_id)
    references public.branches (id, strategy_id, workspace_id) on delete cascade,
  foreign key (supersedes_step_id, workspace_id)
    references public.steps (id, workspace_id) on delete restrict,
  check (supersedes_step_id is null or supersedes_step_id <> id),
  check (
    (author_type = 'human' and author_user_id is not null and author_agent_name is null)
    or (author_type = 'agent' and author_user_id is not null and nullif(btrim(author_agent_name), '') is not null)
    or (author_type = 'system' and author_user_id is null)
  )
);

alter table public.branches
  add constraint branches_fork_step_parent_fkey
  foreign key (forked_from_step_id, parent_branch_id)
  references public.steps (id, branch_id)
  on delete restrict;

create table public.step_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  step_id uuid not null,
  revision bigint not null check (revision > 0),
  title text not null,
  summary text,
  body_markdown text not null,
  concepts text[] not null,
  theorem_tags text[] not null,
  status text not null,
  changed_by_type text not null check (changed_by_type in ('human', 'agent', 'system')),
  changed_by_user_id uuid references auth.users (id) on delete set null,
  changed_by_agent_name text,
  change_kind text not null check (change_kind in ('created', 'revised')),
  created_at timestamptz not null default now(),
  unique (step_id, revision),
  foreign key (step_id, workspace_id)
    references public.steps (id, workspace_id) on delete cascade
);

create table public.step_dependencies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  step_id uuid not null,
  depends_on_step_id uuid not null,
  relation_kind text not null default 'logical' check (
    relation_kind in ('logical', 'uses_result', 'motivated_by', 'contradicts')
  ),
  rationale_markdown text not null default '' check (char_length(rationale_markdown) <= 20000),
  status text not null default 'active' check (status in ('active', 'removed')),
  author_type text not null default 'human' check (author_type in ('human', 'agent', 'system')),
  author_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  author_agent_name text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (step_id, depends_on_step_id),
  foreign key (step_id, workspace_id)
    references public.steps (id, workspace_id) on delete cascade,
  foreign key (depends_on_step_id, workspace_id)
    references public.steps (id, workspace_id) on delete restrict,
  check (step_id <> depends_on_step_id),
  check (
    (author_type = 'human' and author_user_id is not null and author_agent_name is null)
    or (author_type = 'agent' and author_user_id is not null and nullif(btrim(author_agent_name), '') is not null)
    or (author_type = 'system' and author_user_id is null)
  )
);

create table public.assumptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 160),
  statement_markdown text not null check (
    char_length(btrim(statement_markdown)) between 1 and 100000
  ),
  status text not null default 'proposed' check (
    status in ('proposed', 'accepted', 'challenged', 'rejected', 'discharged')
  ),
  author_type text not null default 'human' check (author_type in ('human', 'agent', 'system')),
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

create table public.step_assumptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  step_id uuid not null,
  assumption_id uuid not null,
  usage_kind text not null default 'used' check (
    usage_kind in ('introduced', 'used', 'challenged', 'discharged')
  ),
  note_markdown text not null default '' check (char_length(note_markdown) <= 20000),
  status text not null default 'active' check (status in ('active', 'removed')),
  author_type text not null default 'human' check (author_type in ('human', 'agent', 'system')),
  author_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  author_agent_name text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (step_id, assumption_id),
  foreign key (step_id, workspace_id)
    references public.steps (id, workspace_id) on delete cascade,
  foreign key (assumption_id, workspace_id)
    references public.assumptions (id, workspace_id) on delete cascade,
  check (
    (author_type = 'human' and author_user_id is not null and author_agent_name is null)
    or (author_type = 'agent' and author_user_id is not null and nullif(btrim(author_agent_name), '') is not null)
    or (author_type = 'system' and author_user_id is null)
  )
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  context_item_id uuid,
  kind text not null check (kind in ('context', 'url', 'paper', 'book', 'theorem', 'other')),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  citation_text text not null default '' check (char_length(citation_text) <= 50000),
  source_url text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  author_type text not null default 'human' check (author_type in ('human', 'agent', 'system')),
  author_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  author_agent_name text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (context_item_id, workspace_id)
    references public.context_items (id, workspace_id) on delete restrict,
  check (
    (author_type = 'human' and author_user_id is not null and author_agent_name is null)
    or (author_type = 'agent' and author_user_id is not null and nullif(btrim(author_agent_name), '') is not null)
    or (author_type = 'system' and author_user_id is null)
  )
);

create table public.step_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  step_id uuid not null,
  source_id uuid not null,
  locator text not null default '' check (char_length(locator) <= 1000),
  note_markdown text not null default '' check (char_length(note_markdown) <= 20000),
  status text not null default 'active' check (status in ('active', 'removed')),
  author_type text not null default 'human' check (author_type in ('human', 'agent', 'system')),
  author_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  author_agent_name text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (step_id, source_id),
  foreign key (step_id, workspace_id)
    references public.steps (id, workspace_id) on delete cascade,
  foreign key (source_id, workspace_id)
    references public.sources (id, workspace_id) on delete cascade,
  check (
    (author_type = 'human' and author_user_id is not null and author_agent_name is null)
    or (author_type = 'agent' and author_user_id is not null and nullif(btrim(author_agent_name), '') is not null)
    or (author_type = 'system' and author_user_id is null)
  )
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  strategy_id uuid,
  branch_id uuid,
  step_id uuid,
  kind text not null default 'human_decision' check (
    kind in ('human_decision', 'human_intervention', 'agent_question')
  ),
  question_markdown text not null check (
    char_length(btrim(question_markdown)) between 1 and 100000
  ),
  status text not null default 'pending' check (status in ('pending', 'resolved', 'cancelled')),
  resolution_markdown text,
  requested_by_type text not null check (requested_by_type in ('human', 'agent', 'system')),
  requested_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  requested_by_agent_name text,
  resolved_by_user_id uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (strategy_id, workspace_id)
    references public.strategies (id, workspace_id) on delete cascade,
  foreign key (branch_id, workspace_id)
    references public.branches (id, workspace_id) on delete cascade,
  foreign key (step_id, workspace_id)
    references public.steps (id, workspace_id) on delete cascade,
  check (num_nonnulls(strategy_id, branch_id, step_id) <= 1),
  check (
    (requested_by_type = 'human' and requested_by_user_id is not null and requested_by_agent_name is null)
    or (requested_by_type = 'agent' and requested_by_user_id is not null and nullif(btrim(requested_by_agent_name), '') is not null)
    or (requested_by_type = 'system' and requested_by_user_id is null)
  ),
  check (
    (status = 'resolved' and resolved_at is not null and nullif(btrim(resolution_markdown), '') is not null)
    or (status <> 'resolved' and resolved_at is null)
  )
);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  actor_type text not null check (actor_type in ('human', 'agent', 'system')),
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_agent_name text,
  entity_revision bigint,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create table public.clean_solution_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  strategy_id uuid not null,
  branch_id uuid not null,
  source_branch_revision bigint not null check (source_branch_revision > 0),
  body_markdown text not null check (char_length(body_markdown) <= 500000),
  created_by_type text not null check (created_by_type in ('human', 'agent', 'system')),
  created_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_by_agent_name text,
  created_at timestamptz not null default now(),
  foreign key (strategy_id, workspace_id)
    references public.strategies (id, workspace_id) on delete cascade,
  foreign key (branch_id, strategy_id, workspace_id)
    references public.branches (id, strategy_id, workspace_id) on delete cascade,
  check (
    (created_by_type = 'human' and created_by_user_id is not null and created_by_agent_name is null)
    or (created_by_type = 'agent' and created_by_user_id is not null and nullif(btrim(created_by_agent_name), '') is not null)
    or (created_by_type = 'system' and created_by_user_id is null)
  )
);

-- Derived/private tables are not exposed through the Data API.
create table private.step_search_documents (
  step_id uuid primary key,
  workspace_id uuid not null,
  strategy_id uuid not null,
  branch_id uuid not null,
  step_revision bigint not null check (step_revision > 0),
  status text not null,
  title text not null,
  search_text text not null,
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(search_text, ''))
  ) stored,
  content_hash text not null,
  embedding extensions.vector(1536),
  embedding_model text,
  embedded_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (step_id, strategy_id, workspace_id)
    references public.steps (id, strategy_id, workspace_id) on delete cascade,
  foreign key (branch_id, strategy_id, workspace_id)
    references public.branches (id, strategy_id, workspace_id) on delete cascade
);

create table private.mutation_receipts (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  idempotency_key text not null check (char_length(btrim(idempotency_key)) between 8 and 200),
  operation text not null check (char_length(operation) between 1 and 100),
  target_id uuid,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- Indexes for ownership checks, joins, navigation and search
-- ---------------------------------------------------------------------------

create index workspaces_owner_updated_idx
  on public.workspaces (owner_id, updated_at desc, id);
create index context_items_workspace_created_idx
  on public.context_items (workspace_id, created_at desc, id);
create index context_items_author_user_id_idx
  on public.context_items (author_user_id) where author_user_id is not null;
create index strategies_workspace_status_idx
  on public.strategies (workspace_id, status, created_at, id);
create index strategies_author_user_id_idx
  on public.strategies (author_user_id) where author_user_id is not null;
create index branches_workspace_status_idx
  on public.branches (workspace_id, status, created_at, id);
create index branches_strategy_status_idx
  on public.branches (strategy_id, status, created_at, id);
create index branches_parent_branch_id_idx
  on public.branches (parent_branch_id) where parent_branch_id is not null;
create index branches_forked_from_step_id_idx
  on public.branches (forked_from_step_id) where forked_from_step_id is not null;
create index branches_author_user_id_idx
  on public.branches (author_user_id) where author_user_id is not null;
create index steps_workspace_updated_idx
  on public.steps (workspace_id, updated_at desc, id);
create index steps_strategy_status_updated_idx
  on public.steps (strategy_id, status, updated_at desc, id);
create index steps_supersedes_step_id_idx
  on public.steps (supersedes_step_id) where supersedes_step_id is not null;
create index steps_author_user_id_idx
  on public.steps (author_user_id) where author_user_id is not null;
create index steps_concepts_idx on public.steps using gin (concepts);
create index steps_theorem_tags_idx on public.steps using gin (theorem_tags);
create index step_revisions_workspace_created_idx
  on public.step_revisions (workspace_id, created_at desc, id);
create index step_revisions_changed_by_user_id_idx
  on public.step_revisions (changed_by_user_id) where changed_by_user_id is not null;
create index step_dependencies_workspace_status_idx
  on public.step_dependencies (workspace_id, status, created_at, id);
create index step_dependencies_depends_on_step_id_idx
  on public.step_dependencies (depends_on_step_id, status);
create index step_dependencies_author_user_id_idx
  on public.step_dependencies (author_user_id) where author_user_id is not null;
create index assumptions_workspace_status_idx
  on public.assumptions (workspace_id, status, updated_at desc, id);
create index assumptions_author_user_id_idx
  on public.assumptions (author_user_id) where author_user_id is not null;
create index step_assumptions_workspace_status_idx
  on public.step_assumptions (workspace_id, status, created_at, id);
create index step_assumptions_assumption_id_idx
  on public.step_assumptions (assumption_id, status);
create index step_assumptions_author_user_id_idx
  on public.step_assumptions (author_user_id) where author_user_id is not null;
create index sources_workspace_created_idx
  on public.sources (workspace_id, created_at desc, id);
create index sources_context_item_id_idx
  on public.sources (context_item_id) where context_item_id is not null;
create index sources_author_user_id_idx
  on public.sources (author_user_id) where author_user_id is not null;
create index step_sources_workspace_status_idx
  on public.step_sources (workspace_id, status, created_at, id);
create index step_sources_source_id_idx
  on public.step_sources (source_id, status);
create index step_sources_author_user_id_idx
  on public.step_sources (author_user_id) where author_user_id is not null;
create index decisions_workspace_status_created_idx
  on public.decisions (workspace_id, status, created_at desc, id);
create index decisions_pending_idx
  on public.decisions (workspace_id, created_at, id) where status = 'pending';
create index decisions_strategy_id_idx
  on public.decisions (strategy_id) where strategy_id is not null;
create index decisions_branch_id_idx
  on public.decisions (branch_id) where branch_id is not null;
create index decisions_step_id_idx
  on public.decisions (step_id) where step_id is not null;
create index decisions_requested_by_user_id_idx
  on public.decisions (requested_by_user_id) where requested_by_user_id is not null;
create index decisions_resolved_by_user_id_idx
  on public.decisions (resolved_by_user_id) where resolved_by_user_id is not null;
create index activity_events_workspace_cursor_idx
  on public.activity_events (workspace_id, created_at desc, id);
create index activity_events_actor_user_id_idx
  on public.activity_events (actor_user_id) where actor_user_id is not null;
create index clean_solution_snapshots_branch_created_idx
  on public.clean_solution_snapshots (branch_id, created_at desc, id);
create index clean_solution_snapshots_workspace_created_idx
  on public.clean_solution_snapshots (workspace_id, created_at desc, id);
create index clean_solution_snapshots_created_by_user_id_idx
  on public.clean_solution_snapshots (created_by_user_id)
  where created_by_user_id is not null;
create index step_search_documents_scope_idx
  on private.step_search_documents (strategy_id, branch_id, status, updated_at desc, step_id);
create index step_search_documents_workspace_idx
  on private.step_search_documents (workspace_id, updated_at desc, step_id);
create index step_search_documents_fts_idx
  on private.step_search_documents using gin (search_vector);

-- ---------------------------------------------------------------------------
-- Shared helpers and safety triggers
-- ---------------------------------------------------------------------------

create or replace function private.is_workspace_owner(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.workspaces as workspace
      where workspace.id = p_workspace_id
        and workspace.owner_id = (select auth.uid())
    );
$$;

revoke execute on function private.is_workspace_owner(uuid) from public, anon;

create or replace function private.prevent_column_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  column_name text;
begin
  foreach column_name in array tg_argv loop
    if (to_jsonb(new) -> column_name) is distinct from (to_jsonb(old) -> column_name) then
      raise exception 'LEMMA_IMMUTABLE_FIELD: % cannot be changed', column_name
        using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

create or replace function private.enforce_revision_bump()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.revision <> old.revision + 1 then
    raise exception 'LEMMA_REVISION_CONFLICT: expected revision %', old.revision + 1
      using errcode = '40001';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function private.enforce_actor_is_caller()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  row_data jsonb := to_jsonb(new);
  type_column text := tg_argv[0];
  user_column text := tg_argv[1];
  actor_kind text;
  actor_user uuid;
begin
  actor_kind := row_data ->> type_column;
  actor_user := nullif(row_data ->> user_column, '')::uuid;

  if (select auth.uid()) is not null then
    if actor_kind not in ('human', 'agent') or actor_user is distinct from (select auth.uid()) then
      raise exception 'LEMMA_ACTOR_MUST_MATCH_CALLER' using errcode = '42501';
    end if;
  elsif actor_kind <> 'system' and current_user not in ('postgres', 'service_role') then
    raise exception 'LEMMA_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function private.set_actor_context(
  p_actor_type text,
  p_actor_agent_name text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_actor_type not in ('human', 'agent') then
    raise exception 'LEMMA_INVALID_ACTOR_TYPE' using errcode = '22023';
  end if;

  if p_actor_type = 'agent' and nullif(btrim(p_actor_agent_name), '') is null then
    raise exception 'LEMMA_AGENT_NAME_REQUIRED' using errcode = '22023';
  end if;

  perform set_config('lemma.actor_type', p_actor_type, true);
  perform set_config('lemma.actor_agent_name', coalesce(p_actor_agent_name, ''), true);
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
  if actor_kind not in ('human', 'agent', 'system') then
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
  if actor_kind not in ('human', 'agent', 'system') then
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
  if actor_kind not in ('human', 'agent', 'system') then
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

create or replace function private.prevent_dependency_cycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status <> 'active' then
    return new;
  end if;

  perform 1
  from public.workspaces
  where id = new.workspace_id
  for update;

  if exists (
    with recursive reachable(step_id) as (
      select dependency.depends_on_step_id
      from public.step_dependencies as dependency
      where dependency.step_id = new.depends_on_step_id
        and dependency.workspace_id = new.workspace_id
        and dependency.status = 'active'
        and dependency.id <> new.id

      union

      select dependency.depends_on_step_id
      from public.step_dependencies as dependency
      join reachable on reachable.step_id = dependency.step_id
      where dependency.workspace_id = new.workspace_id
        and dependency.status = 'active'
        and dependency.id <> new.id
    )
    select 1 from reachable where step_id = new.step_id
  ) then
    raise exception 'LEMMA_DEPENDENCY_CYCLE' using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function private.refresh_step_search(p_step_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  step_row public.steps%rowtype;
  indexable_text text;
  new_hash text;
begin
  select * into step_row
  from public.steps
  where id = p_step_id;

  if not found then
    delete from private.step_search_documents where step_id = p_step_id;
    return;
  end if;

  select concat_ws(
    E'\n\n',
    step_row.title,
    step_row.summary,
    step_row.body_markdown,
    nullif(array_to_string(step_row.concepts, ', '), ''),
    nullif(array_to_string(step_row.theorem_tags, ', '), ''),
    (
      select string_agg(
        concat_ws(': ', assumption.label, assumption.statement_markdown),
        E'\n'
        order by assumption.label, assumption.id
      )
      from public.step_assumptions as relation
      join public.assumptions as assumption on assumption.id = relation.assumption_id
      where relation.step_id = step_row.id
        and relation.status = 'active'
    ),
    (
      select string_agg(
        concat_ws(' — ', source.title, source.citation_text, nullif(relation.locator, '')),
        E'\n'
        order by source.title, source.id
      )
      from public.step_sources as relation
      join public.sources as source on source.id = relation.source_id
      where relation.step_id = step_row.id
        and relation.status = 'active'
    )
  ) into indexable_text;

  new_hash := md5(indexable_text);

  insert into private.step_search_documents as current_document (
    step_id,
    workspace_id,
    strategy_id,
    branch_id,
    step_revision,
    status,
    title,
    search_text,
    content_hash,
    embedding,
    embedding_model,
    embedded_at,
    updated_at
  ) values (
    step_row.id,
    step_row.workspace_id,
    step_row.strategy_id,
    step_row.branch_id,
    step_row.revision,
    step_row.status,
    step_row.title,
    indexable_text,
    new_hash,
    null,
    null,
    null,
    clock_timestamp()
  )
  on conflict (step_id) do update
  set
    workspace_id = excluded.workspace_id,
    strategy_id = excluded.strategy_id,
    branch_id = excluded.branch_id,
    step_revision = excluded.step_revision,
    status = excluded.status,
    title = excluded.title,
    search_text = excluded.search_text,
    content_hash = excluded.content_hash,
    embedding = case
      when current_document.content_hash = excluded.content_hash then current_document.embedding
      else null
    end,
    embedding_model = case
      when current_document.content_hash = excluded.content_hash then current_document.embedding_model
      else null
    end,
    embedded_at = case
      when current_document.content_hash = excluded.content_hash then current_document.embedded_at
      else null
    end,
    updated_at = clock_timestamp();
end;
$$;

create or replace function private.refresh_search_from_step()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_step_search(case when tg_op = 'DELETE' then old.id else new.id end);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.refresh_search_from_step_relation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_step_search(
    case when tg_op = 'DELETE' then old.step_id else new.step_id end
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.refresh_search_from_assumption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_step_id uuid;
begin
  for linked_step_id in
    select relation.step_id
    from public.step_assumptions as relation
    where relation.assumption_id = new.id
      and relation.status = 'active'
  loop
    perform private.refresh_step_search(linked_step_id);
  end loop;
  return new;
end;
$$;

create or replace function private.refresh_search_from_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_step_id uuid;
begin
  for linked_step_id in
    select relation.step_id
    from public.step_sources as relation
    where relation.source_id = new.id
      and relation.status = 'active'
  loop
    perform private.refresh_step_search(linked_step_id);
  end loop;
  return new;
end;
$$;

-- A signed-in caller can only attribute new content to themselves (human or agent).
create trigger a_context_items_actor before insert on public.context_items
for each row execute function private.enforce_actor_is_caller('author_type', 'author_user_id');
create trigger a_strategies_actor before insert on public.strategies
for each row execute function private.enforce_actor_is_caller('author_type', 'author_user_id');
create trigger a_branches_actor before insert on public.branches
for each row execute function private.enforce_actor_is_caller('author_type', 'author_user_id');
create trigger a_steps_actor before insert on public.steps
for each row execute function private.enforce_actor_is_caller('author_type', 'author_user_id');
create trigger a_step_dependencies_actor before insert on public.step_dependencies
for each row execute function private.enforce_actor_is_caller('author_type', 'author_user_id');
create trigger a_assumptions_actor before insert on public.assumptions
for each row execute function private.enforce_actor_is_caller('author_type', 'author_user_id');
create trigger a_step_assumptions_actor before insert on public.step_assumptions
for each row execute function private.enforce_actor_is_caller('author_type', 'author_user_id');
create trigger a_sources_actor before insert on public.sources
for each row execute function private.enforce_actor_is_caller('author_type', 'author_user_id');
create trigger a_step_sources_actor before insert on public.step_sources
for each row execute function private.enforce_actor_is_caller('author_type', 'author_user_id');
create trigger a_decisions_actor before insert on public.decisions
for each row execute function private.enforce_actor_is_caller(
  'requested_by_type', 'requested_by_user_id'
);
create trigger a_clean_solution_snapshots_actor before insert on public.clean_solution_snapshots
for each row execute function private.enforce_actor_is_caller(
  'created_by_type', 'created_by_user_id'
);

-- Keep IDs, ownership, lineage and authorship stable after creation.
create trigger a_context_items_immutable
before update on public.context_items
for each row execute function private.prevent_column_changes(
  'id', 'workspace_id', 'author_type', 'author_user_id', 'author_agent_name'
);
create trigger a_strategies_immutable
before update on public.strategies
for each row execute function private.prevent_column_changes(
  'id', 'workspace_id', 'author_type', 'author_user_id', 'author_agent_name'
);
create trigger a_branches_immutable
before update on public.branches
for each row execute function private.prevent_column_changes(
  'id', 'workspace_id', 'strategy_id', 'parent_branch_id', 'forked_from_step_id',
  'author_type', 'author_user_id', 'author_agent_name'
);
create trigger a_steps_immutable
before update on public.steps
for each row execute function private.prevent_column_changes(
  'id', 'workspace_id', 'strategy_id', 'branch_id', 'ordinal', 'supersedes_step_id',
  'author_type', 'author_user_id', 'author_agent_name'
);
create trigger a_step_dependencies_immutable
before update on public.step_dependencies
for each row execute function private.prevent_column_changes(
  'id', 'workspace_id', 'step_id', 'depends_on_step_id',
  'author_type', 'author_user_id', 'author_agent_name'
);
create trigger a_assumptions_immutable
before update on public.assumptions
for each row execute function private.prevent_column_changes(
  'id', 'workspace_id', 'author_type', 'author_user_id', 'author_agent_name'
);
create trigger a_step_assumptions_immutable
before update on public.step_assumptions
for each row execute function private.prevent_column_changes(
  'id', 'workspace_id', 'step_id', 'assumption_id',
  'author_type', 'author_user_id', 'author_agent_name'
);
create trigger a_sources_immutable
before update on public.sources
for each row execute function private.prevent_column_changes(
  'id', 'workspace_id', 'author_type', 'author_user_id', 'author_agent_name'
);
create trigger a_step_sources_immutable
before update on public.step_sources
for each row execute function private.prevent_column_changes(
  'id', 'workspace_id', 'step_id', 'source_id',
  'author_type', 'author_user_id', 'author_agent_name'
);
create trigger a_decisions_immutable
before update on public.decisions
for each row execute function private.prevent_column_changes(
  'id', 'workspace_id', 'strategy_id', 'branch_id', 'step_id', 'kind',
  'question_markdown', 'requested_by_type', 'requested_by_user_id',
  'requested_by_agent_name'
);

-- Every mutable record must move forward exactly one revision at a time.
create trigger b_workspaces_revision before update on public.workspaces
for each row execute function private.enforce_revision_bump();
create trigger b_context_items_revision before update on public.context_items
for each row execute function private.enforce_revision_bump();
create trigger b_strategies_revision before update on public.strategies
for each row execute function private.enforce_revision_bump();
create trigger b_branches_revision before update on public.branches
for each row execute function private.enforce_revision_bump();
create trigger b_steps_revision before update on public.steps
for each row execute function private.enforce_revision_bump();
create trigger b_step_dependencies_revision before update on public.step_dependencies
for each row execute function private.enforce_revision_bump();
create trigger b_assumptions_revision before update on public.assumptions
for each row execute function private.enforce_revision_bump();
create trigger b_step_assumptions_revision before update on public.step_assumptions
for each row execute function private.enforce_revision_bump();
create trigger b_sources_revision before update on public.sources
for each row execute function private.enforce_revision_bump();
create trigger b_step_sources_revision before update on public.step_sources
for each row execute function private.enforce_revision_bump();
create trigger b_decisions_revision before update on public.decisions
for each row execute function private.enforce_revision_bump();

create trigger c_step_dependencies_no_cycle
before insert or update on public.step_dependencies
for each row execute function private.prevent_dependency_cycle();

create trigger y_steps_revision_history
after insert or update on public.steps
for each row execute function private.record_step_revision();
create trigger y_steps_refresh_search
after insert or update or delete on public.steps
for each row execute function private.refresh_search_from_step();
create trigger y_step_assumptions_refresh_search
after insert or update or delete on public.step_assumptions
for each row execute function private.refresh_search_from_step_relation();
create trigger y_step_sources_refresh_search
after insert or update or delete on public.step_sources
for each row execute function private.refresh_search_from_step_relation();
create trigger y_assumptions_refresh_search
after update on public.assumptions
for each row execute function private.refresh_search_from_assumption();
create trigger y_sources_refresh_search
after update on public.sources
for each row execute function private.refresh_search_from_source();

-- Activity visible to the UI after a human or agent mutation.
create trigger z_workspaces_activity after insert or update on public.workspaces
for each row execute function private.record_activity_event();
create trigger z_context_items_activity after insert or update on public.context_items
for each row execute function private.record_activity_event();
create trigger z_strategies_activity after insert or update on public.strategies
for each row execute function private.record_activity_event();
create trigger z_branches_activity after insert or update on public.branches
for each row execute function private.record_activity_event();
create trigger z_steps_activity after insert or update on public.steps
for each row execute function private.record_activity_event();
create trigger z_assumptions_activity after insert or update on public.assumptions
for each row execute function private.record_activity_event();
create trigger z_sources_activity after insert or update on public.sources
for each row execute function private.record_activity_event();
create trigger z_decisions_activity after insert or update on public.decisions
for each row execute function private.record_activity_event();
create trigger z_clean_solution_snapshots_activity after insert on public.clean_solution_snapshots
for each row execute function private.record_activity_event();
create trigger z_step_dependencies_activity after insert or update on public.step_dependencies
for each row execute function private.record_relation_activity_event();
create trigger z_step_assumptions_activity after insert or update on public.step_assumptions
for each row execute function private.record_relation_activity_event();
create trigger z_step_sources_activity after insert or update on public.step_sources
for each row execute function private.record_relation_activity_event();

-- ---------------------------------------------------------------------------
-- Row-level access rules
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.context_items enable row level security;
alter table public.strategies enable row level security;
alter table public.branches enable row level security;
alter table public.steps enable row level security;
alter table public.step_revisions enable row level security;
alter table public.step_dependencies enable row level security;
alter table public.assumptions enable row level security;
alter table public.step_assumptions enable row level security;
alter table public.sources enable row level security;
alter table public.step_sources enable row level security;
alter table public.decisions enable row level security;
alter table public.activity_events enable row level security;
alter table public.clean_solution_snapshots enable row level security;
alter table private.step_search_documents enable row level security;
alter table private.mutation_receipts enable row level security;

create policy workspaces_select_owner on public.workspaces
for select to authenticated
using ((select auth.uid()) = owner_id);
create policy workspaces_insert_owner on public.workspaces
for insert to authenticated
with check ((select auth.uid()) = owner_id);
create policy workspaces_update_owner on public.workspaces
for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy context_items_select_owner on public.context_items
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));
create policy context_items_insert_owner on public.context_items
for insert to authenticated
with check ((select private.is_workspace_owner(workspace_id)));
create policy context_items_update_owner on public.context_items
for update to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

create policy strategies_select_owner on public.strategies
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));
create policy strategies_insert_owner on public.strategies
for insert to authenticated
with check ((select private.is_workspace_owner(workspace_id)));
create policy strategies_update_owner on public.strategies
for update to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

create policy branches_select_owner on public.branches
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));
create policy branches_insert_owner on public.branches
for insert to authenticated
with check ((select private.is_workspace_owner(workspace_id)));
create policy branches_update_owner on public.branches
for update to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

create policy steps_select_owner on public.steps
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));
create policy steps_insert_owner on public.steps
for insert to authenticated
with check ((select private.is_workspace_owner(workspace_id)));
create policy steps_update_owner on public.steps
for update to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

create policy step_revisions_select_owner on public.step_revisions
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));

create policy step_dependencies_select_owner on public.step_dependencies
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));
create policy step_dependencies_insert_owner on public.step_dependencies
for insert to authenticated
with check ((select private.is_workspace_owner(workspace_id)));
create policy step_dependencies_update_owner on public.step_dependencies
for update to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

create policy assumptions_select_owner on public.assumptions
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));
create policy assumptions_insert_owner on public.assumptions
for insert to authenticated
with check ((select private.is_workspace_owner(workspace_id)));
create policy assumptions_update_owner on public.assumptions
for update to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

create policy step_assumptions_select_owner on public.step_assumptions
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));
create policy step_assumptions_insert_owner on public.step_assumptions
for insert to authenticated
with check ((select private.is_workspace_owner(workspace_id)));
create policy step_assumptions_update_owner on public.step_assumptions
for update to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

create policy sources_select_owner on public.sources
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));
create policy sources_insert_owner on public.sources
for insert to authenticated
with check ((select private.is_workspace_owner(workspace_id)));
create policy sources_update_owner on public.sources
for update to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

create policy step_sources_select_owner on public.step_sources
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));
create policy step_sources_insert_owner on public.step_sources
for insert to authenticated
with check ((select private.is_workspace_owner(workspace_id)));
create policy step_sources_update_owner on public.step_sources
for update to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

create policy decisions_select_owner on public.decisions
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));
create policy decisions_insert_owner on public.decisions
for insert to authenticated
with check ((select private.is_workspace_owner(workspace_id)));
create policy decisions_update_owner on public.decisions
for update to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

create policy activity_events_select_owner on public.activity_events
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));

create policy clean_solution_snapshots_select_owner on public.clean_solution_snapshots
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));
create policy clean_solution_snapshots_insert_owner on public.clean_solution_snapshots
for insert to authenticated
with check ((select private.is_workspace_owner(workspace_id)));

create policy step_search_documents_select_owner on private.step_search_documents
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));
create policy step_search_documents_update_owner on private.step_search_documents
for update to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

create policy mutation_receipts_select_owner on private.mutation_receipts
for select to authenticated
using ((select private.is_workspace_owner(workspace_id)));
create policy mutation_receipts_insert_owner on private.mutation_receipts
for insert to authenticated
with check ((select private.is_workspace_owner(workspace_id)));
create policy mutation_receipts_update_owner on private.mutation_receipts
for update to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

revoke all on table
  public.workspaces,
  public.context_items,
  public.strategies,
  public.branches,
  public.steps,
  public.step_revisions,
  public.step_dependencies,
  public.assumptions,
  public.step_assumptions,
  public.sources,
  public.step_sources,
  public.decisions,
  public.activity_events,
  public.clean_solution_snapshots
from anon, authenticated;

grant usage on schema public to authenticated;
grant select, insert, update on table
  public.workspaces,
  public.context_items,
  public.strategies,
  public.branches,
  public.steps,
  public.step_dependencies,
  public.assumptions,
  public.step_assumptions,
  public.sources,
  public.step_sources,
  public.decisions
to authenticated;
grant select on table public.step_revisions, public.activity_events to authenticated;
grant select, insert on table public.clean_solution_snapshots to authenticated;

grant usage on schema private to authenticated;
grant select, update on table private.step_search_documents to authenticated;
grant select, insert, update on table private.mutation_receipts to authenticated;
grant execute on function private.is_workspace_owner(uuid) to authenticated;
grant execute on function private.set_actor_context(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Private Storage bucket for PDFs, images and other workspace context
-- ---------------------------------------------------------------------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'workspace-context',
  'workspace-context',
  false,
  52428800,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'text/markdown'
  ]
)
on conflict (id) do nothing;

create policy workspace_context_select_owner
on storage.objects for select to authenticated
using (
  bucket_id = 'workspace-context'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy workspace_context_insert_owner
on storage.objects for insert to authenticated
with check (
  bucket_id = 'workspace-context'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy workspace_context_delete_owner
on storage.objects for delete to authenticated
using (
  bucket_id = 'workspace-context'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- No UPDATE policy is intentional: uploaded context objects are immutable.

-- ---------------------------------------------------------------------------
-- Idempotency helpers used by mutation RPCs
-- ---------------------------------------------------------------------------

create or replace function private.claim_mutation(
  p_workspace_id uuid,
  p_idempotency_key text,
  p_operation text
)
returns table (claimed boolean, cached_response jsonb)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  was_claimed boolean := false;
  existing_operation text;
  existing_response jsonb;
begin
  if nullif(btrim(p_idempotency_key), '') is null
    or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'LEMMA_INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;

  if not (select private.is_workspace_owner(p_workspace_id)) then
    raise exception 'LEMMA_WORKSPACE_NOT_FOUND' using errcode = '42501';
  end if;

  insert into private.mutation_receipts (
    workspace_id,
    idempotency_key,
    operation
  ) values (
    p_workspace_id,
    p_idempotency_key,
    p_operation
  )
  on conflict (workspace_id, idempotency_key) do nothing
  returning true into was_claimed;

  if coalesce(was_claimed, false) then
    return query select true, null::jsonb;
    return;
  end if;

  select receipt.operation, receipt.response
  into existing_operation, existing_response
  from private.mutation_receipts as receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;

  if existing_operation is distinct from p_operation then
    raise exception 'LEMMA_IDEMPOTENCY_KEY_REUSED' using errcode = '23505';
  end if;

  if existing_response is null then
    raise exception 'LEMMA_MUTATION_INCOMPLETE' using errcode = '40001';
  end if;

  return query select false, existing_response;
end;
$$;

create or replace function private.finish_mutation(
  p_workspace_id uuid,
  p_idempotency_key text,
  p_target_id uuid,
  p_response jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update private.mutation_receipts
  set target_id = p_target_id,
      response = p_response
  where workspace_id = p_workspace_id
    and idempotency_key = p_idempotency_key;

  if not found then
    raise exception 'LEMMA_MUTATION_RECEIPT_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Transactional mutation RPCs
-- ---------------------------------------------------------------------------

create or replace function public.create_strategy(
  p_workspace_id uuid,
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
  is_new boolean;
  cached jsonb;
  strategy_uuid uuid;
  branch_uuid uuid;
  result jsonb;
begin
  select claimed, cached_response into is_new, cached
  from private.claim_mutation(p_workspace_id, p_idempotency_key, 'create_strategy');
  if not is_new then return cached; end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  insert into public.strategies (
    workspace_id,
    title,
    description_markdown,
    author_type,
    author_user_id,
    author_agent_name
  ) values (
    p_workspace_id,
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
    p_workspace_id,
    strategy_uuid,
    p_root_branch_name,
    p_author_type,
    (select auth.uid()),
    p_author_agent_name
  ) returning id into branch_uuid;

  result := jsonb_build_object(
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

create or replace function public.branch_from_step(
  p_step_id uuid,
  p_name text,
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
  source_step public.steps%rowtype;
  is_new boolean;
  cached jsonb;
  branch_uuid uuid;
  result jsonb;
begin
  select * into source_step from public.steps where id = p_step_id;
  if not found then
    raise exception 'LEMMA_STEP_NOT_FOUND' using errcode = 'P0002';
  end if;

  select claimed, cached_response into is_new, cached
  from private.claim_mutation(
    source_step.workspace_id, p_idempotency_key, 'branch_from_step'
  );
  if not is_new then return cached; end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  insert into public.branches (
    workspace_id,
    strategy_id,
    name,
    parent_branch_id,
    forked_from_step_id,
    author_type,
    author_user_id,
    author_agent_name
  ) values (
    source_step.workspace_id,
    source_step.strategy_id,
    p_name,
    source_step.branch_id,
    source_step.id,
    p_author_type,
    (select auth.uid()),
    p_author_agent_name
  ) returning id into branch_uuid;

  result := jsonb_build_object(
    'branch_id', branch_uuid,
    'branch_revision', 1,
    'parent_branch_id', source_step.branch_id,
    'forked_from_step_id', source_step.id,
    'strategy_id', source_step.strategy_id
  );
  perform private.finish_mutation(
    source_step.workspace_id, p_idempotency_key, branch_uuid, result
  );
  return result;
end;
$$;

create or replace function public.create_step(
  p_branch_id uuid,
  p_title text,
  p_body_markdown text,
  p_expected_branch_revision bigint,
  p_idempotency_key text,
  p_summary text default null,
  p_concepts text[] default '{}'::text[],
  p_theorem_tags text[] default '{}'::text[],
  p_status text default 'active',
  p_supersedes_step_id uuid default null,
  p_author_type text default 'human',
  p_author_agent_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  branch_row public.branches%rowtype;
  old_step public.steps%rowtype;
  is_new boolean;
  cached jsonb;
  next_ordinal integer;
  step_uuid uuid;
  result jsonb;
begin
  select * into branch_row from public.branches where id = p_branch_id;
  if not found then
    raise exception 'LEMMA_BRANCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  select claimed, cached_response into is_new, cached
  from private.claim_mutation(
    branch_row.workspace_id, p_idempotency_key, 'create_step'
  );
  if not is_new then return cached; end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  select * into branch_row
  from public.branches
  where id = p_branch_id
  for update;

  if branch_row.revision <> p_expected_branch_revision then
    raise exception 'LEMMA_REVISION_CONFLICT: branch is at revision %', branch_row.revision
      using errcode = '40001';
  end if;

  if branch_row.status <> 'active' then
    raise exception 'LEMMA_BRANCH_NOT_ACTIVE' using errcode = '23514';
  end if;

  if p_supersedes_step_id is not null then
    select * into old_step
    from public.steps
    where id = p_supersedes_step_id
    for update;

    if not found or old_step.branch_id <> branch_row.id then
      raise exception 'LEMMA_SUPERSEDED_STEP_MUST_SHARE_BRANCH' using errcode = '23514';
    end if;

    update public.steps
    set status = 'superseded', revision = revision + 1
    where id = old_step.id;
  end if;

  select coalesce(max(ordinal), 0) + 1 into next_ordinal
  from public.steps
  where branch_id = p_branch_id;

  insert into public.steps (
    workspace_id,
    strategy_id,
    branch_id,
    ordinal,
    title,
    summary,
    body_markdown,
    concepts,
    theorem_tags,
    status,
    supersedes_step_id,
    author_type,
    author_user_id,
    author_agent_name
  ) values (
    branch_row.workspace_id,
    branch_row.strategy_id,
    branch_row.id,
    next_ordinal,
    p_title,
    p_summary,
    p_body_markdown,
    coalesce(p_concepts, '{}'::text[]),
    coalesce(p_theorem_tags, '{}'::text[]),
    p_status,
    p_supersedes_step_id,
    p_author_type,
    (select auth.uid()),
    p_author_agent_name
  ) returning id into step_uuid;

  update public.branches
  set revision = revision + 1
  where id = branch_row.id;

  result := jsonb_build_object(
    'step_id', step_uuid,
    'step_revision', 1,
    'branch_id', branch_row.id,
    'branch_revision', branch_row.revision + 1,
    'ordinal', next_ordinal
  );
  perform private.finish_mutation(
    branch_row.workspace_id, p_idempotency_key, step_uuid, result
  );
  return result;
end;
$$;

create or replace function public.update_step(
  p_step_id uuid,
  p_expected_revision bigint,
  p_idempotency_key text,
  p_title text default null,
  p_summary text default null,
  p_body_markdown text default null,
  p_concepts text[] default null,
  p_theorem_tags text[] default null,
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
  step_row public.steps%rowtype;
  branch_row public.branches%rowtype;
  is_new boolean;
  cached jsonb;
  result jsonb;
begin
  select * into step_row from public.steps where id = p_step_id;
  if not found then
    raise exception 'LEMMA_STEP_NOT_FOUND' using errcode = 'P0002';
  end if;

  select claimed, cached_response into is_new, cached
  from private.claim_mutation(
    step_row.workspace_id, p_idempotency_key, 'update_step'
  );
  if not is_new then return cached; end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  select * into branch_row
  from public.branches
  where id = step_row.branch_id
  for update;

  update public.steps
  set
    title = coalesce(p_title, title),
    summary = coalesce(p_summary, summary),
    body_markdown = coalesce(p_body_markdown, body_markdown),
    concepts = coalesce(p_concepts, concepts),
    theorem_tags = coalesce(p_theorem_tags, theorem_tags),
    status = coalesce(p_status, status),
    revision = revision + 1
  where id = p_step_id
    and revision = p_expected_revision
  returning * into step_row;

  if not found then
    raise exception 'LEMMA_REVISION_CONFLICT' using errcode = '40001';
  end if;

  update public.branches
  set revision = revision + 1
  where id = branch_row.id;

  result := jsonb_build_object(
    'step_id', step_row.id,
    'step_revision', step_row.revision,
    'branch_id', branch_row.id,
    'branch_revision', branch_row.revision + 1,
    'status', step_row.status
  );
  perform private.finish_mutation(
    step_row.workspace_id, p_idempotency_key, step_row.id, result
  );
  return result;
end;
$$;

create or replace function public.mark_step_dead_end(
  p_step_id uuid,
  p_expected_revision bigint,
  p_idempotency_key text,
  p_author_type text default 'human',
  p_author_agent_name text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select public.update_step(
    p_step_id => p_step_id,
    p_expected_revision => p_expected_revision,
    p_idempotency_key => p_idempotency_key,
    p_status => 'dead_end',
    p_author_type => p_author_type,
    p_author_agent_name => p_author_agent_name
  );
$$;

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
  if not is_new then return cached; end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  select * into branch_row
  from public.branches
  where id = step_row.branch_id
  for update;

  select * into step_row
  from public.steps
  where id = p_step_id
  for update;

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

create or replace function public.request_human_decision(
  p_workspace_id uuid,
  p_question_markdown text,
  p_idempotency_key text,
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
  select claimed, cached_response into is_new, cached
  from private.claim_mutation(
    p_workspace_id, p_idempotency_key, 'request_human_decision'
  );
  if not is_new then return cached; end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  insert into public.decisions (
    workspace_id,
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
    'status', 'pending'
  );
  perform private.finish_mutation(
    p_workspace_id, p_idempotency_key, decision_uuid, result
  );
  return result;
end;
$$;

create or replace function public.resolve_human_decision(
  p_decision_id uuid,
  p_expected_revision bigint,
  p_resolution_markdown text,
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
  decision_row public.decisions%rowtype;
  is_new boolean;
  cached jsonb;
  result jsonb;
begin
  select * into decision_row from public.decisions where id = p_decision_id;
  if not found then
    raise exception 'LEMMA_DECISION_NOT_FOUND' using errcode = 'P0002';
  end if;

  select claimed, cached_response into is_new, cached
  from private.claim_mutation(
    decision_row.workspace_id, p_idempotency_key, 'resolve_human_decision'
  );
  if not is_new then return cached; end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);

  update public.decisions
  set
    status = 'resolved',
    resolution_markdown = p_resolution_markdown,
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
    'resolved_at', decision_row.resolved_at
  );
  perform private.finish_mutation(
    decision_row.workspace_id, p_idempotency_key, decision_row.id, result
  );
  return result;
end;
$$;

create or replace function public.set_step_embedding(
  p_step_id uuid,
  p_embedding extensions.vector(1536),
  p_embedding_model text,
  p_content_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  document_row private.step_search_documents%rowtype;
begin
  update private.step_search_documents
  set
    embedding = p_embedding,
    embedding_model = p_embedding_model,
    embedded_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where step_id = p_step_id
    and content_hash = p_content_hash
  returning * into document_row;

  if not found then
    raise exception 'LEMMA_STALE_EMBEDDING_INPUT' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'step_id', document_row.step_id,
    'step_revision', document_row.step_revision,
    'content_hash', document_row.content_hash,
    'embedding_model', document_row.embedding_model,
    'embedded_at', document_row.embedded_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Read-only RPCs used by the API and WebMCP tools
-- ---------------------------------------------------------------------------

create or replace function public.get_branch_path(p_branch_id uuid)
returns table (
  path_position bigint,
  step_id uuid,
  owning_branch_id uuid,
  ordinal integer,
  title text,
  summary text,
  body_markdown text,
  concepts text[],
  theorem_tags text[],
  status text,
  author_type text,
  author_user_id uuid,
  author_agent_name text,
  revision bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive lineage (
    branch_id,
    parent_branch_id,
    forked_from_step_id,
    depth,
    child_fork_step_id
  ) as (
    select
      branch.id,
      branch.parent_branch_id,
      branch.forked_from_step_id,
      0,
      null::uuid
    from public.branches as branch
    where branch.id = p_branch_id

    union all

    select
      parent.id,
      parent.parent_branch_id,
      parent.forked_from_step_id,
      lineage.depth + 1,
      lineage.forked_from_step_id
    from lineage
    join public.branches as parent on parent.id = lineage.parent_branch_id
  ),
  selected_steps as (
    select lineage.depth, step.*
    from lineage
    join public.steps as step on step.branch_id = lineage.branch_id
    left join public.steps as cutoff on cutoff.id = lineage.child_fork_step_id
    where lineage.child_fork_step_id is null
       or step.ordinal <= cutoff.ordinal
  )
  select
    row_number() over (order by selected_steps.depth desc, selected_steps.ordinal),
    selected_steps.id,
    selected_steps.branch_id,
    selected_steps.ordinal,
    selected_steps.title,
    selected_steps.summary,
    selected_steps.body_markdown,
    selected_steps.concepts,
    selected_steps.theorem_tags,
    selected_steps.status,
    selected_steps.author_type,
    selected_steps.author_user_id,
    selected_steps.author_agent_name,
    selected_steps.revision
  from selected_steps
  order by selected_steps.depth desc, selected_steps.ordinal;
$$;

create or replace function public.find_steps(
  p_strategy_id uuid,
  p_query_text text,
  p_query_embedding extensions.vector(1536) default null,
  p_branch_id uuid default null,
  p_status text default null,
  p_top_k integer default 10,
  p_full_text_weight double precision default 1,
  p_semantic_weight double precision default 1,
  p_rrf_k integer default 50
)
returns table (
  step_id uuid,
  branch_id uuid,
  title text,
  snippet text,
  status text,
  step_revision bigint,
  full_text_rank bigint,
  semantic_rank bigint,
  combined_score double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with settings as (
    select
      websearch_to_tsquery('simple', p_query_text) as text_query,
      least(greatest(p_top_k, 1), 20) as result_limit,
      least(greatest(p_top_k, 1), 20) * 3 as candidate_limit
  ),
  scoped as (
    select document.*
    from private.step_search_documents as document
    where document.strategy_id = p_strategy_id
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
        order by scoped.embedding operator(extensions.<=>) p_query_embedding,
          scoped.step_id
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

  with path_a as (
    select * from public.get_branch_path(p_branch_a_id)
  ),
  path_b as (
    select * from public.get_branch_path(p_branch_b_id)
  )
  select jsonb_build_object(
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
  workspace_row public.workspaces%rowtype;
  steps_markdown text;
  active_step_count integer;
begin
  select * into branch_row from public.branches where id = p_branch_id;
  if not found then
    raise exception 'LEMMA_BRANCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into strategy_row
  from public.strategies
  where id = branch_row.strategy_id;

  select * into workspace_row
  from public.workspaces
  where id = branch_row.workspace_id;

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
    'strategy_id', strategy_row.id,
    'branch_id', branch_row.id,
    'branch_revision', branch_row.revision,
    'step_count', coalesce(active_step_count, 0),
    'body_markdown', concat_ws(
      E'\n\n',
      '# ' || workspace_row.title,
      '**Objetivo**',
      workspace_row.objective_markdown,
      '**Estrategia: ' || strategy_row.title || '**',
      nullif(strategy_row.description_markdown, ''),
      nullif(steps_markdown, '')
    )
  );
end;
$$;

create or replace function public.save_clean_solution_snapshot(
  p_branch_id uuid,
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
  branch_row public.branches%rowtype;
  projection jsonb;
  is_new boolean;
  cached jsonb;
  snapshot_uuid uuid;
  result jsonb;
begin
  select * into branch_row from public.branches where id = p_branch_id;
  if not found then
    raise exception 'LEMMA_BRANCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  select claimed, cached_response into is_new, cached
  from private.claim_mutation(
    branch_row.workspace_id, p_idempotency_key, 'save_clean_solution_snapshot'
  );
  if not is_new then return cached; end if;

  perform private.set_actor_context(p_author_type, p_author_agent_name);
  projection := public.generate_clean_solution(p_branch_id);

  insert into public.clean_solution_snapshots (
    workspace_id,
    strategy_id,
    branch_id,
    source_branch_revision,
    body_markdown,
    created_by_type,
    created_by_user_id,
    created_by_agent_name
  ) values (
    branch_row.workspace_id,
    branch_row.strategy_id,
    branch_row.id,
    branch_row.revision,
    projection ->> 'body_markdown',
    p_author_type,
    (select auth.uid()),
    p_author_agent_name
  ) returning id into snapshot_uuid;

  result := jsonb_build_object(
    'snapshot_id', snapshot_uuid,
    'branch_id', branch_row.id,
    'source_branch_revision', branch_row.revision,
    'body_markdown', projection ->> 'body_markdown'
  );
  perform private.finish_mutation(
    branch_row.workspace_id, p_idempotency_key, snapshot_uuid, result
  );
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function permissions and short descriptions for API consumers
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_workspace_owner(uuid) to authenticated;
grant execute on function private.set_actor_context(text, text) to authenticated;
grant execute on function private.claim_mutation(uuid, text, text) to authenticated;
grant execute on function private.finish_mutation(uuid, text, uuid, jsonb) to authenticated;

revoke execute on function public.create_strategy(uuid, text, text, text, text, text, text)
  from public, anon;
revoke execute on function public.branch_from_step(uuid, text, text, text, text)
  from public, anon;
revoke execute on function public.create_step(
  uuid, text, text, bigint, text, text, text[], text[], text, uuid, text, text
) from public, anon;
revoke execute on function public.update_step(
  uuid, bigint, text, text, text, text, text[], text[], text, text, text
) from public, anon;
revoke execute on function public.mark_step_dead_end(uuid, bigint, text, text, text)
  from public, anon;
revoke execute on function public.mark_assumption(
  uuid, text, text, text, text, text, text, text, text
) from public, anon;
revoke execute on function public.request_human_decision(
  uuid, text, text, uuid, uuid, uuid, text, text, text
) from public, anon;
revoke execute on function public.resolve_human_decision(
  uuid, bigint, text, text, text, text
) from public, anon;
revoke execute on function public.set_step_embedding(
  uuid, extensions.vector, text, text
) from public, anon;
revoke execute on function public.get_branch_path(uuid) from public, anon;
revoke execute on function public.find_steps(
  uuid, text, extensions.vector, uuid, text, integer, double precision, double precision, integer
) from public, anon;
revoke execute on function public.compare_branches(uuid, uuid) from public, anon;
revoke execute on function public.generate_clean_solution(uuid) from public, anon;
revoke execute on function public.save_clean_solution_snapshot(uuid, text, text, text)
  from public, anon;

grant execute on function public.create_strategy(uuid, text, text, text, text, text, text)
  to authenticated;
grant execute on function public.branch_from_step(uuid, text, text, text, text)
  to authenticated;
grant execute on function public.create_step(
  uuid, text, text, bigint, text, text, text[], text[], text, uuid, text, text
) to authenticated;
grant execute on function public.update_step(
  uuid, bigint, text, text, text, text, text[], text[], text, text, text
) to authenticated;
grant execute on function public.mark_step_dead_end(uuid, bigint, text, text, text)
  to authenticated;
grant execute on function public.mark_assumption(
  uuid, text, text, text, text, text, text, text, text
) to authenticated;
grant execute on function public.request_human_decision(
  uuid, text, text, uuid, uuid, uuid, text, text, text
) to authenticated;
grant execute on function public.resolve_human_decision(
  uuid, bigint, text, text, text, text
) to authenticated;
grant execute on function public.set_step_embedding(
  uuid, extensions.vector, text, text
) to authenticated;
grant execute on function public.get_branch_path(uuid) to authenticated;
grant execute on function public.find_steps(
  uuid, text, extensions.vector, uuid, text, integer, double precision, double precision, integer
) to authenticated;
grant execute on function public.compare_branches(uuid, uuid) to authenticated;
grant execute on function public.generate_clean_solution(uuid) to authenticated;
grant execute on function public.save_clean_solution_snapshot(uuid, text, text, text)
  to authenticated;

comment on function public.create_strategy(uuid, text, text, text, text, text, text)
  is 'Creates a strategy and its root branch atomically. Reuses the result when retried with the same idempotency key.';
comment on function public.branch_from_step(uuid, text, text, text, text)
  is 'Creates a child branch at an existing step without copying or deleting the parent path.';
comment on function public.create_step(
  uuid, text, text, bigint, text, text, text[], text[], text, uuid, text, text
) is 'Appends one step to an active branch with optimistic concurrency and optional supersession.';
comment on function public.update_step(
  uuid, bigint, text, text, text, text, text[], text[], text, text, text
) is 'Updates a step only when its expected revision is current and preserves a revision snapshot.';
comment on function public.find_steps(
  uuid, text, extensions.vector, uuid, text, integer, double precision, double precision, integer
) is 'Runs strategy-scoped hybrid search and combines keyword and semantic ranks deterministically.';
comment on function public.generate_clean_solution(uuid)
  is 'Builds a Markdown projection of one branch without mutating or deleting graph history.';
