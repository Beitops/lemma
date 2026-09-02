-- End-to-end multi-objective database smoke test.
-- Everything runs inside one transaction and is rolled back at the end.

begin;

insert into auth.users (id)
values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select plan(1);

do $test$
declare
  workspace_one uuid;
  workspace_two uuid;
  objective_a uuid;
  objective_b uuid;
  objective_other_workspace uuid;
  strategy_a uuid;
  strategy_b uuid;
  strategy_other_workspace uuid;
  root_a uuid;
  root_b uuid;
  root_other_workspace uuid;
  step_a uuid;
  step_a_dependent uuid;
  atomic_step uuid;
  step_b uuid;
  step_other_workspace uuid;
  dependency_id uuid;
  general_context uuid;
  context_a uuid;
  context_b uuid;
  specific_source_a uuid;
  general_source uuid;
  strategy_result_id uuid;
  branch_result_id uuid;
  decision_id uuid;
  general_decision_id uuid;
  step_decision_id uuid;
  result jsonb;
  retry_result jsonb;
  decision_inbox jsonb;
  overview jsonb;
  graph_a jsonb;
  graph_b jsonb;
  context_payload jsonb;
  branch_a_revision bigint;
  branch_b_revision bigint;
  branch_revision_before_atomic bigint;
  branch_revision_after_atomic bigint;
  strategy_a_revision bigint;
  strategy_b_revision bigint;
  search_count integer;
  step_count_before_invalid integer;
  dependency_count_before_invalid integer;
  pending_decision_ids uuid[];
  expected_pending_decision_ids uuid[];
begin
  -- A newly created workspace is a genuinely empty shell, and retrying the
  -- creation key cannot create a second shell.
  result := public.create_workspace(
    'Multi-objective workspace',
    'test-create-workspace-0001'
  );
  workspace_one := (result ->> 'workspace_id')::uuid;
  retry_result := public.create_workspace(
    'This title must not create another workspace',
    'test-create-workspace-0001'
  );
  if retry_result <> result then
    raise exception 'workspace creation idempotency test failed';
  end if;

  overview := public.get_workspace_overview(workspace_one);
  if jsonb_array_length(overview -> 'objectives') <> 0
    or jsonb_array_length(overview -> 'general_context_items') <> 0
    or overview -> 'workspace' ->> 'id' <> workspace_one::text then
    raise exception 'new workspace is not an empty shell';
  end if;

  result := public.update_workspace(
    workspace_one,
    1,
    'Renamed multi-objective workspace',
    null,
    'test-update-workspace-0001'
  );
  if (result ->> 'workspace_revision')::bigint <> 2
    or result ->> 'status' <> 'active' then
    raise exception 'workspace optimistic update test failed';
  end if;
  retry_result := public.update_workspace(
    workspace_one,
    1,
    'Must not overwrite the workspace',
    null,
    'test-update-workspace-0001'
  );
  if retry_result <> result then
    raise exception 'workspace update idempotency test failed';
  end if;

  result := public.create_objective(
    workspace_one,
    'Goal A',
    'Prove the first shared lemma.',
    'Use only elementary tools.',
    'test-create-objective-a-001'
  );
  objective_a := (result ->> 'objective_id')::uuid;
  retry_result := public.create_objective(
    workspace_one,
    'Must not create a duplicate goal',
    'Ignored.',
    '',
    'test-create-objective-a-001'
  );
  if retry_result <> result then
    raise exception 'objective creation idempotency test failed';
  end if;

  result := public.create_objective(
    workspace_one,
    'Goal B',
    'Prove a second shared lemma.',
    '',
    'test-create-objective-b-001'
  );
  objective_b := (result ->> 'objective_id')::uuid;

  result := public.update_objective(
    workspace_one,
    objective_a,
    1,
    'test-update-objective-a-001',
    p_title => 'Goal A (revised)'
  );
  if (result ->> 'objective_revision')::bigint <> 2
    or result ->> 'workspace_id' <> workspace_one::text then
    raise exception 'objective optimistic update test failed';
  end if;

  result := public.create_context_item(
    workspace_one,
    null,
    'workspace',
    'note',
    'General context',
    'test-create-general-context-001',
    p_body_markdown => 'Shared facts for all goals.'
  );
  general_context := (result ->> 'id')::uuid;
  retry_result := public.create_context_item(
    workspace_one,
    null,
    'workspace',
    'note',
    'General context',
    'test-create-general-context-001',
    p_body_markdown => 'A retry must not create a second context item.'
  );
  select count(*) into search_count
  from public.context_items as context_item
  where context_item.workspace_id = workspace_one
    and context_item.title = 'General context';
  if retry_result <> result or search_count <> 1 then
    raise exception 'context creation idempotency test failed';
  end if;

  context_a := gen_random_uuid();
  result := public.create_context_item(
    workspace_one,
    objective_a,
    'objective',
    'note',
    'Goal A context',
    'test-create-goal-a-context-001',
    p_context_id => context_a,
    p_body_markdown => 'Only Goal A may use this premise.'
  );
  if result ->> 'id' <> context_a::text
    or result ->> 'objective_id' <> objective_a::text then
    raise exception 'objective context did not preserve its supplied identity and scope';
  end if;

  context_b := gen_random_uuid();
  result := public.create_context_item(
    workspace_one,
    objective_b,
    'objective',
    'pdf',
    'Goal B context',
    'test-create-goal-b-upload-context-001',
    p_context_id => context_b,
    p_storage_bucket => 'workspace-context',
    p_storage_path => '11111111-1111-4111-8111-111111111111/test/' || context_b::text || '.pdf',
    p_mime_type => 'application/pdf',
    p_size_bytes => 1024
  );
  if result ->> 'id' <> context_b::text
    or result ->> 'objective_id' <> objective_b::text
    or result ->> 'storage_path' not like '%' || context_b::text || '%' then
    raise exception 'uploaded objective context did not preserve its supplied identity and storage binding';
  end if;

  begin
    update public.context_items
    set objective_id = objective_b,
        revision = revision + 1
    where id = context_a;
    raise exception 'context scope was mutable';
  exception
    when check_violation then null;
  end;

  result := public.create_strategy(
    workspace_one,
    objective_a,
    'Goal A strategy',
    'test-create-strategy-a-001',
    'Work from the shared lemma.'
  );
  strategy_a := (result ->> 'strategy_id')::uuid;
  root_a := (result ->> 'root_branch_id')::uuid;
  if result ->> 'objective_id' <> objective_a::text
    or result ->> 'workspace_id' <> workspace_one::text then
    raise exception 'strategy did not return its objective scope';
  end if;

  result := public.create_strategy(
    workspace_one,
    objective_b,
    'Goal B strategy',
    'test-create-strategy-b-001',
    'Use an independent construction.'
  );
  strategy_b := (result ->> 'strategy_id')::uuid;
  root_b := (result ->> 'root_branch_id')::uuid;

  result := public.create_step(
    root_a,
    'Goal A shared lemma',
    'The shared lemma gives the first conclusion.',
    1,
    'test-create-step-a-000001'
  );
  step_a := (result ->> 'step_id')::uuid;

  result := public.create_step(
    root_a,
    'Goal A dependent conclusion',
    'The first conclusion follows from the preceding Goal A step.',
    2,
    'test-create-step-a-000002'
  );
  step_a_dependent := (result ->> 'step_id')::uuid;

  result := public.create_step(
    root_b,
    'Goal B shared lemma',
    'The shared lemma gives the second conclusion.',
    1,
    'test-create-step-b-000001'
  );
  step_b := (result ->> 'step_id')::uuid;

  select revision into branch_a_revision from public.branches where id = root_a;
  select revision into branch_b_revision from public.branches where id = root_b;
  select revision into strategy_a_revision from public.strategies where id = strategy_a;
  select revision into strategy_b_revision from public.strategies where id = strategy_b;

  -- The RAG is workspace-wide by default, but objective filtering narrows it.
  select count(*) into search_count
  from public.find_steps(workspace_one, 'shared lemma') as found
  where found.step_id in (step_a, step_b)
    and found.objective_id in (objective_a, objective_b)
    and found.objective_title in ('Goal A (revised)', 'Goal B');
  if search_count <> 2 then
    raise exception 'workspace-wide retrieval did not cross objectives';
  end if;

  select count(*) into search_count
  from public.find_steps(
    workspace_one,
    'shared lemma',
    p_objective_id => objective_a
  ) as found
  where found.step_id = step_a
    and found.objective_id = objective_a
    and found.objective_title = 'Goal A (revised)';
  if search_count <> 1 then
    raise exception 'objective retrieval filter did not return Goal A';
  end if;

  select count(*) into search_count
  from public.find_steps(
    workspace_one,
    'shared lemma',
    p_objective_id => objective_a
  ) as found
  where found.step_id = step_b;
  if search_count <> 0 then
    raise exception 'objective retrieval filter leaked Goal B';
  end if;

  begin
    insert into public.step_dependencies (workspace_id, step_id, depends_on_step_id)
    values (workspace_one, step_a, step_b);
    raise exception 'cross-objective dependency was accepted';
  exception
    when check_violation then null;
  end;

  -- Dependencies are persisted relations, not inferred from prose. A first
  -- agent-authored insert owns its UUID idempotency key; retries replay the
  -- receipt, while an independently keyed duplicate active edge reports that
  -- no second edge was created.
  result := public.create_step_dependency(
    workspace_one,
    step_a,
    step_a_dependent,
    'e1111111-1111-4111-8111-111111111111',
    'agent',
    'Dependency test agent'
  );
  dependency_id := (result ->> 'step_dependency_id')::uuid;
  if dependency_id <> 'e1111111-1111-4111-8111-111111111111'::uuid
    or result ->> 'workspace_id' <> workspace_one::text
    or result ->> 'source_step_id' <> step_a::text
    or result ->> 'target_step_id' <> step_a_dependent::text
    or result ->> 'created' <> 'true'
    or not exists (
      select 1
      from public.step_dependencies as dependency
      where dependency.id = dependency_id
        and dependency.workspace_id = workspace_one
        and dependency.depends_on_step_id = step_a
        and dependency.step_id = step_a_dependent
        and dependency.relation_kind = 'logical'
        and dependency.status = 'active'
        and dependency.author_type = 'agent'
        and dependency.author_user_id = '11111111-1111-4111-8111-111111111111'::uuid
        and dependency.author_agent_name = 'Dependency test agent'
    )
    or not exists (
      select 1
      from public.activity_events as event
      where event.workspace_id = workspace_one
        and event.objective_id = objective_a
        and event.entity_type = 'step_dependencies'
        and event.entity_id = dependency_id
        and event.event_type = 'insert'
        and event.actor_type = 'agent'
        and event.actor_user_id = '11111111-1111-4111-8111-111111111111'::uuid
        and event.actor_agent_name = 'Dependency test agent'
    ) then
    raise exception 'agent dependency did not persist orientation, authorship, and activity';
  end if;

  retry_result := public.create_step_dependency(
    workspace_one,
    step_a,
    step_a_dependent,
    'e1111111-1111-4111-8111-111111111111',
    'human'
  );
  if retry_result <> result then
    raise exception 'dependency receipt retry did not return the original result';
  end if;

  retry_result := public.create_step_dependency(
    workspace_one,
    step_a,
    step_a_dependent,
    'e2222222-2222-4222-8222-222222222222',
    'agent',
    'Dependency test agent'
  );
  select count(*) into search_count
  from public.step_dependencies as dependency
  where dependency.workspace_id = workspace_one
    and dependency.depends_on_step_id = step_a
    and dependency.step_id = step_a_dependent
    and dependency.status = 'active';
  if retry_result ->> 'step_dependency_id' <> dependency_id::text
    or retry_result ->> 'created' <> 'false'
    or search_count <> 1 then
    raise exception 'duplicate active dependency did not return the existing edge';
  end if;

  begin
    perform public.create_step_dependency(
      workspace_one,
      step_a,
      step_a,
      'e3333333-3333-4333-8333-333333333333',
      'agent',
      'Dependency test agent'
    );
    raise exception 'self dependency was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.create_step_dependency(
      workspace_one,
      step_a,
      step_b,
      'e4444444-4444-4444-8444-444444444444',
      'agent',
      'Dependency test agent'
    );
    raise exception 'cross-objective dependency RPC was accepted';
  exception
    when check_violation then null;
  end;

  begin
    perform public.create_step_dependency(
      workspace_one,
      step_a_dependent,
      step_a,
      'e5555555-5555-4555-8555-555555555555',
      'agent',
      'Dependency test agent'
    );
    raise exception 'dependency cycle was accepted';
  exception
    when check_violation then null;
  end;

  begin
    perform public.compare_branches(root_a, root_b);
    raise exception 'cross-objective comparison was accepted';
  exception
    when check_violation then null;
  end;

  insert into public.sources (
    workspace_id,
    context_item_id,
    kind,
    title
  ) values (
    workspace_one,
    context_a,
    'context',
    'Goal A-only source'
  ) returning id into specific_source_a;

  insert into public.sources (
    workspace_id,
    context_item_id,
    kind,
    title
  ) values (
    workspace_one,
    general_context,
    'context',
    'General reusable source'
  ) returning id into general_source;

  begin
    insert into public.step_sources (workspace_id, step_id, source_id)
    values (workspace_one, step_b, specific_source_a);
    raise exception 'specific context source leaked across objectives';
  exception
    when check_violation then null;
  end;

  insert into public.step_sources (workspace_id, step_id, source_id)
  values (workspace_one, step_b, general_source);

  begin
    update public.sources
    set context_item_id = context_a,
        revision = revision + 1
    where id = general_source;
    raise exception 'a cited general source became specific context';
  exception
    when check_violation then null;
  end;

  result := public.request_human_decision(
    workspace_one,
    'Should Goal A keep the elementary restriction?',
    'test-request-objective-decision-01',
    p_objective_id => objective_a,
    p_author_type => 'agent',
    p_author_agent_name => 'Objective test agent'
  );
  decision_id := (result ->> 'decision_id')::uuid;
  if result ->> 'objective_id' <> objective_a::text then
    raise exception 'objective decision did not retain its target';
  end if;

  result := public.request_human_decision(
    workspace_one,
    'Which objective should be addressed first?',
    'test-request-workspace-decision-01',
    p_author_type => 'agent',
    p_author_agent_name => 'Objective test agent'
  );
  general_decision_id := (result ->> 'decision_id')::uuid;
  if result ->> 'objective_id' is not null then
    raise exception 'workspace-wide decision unexpectedly acquired objective scope';
  end if;

  result := public.request_human_decision(
    workspace_one,
    'Should this exact step fork into a new route?',
    'test-request-step-decision-01',
    p_step_id => step_a,
    p_author_type => 'agent',
    p_author_agent_name => 'Objective test agent'
  );
  step_decision_id := (result ->> 'decision_id')::uuid;
  if result -> 'ancestry' <> jsonb_build_object(
      'objective_id', objective_a,
      'strategy_id', strategy_a,
      'branch_id', root_a,
      'step_id', step_a
    ) then
    raise exception 'step decision did not return full ancestry';
  end if;
  retry_result := public.request_human_decision(
    workspace_one,
    'A retry must not create a second decision.',
    'test-request-step-decision-01',
    p_step_id => step_a,
    p_author_type => 'human'
  );
  if retry_result <> result then
    raise exception 'decision request idempotency did not preserve ancestry';
  end if;

  decision_inbox := public.list_pending_decisions(workspace_one);
  select array_agg((entry.value -> 'decision' ->> 'id')::uuid order by entry.ordinality)
  into pending_decision_ids
  from jsonb_array_elements(decision_inbox) with ordinality as entry(value, ordinality);
  select array_agg(decision.id order by decision.created_at, decision.id)
  into expected_pending_decision_ids
  from public.decisions as decision
  where decision.workspace_id = workspace_one
    and decision.status = 'pending';
  if pending_decision_ids is distinct from expected_pending_decision_ids
    or not decision_inbox @> jsonb_build_array(jsonb_build_object(
      'decision', jsonb_build_object('id', step_decision_id),
      'ancestry', jsonb_build_object(
        'objective_id', objective_a,
        'strategy_id', strategy_a,
        'branch_id', root_a,
        'step_id', step_a
      )
    )) then
    raise exception 'pending decision inbox did not preserve deterministic order and ancestry';
  end if;

  result := public.resolve_human_decision(
    decision_id,
    1,
    'accepted',
    'Keep the elementary restriction.',
    'test-resolve-objective-decision-01'
  );
  if result ->> 'resolution_outcome' <> 'accepted'
    or (result ->> 'decision_revision')::bigint <> 2
    or not exists (
      select 1
      from public.decisions as decision
      where decision.id = decision_id
        and decision.status = 'resolved'
        and decision.resolution_outcome = 'accepted'
        and decision.resolved_by_user_id = '11111111-1111-4111-8111-111111111111'
    )
    or not exists (
      select 1
      from public.activity_events as event
      where event.entity_type = 'decisions'
        and event.entity_id = decision_id
        and event.event_type = 'update'
        and event.actor_type = 'human'
        and event.details ->> 'resolution_outcome' = 'accepted'
    ) then
    raise exception 'human resolution did not persist typed outcome and audit actor';
  end if;
  retry_result := public.resolve_human_decision(
    decision_id,
    1,
    'accepted',
    'A retry must not overwrite the decision.',
    'test-resolve-objective-decision-01'
  );
  if retry_result <> result then
    raise exception 'human decision resolution idempotency test failed';
  end if;
  begin
    perform public.resolve_human_decision(
      decision_id,
      1,
      'accepted',
      'A stale revision must fail.',
      'test-resolve-objective-decision-stale-01'
    );
    raise exception 'stale human decision resolution was accepted';
  exception
    when serialization_failure then null;
  end;
  begin
    perform public.resolve_human_decision(
      general_decision_id,
      1,
      'not-an-outcome',
      'An invalid outcome must fail.',
      'test-resolve-invalid-outcome-01'
    );
    raise exception 'invalid human decision outcome was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  -- Outcomes do not require a completed branch or strategy. Both target modes
  -- are independently editable and idempotent.
  result := public.set_reasoning_result(
    workspace_one,
    objective_a,
    'strategy',
    strategy_a,
    strategy_a_revision,
    null,
    '  Strategy evidence remains incomplete.  ',
    'inconclusive',
    'test-set-strategy-result-001',
    'agent',
    'Objective test agent'
  );
  strategy_result_id := (result ->> 'id')::uuid;
  if result ->> 'target_type' <> 'strategy'
    or (result ->> 'target_id')::uuid <> strategy_a
    or result ->> 'branch_id' is not null
    or result ->> 'result_markdown' <> 'Strategy evidence remains incomplete.' then
    raise exception 'strategy-targeted result creation test failed';
  end if;

  retry_result := public.set_reasoning_result(
    workspace_one,
    objective_a,
    'strategy',
    strategy_a,
    strategy_a_revision,
    null,
    'A retry must not overwrite the result.',
    'inconclusive',
    'test-set-strategy-result-001',
    'human'
  );
  if retry_result <> result then
    raise exception 'strategy result idempotency test failed';
  end if;

  result := public.set_reasoning_result(
    workspace_one,
    objective_a,
    'branch',
    root_a,
    branch_a_revision,
    null,
    'The active branch has a failed attempt.',
    'unsuccessful',
    'test-set-branch-result-001'
  );
  branch_result_id := (result ->> 'id')::uuid;
  if result ->> 'target_type' <> 'branch'
    or (result ->> 'target_id')::uuid <> root_a
    or (result ->> 'strategy_id')::uuid <> strategy_a
    or (result ->> 'branch_id')::uuid <> root_a
    or result ->> 'outcome_status' <> 'unsuccessful' then
    raise exception 'branch-targeted active result creation test failed';
  end if;

  result := public.set_reasoning_result(
    workspace_one,
    objective_a,
    'strategy',
    strategy_a,
    strategy_a_revision,
    1,
    'The strategy is now known to fail.',
    'unsuccessful',
    'test-update-strategy-result-001'
  );
  if (result ->> 'id')::uuid <> strategy_result_id
    or (result ->> 'revision')::bigint <> 2
    or result ->> 'outcome_status' <> 'unsuccessful' then
    raise exception 'strategy result optimistic update test failed';
  end if;

  begin
    perform public.set_reasoning_result(
      workspace_one,
      objective_a,
      'strategy',
      strategy_b,
      strategy_b_revision,
      null,
      'A cross-objective result must fail.',
      'inconclusive',
      'test-cross-objective-result-001'
    );
    raise exception 'cross-objective result scope was accepted';
  exception
    when check_violation then null;
  end;

  begin
    perform public.set_reasoning_result(
      workspace_one,
      objective_a,
      'branch',
      root_a,
      branch_a_revision,
      null,
      'A duplicate branch result must fail.',
      'inconclusive',
      'test-duplicate-branch-result-001'
    );
    raise exception 'duplicate branch result was accepted';
  exception
    when serialization_failure then null;
  end;

  result := public.generate_clean_solution(root_a);
  if result ->> 'objective_id' <> objective_a::text
    or result ->> 'body_markdown' not like '%Prove the first shared lemma.%' then
    raise exception 'clean solution did not derive the selected objective';
  end if;

  context_payload := public.get_context(workspace_one, objective_a);
  if jsonb_array_length(context_payload -> 'general_context_items') <> 1
    or jsonb_array_length(context_payload -> 'objective_context_items') <> 1
    or jsonb_array_length(context_payload -> 'effective_context_items') <> 2 then
    raise exception 'objective context scope payload test failed';
  end if;

  graph_a := public.get_objective_graph(objective_a);
  graph_b := public.get_objective_graph(objective_b);
  if not graph_a ?& array[
      'workspace', 'objective', 'general_context_items', 'objective_context_items',
      'effective_context_items', 'strategies', 'branches', 'steps', 'assumptions',
      'decisions', 'reasoning_results', 'step_dependencies', 'activity_events',
      'sources', 'step_assumptions', 'step_sources'
    ]
    or graph_a -> 'objective' ->> 'id' <> objective_a::text
    or graph_b -> 'objective' ->> 'id' <> objective_b::text then
    raise exception 'objective graph shape test failed';
  end if;
  if jsonb_array_length(graph_a -> 'strategies') <> 1
    or graph_a -> 'strategies' -> 0 ->> 'id' <> strategy_a::text
    or jsonb_array_length(graph_a -> 'steps') <> 2
    or not (
      graph_a -> 'steps' @> jsonb_build_array(
        jsonb_build_object('id', step_a),
        jsonb_build_object('id', step_a_dependent)
      )
    )
    or jsonb_array_length(graph_a -> 'step_dependencies') <> 1
    or not (
      graph_a -> 'step_dependencies' @> jsonb_build_array(
        jsonb_build_object('id', dependency_id)
      )
    )
    or jsonb_array_length(graph_a -> 'objective_context_items') <> 1
    or graph_a -> 'objective_context_items' -> 0 ->> 'id' <> context_a::text
    or jsonb_array_length(graph_a -> 'reasoning_results') <> 2
    or jsonb_array_length(graph_a -> 'decisions') <> 3
    or not (
      graph_a -> 'decisions' @> jsonb_build_array(jsonb_build_object('id', decision_id))
    )
    or not (
      graph_a -> 'decisions' @> jsonb_build_array(jsonb_build_object('id', general_decision_id))
    )
    or not (
      graph_a -> 'decisions' @> jsonb_build_array(jsonb_build_object('id', step_decision_id))
    ) then
    raise exception 'Goal A graph was not correctly isolated';
  end if;
  if jsonb_array_length(graph_b -> 'strategies') <> 1
    or graph_b -> 'strategies' -> 0 ->> 'id' <> strategy_b::text
    or jsonb_array_length(graph_b -> 'steps') <> 1
    or graph_b -> 'steps' -> 0 ->> 'id' <> step_b::text
    or graph_b -> 'objective_context_items' -> 0 ->> 'id' <> context_b::text
    or jsonb_array_length(graph_b -> 'reasoning_results') <> 0
    or jsonb_array_length(graph_b -> 'decisions') <> 1
    or not (
      graph_b -> 'decisions' @> jsonb_build_array(jsonb_build_object('id', general_decision_id))
    )
    or graph_b -> 'decisions' @> jsonb_build_array(jsonb_build_object('id', decision_id))
    or jsonb_array_length(graph_b -> 'sources') <> 1
    or graph_b -> 'sources' -> 0 ->> 'id' <> general_source::text then
    raise exception 'Goal B graph leaked Goal A graph data';
  end if;

  overview := public.get_workspace_overview(workspace_one);
  if jsonb_array_length(overview -> 'objectives') <> 2
    or not exists (
      select 1
      from jsonb_array_elements(overview -> 'objectives') as objective
      where objective ->> 'id' = objective_a::text
        and (objective ->> 'strategy_count')::integer = 1
        and (objective ->> 'branch_count')::integer = 1
        and (objective ->> 'step_count')::integer = 2
    ) then
    raise exception 'workspace overview objective summary test failed';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(public.list_workspace_summaries() -> 'workspaces') as workspace
    where workspace ->> 'id' = workspace_one::text
      and (workspace ->> 'objective_count')::integer = 2
      and (workspace ->> 'active_objective_count')::integer = 2
  ) then
    raise exception 'workspace summary did not include objective counts';
  end if;

  -- A different workspace is never retrieved through this workspace's RAG.
  result := public.create_workspace('Second workspace', 'test-create-workspace-0002');
  workspace_two := (result ->> 'workspace_id')::uuid;
  result := public.create_objective(
    workspace_two,
    'Other workspace goal',
    'Keep this outside the first workspace.',
    '',
    'test-create-objective-other-01'
  );
  objective_other_workspace := (result ->> 'objective_id')::uuid;
  result := public.create_strategy(
    workspace_two,
    objective_other_workspace,
    'Other workspace strategy',
    'test-create-strategy-other-01'
  );
  strategy_other_workspace := (result ->> 'strategy_id')::uuid;
  root_other_workspace := (result ->> 'root_branch_id')::uuid;
  result := public.create_step(
    root_other_workspace,
    'Outside shared lemma',
    'This shared lemma belongs only to another workspace.',
    1,
    'test-create-step-other-0001'
  );
  step_other_workspace := (result ->> 'step_id')::uuid;
  select count(*) into search_count
  from public.find_steps(workspace_one, 'outside shared lemma') as found
  where found.step_id = step_other_workspace;
  if search_count <> 0 then
    raise exception 'workspace-wide retrieval leaked another workspace';
  end if;

  -- A step and all of its prerequisite edges share one mutation receipt and
  -- transaction. The graph records the prerequisite as depends_on_step_id and
  -- the new conclusion as step_id, while retaining agent provenance in both
  -- the relation and its activity event.
  select revision into branch_revision_before_atomic
  from public.branches
  where id = root_a;
  result := public.create_step(
    p_branch_id => root_a,
    p_title => 'Goal A atomic dependent conclusion',
    p_body_markdown => 'This conclusion records both prerequisites when it is created.',
    p_expected_branch_revision => branch_revision_before_atomic,
    p_idempotency_key => 'test-create-step-with-dependencies-01',
    p_author_type => 'agent',
    p_author_agent_name => 'Atomic dependency test agent',
    p_depends_on_step_ids => array[step_a_dependent, step_a]
  );
  atomic_step := (result ->> 'step_id')::uuid;
  select revision into branch_revision_after_atomic
  from public.branches
  where id = root_a;
  if atomic_step is null
    or (result ->> 'branch_revision')::bigint <> branch_revision_before_atomic + 1
    or branch_revision_after_atomic <> branch_revision_before_atomic + 1
    or coalesce(jsonb_array_length(result -> 'step_dependencies'), -1) <> 2
    -- Returned dependencies preserve the caller's source-step order.
    or result -> 'step_dependencies' -> 0 ->> 'source_step_id' <> step_a_dependent::text
    or result -> 'step_dependencies' -> 1 ->> 'source_step_id' <> step_a::text
    or result -> 'step_dependencies' -> 0 ->> 'target_step_id' <> atomic_step::text
    or result -> 'step_dependencies' -> 1 ->> 'target_step_id' <> atomic_step::text
    or coalesce((result -> 'step_dependencies' -> 0 ->> 'dependency_revision')::bigint, 0) <> 1
    or coalesce((result -> 'step_dependencies' -> 1 ->> 'dependency_revision')::bigint, 0) <> 1
    or (
      select count(*)
      from public.step_dependencies as dependency
      where dependency.workspace_id = workspace_one
        and dependency.step_id = atomic_step
        and dependency.depends_on_step_id = any(array[step_a_dependent, step_a])
        and dependency.relation_kind = 'logical'
        and dependency.status = 'active'
        and dependency.author_type = 'agent'
        and dependency.author_user_id = '11111111-1111-4111-8111-111111111111'::uuid
        and dependency.author_agent_name = 'Atomic dependency test agent'
    ) <> 2
    or (
      select count(*)
      from public.activity_events as event
      where event.workspace_id = workspace_one
        and event.objective_id = objective_a
        and event.entity_type = 'step_dependencies'
        and event.event_type = 'insert'
        and event.actor_type = 'agent'
        and event.actor_user_id = '11111111-1111-4111-8111-111111111111'::uuid
        and event.actor_agent_name = 'Atomic dependency test agent'
        and event.entity_id in (
          select dependency.id
          from public.step_dependencies as dependency
          where dependency.step_id = atomic_step
        )
    ) <> 2 then
    raise exception 'atomic dependency-aware step creation did not retain graph orientation or agent provenance';
  end if;

  retry_result := public.create_step(
    p_branch_id => root_a,
    p_title => 'Ignored retry title',
    p_body_markdown => 'Ignored retry body.',
    p_expected_branch_revision => branch_revision_before_atomic,
    p_idempotency_key => 'test-create-step-with-dependencies-01',
    p_author_type => 'human',
    p_depends_on_step_ids => array[step_a_dependent, step_a]
  );
  if retry_result <> result then
    raise exception 'dependency-aware step receipt retry did not return the original result';
  end if;

  select count(*) into step_count_before_invalid
  from public.steps
  where branch_id = root_a;
  select count(*) into dependency_count_before_invalid
  from public.step_dependencies
  where workspace_id = workspace_one;

  begin
    perform public.create_step(
      p_branch_id => root_a,
      p_title => 'Invalid prerequisite must roll back',
      p_body_markdown => 'This step must not be persisted.',
      p_expected_branch_revision => branch_revision_after_atomic,
      p_idempotency_key => 'test-create-step-with-missing-dependency-01',
      p_depends_on_step_ids => array['f1111111-1111-4111-8111-111111111111'::uuid]
    );
    raise exception 'missing prerequisite was accepted';
  exception
    when no_data_found then null;
  end;

  begin
    perform public.create_step(
      p_branch_id => root_a,
      p_title => 'Cross-objective prerequisite must roll back',
      p_body_markdown => 'This step must not be persisted.',
      p_expected_branch_revision => branch_revision_after_atomic,
      p_idempotency_key => 'test-create-step-with-cross-objective-dependency-01',
      p_depends_on_step_ids => array[step_b]
    );
    raise exception 'cross-objective prerequisite was accepted';
  exception
    when check_violation then null;
  end;

  begin
    perform public.create_step(
      p_branch_id => root_a,
      p_title => 'Duplicate prerequisite must roll back',
      p_body_markdown => 'This step must not be persisted.',
      p_expected_branch_revision => branch_revision_after_atomic,
      p_idempotency_key => 'test-create-step-with-duplicate-dependency-01',
      p_depends_on_step_ids => array[step_a, step_a]
    );
    raise exception 'duplicate prerequisite was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.create_step(
      p_branch_id => root_a,
      p_title => 'Null prerequisite must roll back',
      p_body_markdown => 'This step must not be persisted.',
      p_expected_branch_revision => branch_revision_after_atomic,
      p_idempotency_key => 'test-create-step-with-null-dependency-01',
      p_depends_on_step_ids => array[step_a, null::uuid]
    );
    raise exception 'null prerequisite was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.create_step(
      p_branch_id => root_a,
      p_title => 'Too many prerequisites must roll back',
      p_body_markdown => 'This step must not be persisted.',
      p_expected_branch_revision => branch_revision_after_atomic,
      p_idempotency_key => 'test-create-step-with-too-many-dependencies-01',
      p_depends_on_step_ids => array_fill(step_a, array[65])
    );
    raise exception 'too many prerequisites were accepted';
  exception
    when invalid_parameter_value then null;
  end;

  if (select count(*) from public.steps where branch_id = root_a) <> step_count_before_invalid
    or (select count(*) from public.step_dependencies where workspace_id = workspace_one)
      <> dependency_count_before_invalid
    or (select revision from public.branches where id = root_a) <> branch_revision_after_atomic then
    raise exception 'invalid prerequisite input changed a step, dependency, or branch revision';
  end if;

  -- RLS hides both direct rows and all new graph/read mutations from another owner.
  perform set_config(
    'request.jwt.claim.sub',
    '22222222-2222-4222-8222-222222222222',
    true
  );
  if exists (select 1 from public.objectives where id = objective_a)
    or exists (select 1 from public.reasoning_results where id in (strategy_result_id, branch_result_id)) then
    raise exception 'RLS exposed another owner objective data';
  end if;

  begin
    perform public.get_objective_graph(objective_a);
    raise exception 'objective graph RPC exposed another owner data';
  exception
    when no_data_found then null;
  end;

  begin
    perform public.list_pending_decisions(workspace_one);
    raise exception 'pending decision inbox exposed another owner data';
  exception
    when no_data_found then null;
  end;

  begin
    perform public.set_reasoning_result(
      workspace_one,
      objective_a,
      'strategy',
      strategy_a,
      strategy_a_revision,
      2,
      'Another owner must not edit this result.',
      'unsuccessful',
      'test-cross-owner-result-001'
    );
    raise exception 'RLS accepted a cross-owner result mutation';
  exception
    when no_data_found then null;
  end;

  begin
    insert into public.context_items (
      workspace_id,
      objective_id,
      kind,
      title,
      body_markdown,
      author_user_id
    ) values (
      workspace_one,
      objective_a,
      'note',
      'Must not be inserted',
      'Isolated content.',
      '22222222-2222-4222-8222-222222222222'
    );
    raise exception 'RLS accepted a cross-owner context insert';
  exception
    when insufficient_privilege then null;
  end;
end
$test$;

select pass('multi-objective integration workflow succeeds');
select * from finish();

reset role;
rollback;
