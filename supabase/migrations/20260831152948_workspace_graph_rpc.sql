-- Read the complete graph visible to the current workspace owner in one
-- caller-scoped payload. Every query below remains subject to table RLS.
create function public.get_workspace_graph(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  workspace_row public.workspaces%rowtype;
  final_result jsonb;
  context_items jsonb;
  strategies jsonb;
  branches jsonb;
  steps jsonb;
  assumptions jsonb;
  decisions jsonb;
  activity_events jsonb;
  step_dependencies jsonb;
  step_assumptions jsonb;
  sources jsonb;
  step_sources jsonb;
begin
  select workspace.* into workspace_row
  from public.workspaces as workspace
  where workspace.id = p_workspace_id;

  if not found then
    raise exception 'LEMMA_WORKSPACE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select to_jsonb(workspace_result) into final_result
  from public.workspace_results as workspace_result
  where workspace_result.workspace_id = p_workspace_id;

  select coalesce(
    jsonb_agg(to_jsonb(context_item) order by context_item.created_at desc),
    '[]'::jsonb
  ) into context_items
  from public.context_items as context_item
  where context_item.workspace_id = p_workspace_id;

  select coalesce(
    jsonb_agg(to_jsonb(strategy) order by strategy.created_at),
    '[]'::jsonb
  ) into strategies
  from public.strategies as strategy
  where strategy.workspace_id = p_workspace_id;

  select coalesce(
    jsonb_agg(to_jsonb(branch) order by branch.created_at),
    '[]'::jsonb
  ) into branches
  from public.branches as branch
  where branch.workspace_id = p_workspace_id;

  select coalesce(
    jsonb_agg(to_jsonb(step) order by step.updated_at),
    '[]'::jsonb
  ) into steps
  from public.steps as step
  where step.workspace_id = p_workspace_id;

  select coalesce(
    jsonb_agg(to_jsonb(assumption) order by assumption.created_at),
    '[]'::jsonb
  ) into assumptions
  from public.assumptions as assumption
  where assumption.workspace_id = p_workspace_id;

  select coalesce(
    jsonb_agg(to_jsonb(decision) order by decision.created_at),
    '[]'::jsonb
  ) into decisions
  from public.decisions as decision
  where decision.workspace_id = p_workspace_id;

  select coalesce(
    jsonb_agg(to_jsonb(activity_event) order by activity_event.created_at desc),
    '[]'::jsonb
  ) into activity_events
  from (
    select event.*
    from public.activity_events as event
    where event.workspace_id = p_workspace_id
    order by event.created_at desc
    limit 200
  ) as activity_event;

  select coalesce(
    jsonb_agg(to_jsonb(dependency) order by dependency.created_at),
    '[]'::jsonb
  ) into step_dependencies
  from public.step_dependencies as dependency
  where dependency.workspace_id = p_workspace_id;

  select coalesce(
    jsonb_agg(to_jsonb(step_assumption) order by step_assumption.created_at),
    '[]'::jsonb
  ) into step_assumptions
  from public.step_assumptions as step_assumption
  where step_assumption.workspace_id = p_workspace_id;

  select coalesce(
    jsonb_agg(to_jsonb(source) order by source.created_at),
    '[]'::jsonb
  ) into sources
  from public.sources as source
  where source.workspace_id = p_workspace_id;

  select coalesce(
    jsonb_agg(to_jsonb(step_source) order by step_source.created_at),
    '[]'::jsonb
  ) into step_sources
  from public.step_sources as step_source
  where step_source.workspace_id = p_workspace_id;

  return jsonb_build_object(
    'workspace', to_jsonb(workspace_row),
    'final_result', final_result,
    'contextItems', context_items,
    'strategies', strategies,
    'branches', branches,
    'steps', steps,
    'assumptions', assumptions,
    'decisions', decisions,
    'activityEvents', activity_events,
    'stepDependencies', step_dependencies,
    'stepAssumptions', step_assumptions,
    'sources', sources,
    'stepSources', step_sources
  );
end;
$$;

revoke execute on function public.get_workspace_graph(uuid) from public, anon;
grant execute on function public.get_workspace_graph(uuid) to authenticated;

comment on function public.get_workspace_graph(uuid)
  is 'Returns the complete RLS-authorized workspace graph with activity limited to 200 newest events.';
