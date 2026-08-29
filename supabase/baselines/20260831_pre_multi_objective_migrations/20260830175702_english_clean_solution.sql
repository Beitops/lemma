-- Keep the clean-solution projection consistent with the English product UI.
-- This is an additive replacement of the existing invoker-security RPC.

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
      '**Objective**',
      workspace_row.objective_markdown,
      '**Strategy: ' || strategy_row.title || '**',
      nullif(strategy_row.description_markdown, ''),
      nullif(steps_markdown, '')
    )
  );
end;
$$;

comment on function public.generate_clean_solution(uuid)
  is 'Projects one authorized branch path into an English Markdown solution without mutating graph history.';
