-- The auto-RLS event-trigger function existed before Lemma's schema. It needs
-- no direct API access, so remove the inherited EXECUTE permission.
revoke execute on function public.rls_auto_enable()
from public, anon, authenticated;

-- Cover every multi-column foreign key in its declared column order. These
-- indexes keep joins and cascades predictable as the graph grows.
create index if not exists step_search_documents_branch_fk_idx
  on private.step_search_documents (branch_id, strategy_id, workspace_id);
create index if not exists step_search_documents_step_fk_idx
  on private.step_search_documents (step_id, strategy_id, workspace_id);
create index if not exists branches_fork_step_parent_fk_idx
  on public.branches (forked_from_step_id, parent_branch_id);
create index if not exists branches_parent_strategy_workspace_fk_idx
  on public.branches (parent_branch_id, strategy_id, workspace_id);
create index if not exists branches_strategy_workspace_fk_idx
  on public.branches (strategy_id, workspace_id);
create index if not exists clean_solution_snapshots_branch_fk_idx
  on public.clean_solution_snapshots (branch_id, strategy_id, workspace_id);
create index if not exists clean_solution_snapshots_strategy_fk_idx
  on public.clean_solution_snapshots (strategy_id, workspace_id);
create index if not exists decisions_branch_workspace_fk_idx
  on public.decisions (branch_id, workspace_id);
create index if not exists decisions_step_workspace_fk_idx
  on public.decisions (step_id, workspace_id);
create index if not exists decisions_strategy_workspace_fk_idx
  on public.decisions (strategy_id, workspace_id);
create index if not exists sources_context_workspace_fk_idx
  on public.sources (context_item_id, workspace_id);
create index if not exists step_assumptions_assumption_workspace_fk_idx
  on public.step_assumptions (assumption_id, workspace_id);
create index if not exists step_assumptions_step_workspace_fk_idx
  on public.step_assumptions (step_id, workspace_id);
create index if not exists step_dependencies_dependency_workspace_fk_idx
  on public.step_dependencies (depends_on_step_id, workspace_id);
create index if not exists step_dependencies_step_workspace_fk_idx
  on public.step_dependencies (step_id, workspace_id);
create index if not exists step_revisions_step_workspace_fk_idx
  on public.step_revisions (step_id, workspace_id);
create index if not exists step_sources_source_workspace_fk_idx
  on public.step_sources (source_id, workspace_id);
create index if not exists step_sources_step_workspace_fk_idx
  on public.step_sources (step_id, workspace_id);
create index if not exists steps_branch_strategy_workspace_fk_idx
  on public.steps (branch_id, strategy_id, workspace_id);
create index if not exists steps_supersedes_workspace_fk_idx
  on public.steps (supersedes_step_id, workspace_id);
