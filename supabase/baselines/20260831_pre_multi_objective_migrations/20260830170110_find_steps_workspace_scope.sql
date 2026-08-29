-- Search is always isolated to one workspace. A caller can optionally narrow the
-- result set to one strategy, while still being able to discover useful steps
-- from sibling strategies in the same workspace.

drop function public.find_steps(
  uuid, text, extensions.vector, uuid, text, integer, double precision, double precision, integer
);

create function public.find_steps(
  p_workspace_id uuid,
  p_query_text text,
  p_query_embedding extensions.vector(1536) default null,
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
    where document.workspace_id = p_workspace_id
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
    document.workspace_id,
    document.strategy_id,
    strategy.title,
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
  join public.strategies as strategy on strategy.id = document.strategy_id
  order by fused.score desc, document.step_id
  limit (select result_limit from settings);
$$;

revoke execute on function public.find_steps(
  uuid, text, extensions.vector, uuid, uuid, text, integer, double precision, double precision, integer
) from public, anon;

grant execute on function public.find_steps(
  uuid, text, extensions.vector, uuid, uuid, text, integer, double precision, double precision, integer
) to authenticated;

comment on function public.find_steps(
  uuid, text, extensions.vector, uuid, uuid, text, integer, double precision, double precision, integer
) is 'Runs workspace-scoped hybrid search with optional strategy and branch filters, then combines keyword and semantic ranks deterministically.';
