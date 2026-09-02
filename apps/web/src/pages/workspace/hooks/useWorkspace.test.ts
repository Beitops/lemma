import type { ActivityEvent, ContextItem, DecisionInboxItem, Objective, ObjectiveGraph, Workspace, WorkspaceOverview } from "@lemma/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LemmaApi } from "../../../lib/api";
import type { WorkspaceRealtimeInvalidation } from "./useWorkspaceRealtime";
import { useWorkspace } from "./useWorkspace";

const realtimeHarness = vi.hoisted(() => ({
  onInvalidate: null as ((invalidation: WorkspaceRealtimeInvalidation) => Promise<void> | void) | null,
}));

vi.mock("./useWorkspaceRealtime", () => ({
  useWorkspaceRealtime: (options: {
    onInvalidate: (invalidation: WorkspaceRealtimeInvalidation) => Promise<void> | void;
  }) => {
    realtimeHarness.onInvalidate = options.onInvalidate;
    return { status: "live" as const };
  },
}));

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const OBJECTIVE_A_ID = "20000000-0000-4000-8000-000000000001";
const OBJECTIVE_B_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "40000000-0000-4000-8000-000000000001";
const STRATEGY_A_ID = "50000000-0000-4000-8000-000000000001";
const STRATEGY_B_ID = "60000000-0000-4000-8000-000000000001";
const BRANCH_A_ID = "70000000-0000-4000-8000-000000000001";
const BRANCH_B_ID = "80000000-0000-4000-8000-000000000001";
const BRANCH_B_RESULT_ID = "81000000-0000-4000-8000-000000000001";
const CONTEXT_A_ID = "92000000-0000-4000-8000-000000000001";
const CONTEXT_B_ID = "93000000-0000-4000-8000-000000000001";
const TIMESTAMP = "2026-08-31T10:00:00.000Z";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function activityEvent(
  entityType: string,
  objectiveId: string | null,
  entityId: string,
): ActivityEvent {
  return {
    actor_agent_name: "Remote agent",
    actor_type: "agent",
    actor_user_id: null,
    created_at: TIMESTAMP,
    details: {},
    entity_id: entityId,
    entity_revision: 2,
    entity_type: entityType,
    event_type: "update",
    id: crypto.randomUUID(),
    objective_id: objectiveId,
    workspace_id: WORKSPACE_ID,
  };
}

const workspace: Workspace = {
  created_at: TIMESTAMP,
  id: WORKSPACE_ID,
  owner_id: USER_ID,
  revision: 1,
  status: "active",
  title: "Shared workspace",
  updated_at: TIMESTAMP,
};

function objective(id: string, title: string, status: Objective["status"] = "active"): Objective {
  return {
    author_agent_name: null,
    author_type: "human",
    author_user_id: USER_ID,
    constraints_markdown: "",
    created_at: TIMESTAMP,
    id,
    objective_markdown: `Prove ${title}.`,
    revision: 1,
    status,
    title,
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
  };
}

const objectiveA = objective(OBJECTIVE_A_ID, "A");
const objectiveB = objective(OBJECTIVE_B_ID, "B");

function context(id: string, objectiveId: string | null): ContextItem {
  return {
    author_agent_name: null,
    author_type: "human",
    author_user_id: USER_ID,
    body_markdown: "Objective-specific context.",
    created_at: TIMESTAMP,
    id,
    kind: "text",
    metadata: {},
    mime_type: null,
    objective_id: objectiveId,
    processing_status: "ready",
    revision: 1,
    size_bytes: null,
    source_url: null,
    storage_bucket: null,
    storage_path: null,
    title: "Scoped context",
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
  };
}

const overview: WorkspaceOverview = {
  general_context_items: [],
  objectives: [
    { ...objectiveA, branch_count: 1, step_count: 1, strategy_count: 1 },
    { ...objectiveB, branch_count: 0, step_count: 0, strategy_count: 1 },
  ],
  workspace,
};

function graphFor(objectiveValue: Objective, strategyId: string): ObjectiveGraph {
  const branchId = objectiveValue.id === OBJECTIVE_A_ID ? BRANCH_A_ID : BRANCH_B_ID;
  const objectiveContextItems = objectiveValue.id === OBJECTIVE_B_ID
    ? [context(CONTEXT_B_ID, OBJECTIVE_B_ID)]
    : [];
  const branches = [{
    author_agent_name: null,
    author_type: "human" as const,
    author_user_id: USER_ID,
    created_at: TIMESTAMP,
    forked_from_step_id: null,
    id: branchId,
    name: "Main",
    parent_branch_id: null,
    revision: 1,
    status: "active" as const,
    strategy_id: strategyId,
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
  }];
  if (objectiveValue.id === OBJECTIVE_B_ID) {
    branches.push({
      author_agent_name: null,
      author_type: "human" as const,
      author_user_id: USER_ID,
      created_at: TIMESTAMP,
      forked_from_step_id: null,
      id: BRANCH_B_RESULT_ID,
      name: "Alternative",
      parent_branch_id: null,
      revision: 1,
      status: "active" as const,
      strategy_id: strategyId,
      updated_at: TIMESTAMP,
      workspace_id: WORKSPACE_ID,
    });
  }
  return {
    activity_events: [],
    assumptions: [],
    branches,
    decisions: [],
    effective_context_items: objectiveContextItems,
    general_context_items: [],
    objective: objectiveValue,
    objective_context_items: objectiveContextItems,
    reasoning_results: [],
    sources: [],
    step_assumptions: [],
    step_dependencies: [],
    step_sources: [],
    steps: [{
      author_agent_name: null,
      author_type: "human",
      author_user_id: USER_ID,
      body_markdown: "A scoped step.",
      branch_id: branchId,
      concepts: [],
      created_at: TIMESTAMP,
      id: objectiveValue.id === OBJECTIVE_A_ID ? "90000000-0000-4000-8000-000000000001" : "91000000-0000-4000-8000-000000000001",
      ordinal: 1,
      revision: 1,
      status: "active",
      strategy_id: strategyId,
      summary: null,
      supersedes_step_id: null,
      theorem_tags: [],
      title: `Step ${objectiveValue.title}`,
      updated_at: TIMESTAMP,
      workspace_id: WORKSPACE_ID,
    }],
    strategies: [{
      author_agent_name: null,
      author_type: "human",
      author_user_id: USER_ID,
      created_at: TIMESTAMP,
      description_markdown: "Scoped strategy.",
      id: strategyId,
      objective_id: objectiveValue.id,
      revision: 1,
      status: "active",
      title: `Strategy ${objectiveValue.title}`,
      updated_at: TIMESTAMP,
      workspace_id: WORKSPACE_ID,
    }],
    workspace,
  };
}

function createApi() {
  const graphA = graphFor(objectiveA, STRATEGY_A_ID);
  const graphB = graphFor(objectiveB, STRATEGY_B_ID);
  return {
    api: {
      createTextContext: vi.fn(async () => context(CONTEXT_A_ID, OBJECTIVE_A_ID)),
      getObjectiveGraph: vi.fn(async (_workspaceId: string, objectiveId: string) => objectiveId === OBJECTIVE_A_ID ? graphA : graphB),
      getWorkspaceOverview: vi.fn(async () => overview),
      listPendingDecisions: vi.fn(async () => ({ decisions: [], workspace_id: WORKSPACE_ID })),
      listStrategies: vi.fn(async (_workspaceId: string, objectiveId: string) => ({
        branches: objectiveId === OBJECTIVE_A_ID ? graphA.branches : graphB.branches,
        objective_id: objectiveId,
        strategies: objectiveId === OBJECTIVE_A_ID ? graphA.strategies : graphB.strategies,
        workspace_id: WORKSPACE_ID,
      })),
      setReasoningResult: vi.fn(async () => ({ id: "93000000-0000-4000-8000-000000000001" })),
    } as unknown as LemmaApi,
    graphA,
    graphB,
  };
}

function hookOptions(api: LemmaApi, objectiveId: string | null) {
  return {
    api,
    objectiveId,
    onOpenObjective: vi.fn(),
    onReplaceObjective: vi.fn(),
    pushToast: vi.fn(),
    workspaceId: WORKSPACE_ID,
  };
}

describe("useWorkspace multi-objective state", () => {
  it("replaces the workspace shell URL with the first active objective deterministically", async () => {
    const { api } = createApi();
    const options = hookOptions(api, null);
    renderHook(() => useWorkspace(options));

    await waitFor(() => expect(options.onReplaceObjective).toHaveBeenCalledWith(WORKSPACE_ID, OBJECTIVE_A_ID));
  });

  it("loads only the deep-linked objective graph", async () => {
    const { api } = createApi();
    const options = hookOptions(api, OBJECTIVE_B_ID);
    const { result } = renderHook(() => useWorkspace(options));

    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_B_ID));
    expect(api.getObjectiveGraph).toHaveBeenCalledWith(WORKSPACE_ID, OBJECTIVE_B_ID, undefined);
    expect(result.current.graph?.strategies).toHaveLength(1);
    expect(result.current.graph?.strategies[0]?.objective_id).toBe(OBJECTIVE_B_ID);
  });

  it("loads a collapsed objective lazily and routes a strategy click to its objective", async () => {
    const { api } = createApi();
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result } = renderHook(() => useWorkspace(options));
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_A_ID));

    act(() => result.current.actions.toggleObjective(OBJECTIVE_B_ID));
    await waitFor(() => expect(api.listStrategies).toHaveBeenCalledWith(WORKSPACE_ID, OBJECTIVE_B_ID, undefined));
    await waitFor(() => expect(result.current.objectiveStrategies[OBJECTIVE_B_ID]?.strategies[0]?.id).toBe(STRATEGY_B_ID));

    act(() => result.current.actions.selectStrategy(STRATEGY_B_ID));
    expect(options.onOpenObjective).toHaveBeenCalledWith(WORKSPACE_ID, OBJECTIVE_B_ID);
  });

  it("does not let an older sidebar request overwrite a newer objective graph", async () => {
    const { api, graphA, graphB } = createApi();
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result, rerender } = renderHook(
      ({ routeObjectiveId }: { routeObjectiveId: string }) => useWorkspace({
        ...options,
        objectiveId: routeObjectiveId,
      }),
      { initialProps: { routeObjectiveId: OBJECTIVE_A_ID } },
    );
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_A_ID));

    const staleSidebar = deferred<Awaited<ReturnType<LemmaApi["listStrategies"]>>>();
    const freshGraph = {
      ...graphB,
      strategies: graphB.strategies.map((strategy) => ({
        ...strategy,
        revision: 2,
        title: "Fresh strategy from graph",
      })),
    };
    vi.mocked(api.listStrategies).mockImplementationOnce(() => staleSidebar.promise);
    vi.mocked(api.getObjectiveGraph).mockImplementation(
      async (_workspaceId, nextObjectiveId) => nextObjectiveId === OBJECTIVE_B_ID ? freshGraph : graphA,
    );

    act(() => result.current.actions.toggleObjective(OBJECTIVE_B_ID));
    await waitFor(() => expect(api.listStrategies).toHaveBeenCalledWith(WORKSPACE_ID, OBJECTIVE_B_ID, undefined));
    rerender({ routeObjectiveId: OBJECTIVE_B_ID });
    await waitFor(() => expect(result.current.graph?.strategies[0]?.title).toBe("Fresh strategy from graph"));

    await act(async () => {
      staleSidebar.resolve({
        branches: graphB.branches,
        objective_id: OBJECTIVE_B_ID,
        strategies: graphB.strategies,
        workspace_id: WORKSPACE_ID,
      });
      await staleSidebar.promise;
    });

    expect(result.current.objectiveStrategies[OBJECTIVE_B_ID]?.strategies[0]?.title)
      .toBe("Fresh strategy from graph");
  });

  it("opens the strategy dialog after navigating from another objective's add button", async () => {
    const { api } = createApi();
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result, rerender } = renderHook(
      ({ routeObjectiveId }: { routeObjectiveId: string }) => useWorkspace({
        ...options,
        objectiveId: routeObjectiveId,
      }),
      { initialProps: { routeObjectiveId: OBJECTIVE_A_ID } },
    );
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_A_ID));

    act(() => result.current.actions.openStrategy(OBJECTIVE_B_ID));

    expect(options.onOpenObjective).toHaveBeenCalledWith(WORKSPACE_ID, OBJECTIVE_B_ID);
    expect(result.current.state.activeDialog).toBeNull();

    rerender({ routeObjectiveId: OBJECTIVE_B_ID });
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_B_ID));
    await waitFor(() => expect(result.current.state.activeDialog).toBe("strategy"));
  });

  it("activates an agent-created objective before applying its strategy highlight and refreshes its sidebar cache", async () => {
    const { api } = createApi();
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result, rerender } = renderHook(
      ({ routeObjectiveId }: { routeObjectiveId: string }) => useWorkspace({
        ...options,
        objectiveId: routeObjectiveId,
      }),
      { initialProps: { routeObjectiveId: OBJECTIVE_A_ID } },
    );
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_A_ID));

    act(() => result.current.highlightExternalMutation({
      objectiveId: OBJECTIVE_B_ID,
      strategyId: STRATEGY_B_ID,
      type: "strategy",
    }));

    expect(options.onOpenObjective).toHaveBeenCalledWith(WORKSPACE_ID, OBJECTIVE_B_ID);
    expect(result.current.graph?.objective.id).toBe(OBJECTIVE_A_ID);
    await waitFor(() => expect(api.listStrategies).toHaveBeenCalledWith(WORKSPACE_ID, OBJECTIVE_B_ID, undefined));

    rerender({ routeObjectiveId: OBJECTIVE_B_ID });
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_B_ID));
    await waitFor(() => expect(result.current.state.selectedStrategyId).toBe(STRATEGY_B_ID));
  });

  it("keeps an agent-mutated step closed until the user selects its node", async () => {
    const { api, graphA } = createApi();
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result } = renderHook(() => useWorkspace(options));
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_A_ID));
    const step = graphA.steps[0];
    if (!step) throw new Error("Expected the fixture graph to include a step.");

    act(() => result.current.highlightExternalMutation({ stepId: step.id, type: "step" }));

    expect(result.current.state.selectedBranchId).toBe(step.branch_id);
    expect(result.current.state.selectedStrategyId).toBe(step.strategy_id);
    expect(result.current.state.selectedStepId).toBeNull();

    act(() => result.current.actions.selectStep(step.id));
    expect(result.current.state.selectedStepId).toBe(step.id);
  });

  it("opens the oldest pending checkpoint for the selected step", async () => {
    const { api, graphA } = createApi();
    const step = graphA.steps[0];
    if (!step) throw new Error("Expected the fixture graph to include a step.");
    const pending = (id: string, createdAt: string): DecisionInboxItem => ({
      ancestry: {
        branch_id: step.branch_id,
        objective_id: OBJECTIVE_A_ID,
        step_id: step.id,
        strategy_id: step.strategy_id,
      },
      decision: {
        branch_id: null,
        created_at: createdAt,
        id,
        kind: "human_decision",
        objective_id: null,
        question_markdown: "Which route should continue?",
        requested_by_agent_name: "Codex",
        requested_by_type: "agent",
        requested_by_user_id: null,
        resolution_markdown: null,
        resolution_outcome: null,
        resolved_at: null,
        resolved_by_user_id: null,
        revision: 1,
        status: "pending",
        step_id: step.id,
        strategy_id: null,
        updated_at: createdAt,
        workspace_id: WORKSPACE_ID,
      },
    });
    const oldestId = "96000000-0000-4000-8000-000000000001";
    const newestId = "96000000-0000-4000-8000-000000000002";
    Object.assign(api, {
      listPendingDecisions: vi.fn(async () => ({
        decisions: [
          pending(newestId, "2026-08-31T10:02:00.000Z"),
          pending(oldestId, "2026-08-31T10:01:00.000Z"),
        ],
        workspace_id: WORKSPACE_ID,
      })),
    });
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result } = renderHook(() => useWorkspace(options));
    await waitFor(() => expect(result.current.pendingDecisions).toHaveLength(2));

    act(() => result.current.actions.openPendingDecision(step.id));

    expect(result.current.state.activeDialog).toBe("decision");
    expect(result.current.state.selectedDecisionId).toBe(oldestId);
    expect(result.current.state.selectedStepId).toBe(step.id);
  });

  it("does not auto-inspect a newly created step or branch after refreshing", async () => {
    const { api, graphA } = createApi();
    const step = graphA.steps[0];
    if (!step) throw new Error("Expected the fixture graph to include a step.");
    const createdStepId = "94000000-0000-4000-8000-000000000001";
    const createdBranchId = "95000000-0000-4000-8000-000000000001";
    const createStep = vi.fn(async () => ({
      branch_id: BRANCH_A_ID,
      branch_revision: 2,
      ordinal: 2,
      step_id: createdStepId,
      step_revision: 1,
      step_dependencies: [],
    }));
    const branchFromStep = vi.fn(async () => ({
      branch_id: createdBranchId,
      branch_revision: 1,
      forked_from_step_id: step.id,
      parent_branch_id: BRANCH_A_ID,
      strategy_id: STRATEGY_A_ID,
    }));
    Object.assign(api, { branchFromStep, createStep });
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result } = renderHook(() => useWorkspace(options));
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_A_ID));

    act(() => result.current.actions.openNewStep(BRANCH_A_ID));
    act(() => result.current.actions.submitStep());
    await waitFor(() => expect(createStep).toHaveBeenCalledOnce());
    expect(createStep).toHaveBeenCalledWith(BRANCH_A_ID, expect.objectContaining({
      depends_on_step_ids: [],
    }));
    await waitFor(() => expect(result.current.state.busy).toBe(false));
    expect(result.current.state.selectedBranchId).toBe(BRANCH_A_ID);
    expect(result.current.state.selectedStepId).toBeNull();

    act(() => result.current.actions.openBranch(step.id));
    act(() => result.current.actions.createBranch());
    await waitFor(() => expect(branchFromStep).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.state.busy).toBe(false));
    expect(result.current.state.selectedBranchId).toBe(createdBranchId);
    expect(result.current.state.selectedStrategyId).toBe(STRATEGY_A_ID);
    expect(result.current.state.selectedStepId).toBeNull();
  });

  it("preserves a step that the user selected across an ordinary refresh", async () => {
    const { api, graphA } = createApi();
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result } = renderHook(() => useWorkspace(options));
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_A_ID));
    const step = graphA.steps[0];
    if (!step) throw new Error("Expected the fixture graph to include a step.");

    act(() => result.current.actions.selectStep(step.id));
    expect(result.current.state.selectedStepId).toBe(step.id);

    act(() => result.current.actions.refresh());
    await waitFor(() => expect(api.getWorkspaceOverview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.state.refreshing).toBe(false));
    expect(result.current.state.selectedStepId).toBe(step.id);
  });

  it("reconciles an active objective from a Realtime activity invalidation", async () => {
    const { api, graphA } = createApi();
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result } = renderHook(() => useWorkspace(options));
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_A_ID));
    const step = graphA.steps[0];
    if (!step) throw new Error("Expected the fixture graph to include a step.");

    vi.mocked(api.getWorkspaceOverview).mockClear();
    vi.mocked(api.getObjectiveGraph).mockClear();
    vi.mocked(api.listPendingDecisions).mockClear();
    const invalidate = realtimeHarness.onInvalidate;
    if (!invalidate) throw new Error("Expected the Realtime hook to register its invalidation callback.");

    const realtimeSignal = new AbortController().signal;
    await act(async () => invalidate({
      activityEvents: [activityEvent("steps", OBJECTIVE_A_ID, step.id)],
      reasons: [],
      reconcile: false,
      signal: realtimeSignal,
    }));

    expect(api.getWorkspaceOverview).toHaveBeenCalledOnce();
    expect(api.getObjectiveGraph).toHaveBeenCalledWith(WORKSPACE_ID, OBJECTIVE_A_ID, realtimeSignal);
    expect(api.listPendingDecisions).not.toHaveBeenCalled();
    expect(options.onOpenObjective).not.toHaveBeenCalled();
    expect(result.current.realtimeStatus).toBe("live");
    expect(result.current.state.refreshing).toBe(false);
  });

  it("restores the active graph cache when a newer sidebar refresh fails", async () => {
    const { api, graphA } = createApi();
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result } = renderHook(() => useWorkspace(options));
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_A_ID));

    const graphRefresh = deferred<ObjectiveGraph>();
    const sidebarRefresh = deferred<Awaited<ReturnType<LemmaApi["listStrategies"]>>>();
    const freshGraph = {
      ...graphA,
      strategies: graphA.strategies.map((strategy) => ({
        ...strategy,
        revision: 2,
        title: "Fresh active strategy",
      })),
    };
    vi.mocked(api.getObjectiveGraph).mockImplementationOnce(() => graphRefresh.promise);
    vi.mocked(api.listStrategies).mockImplementationOnce(() => sidebarRefresh.promise);

    act(() => result.current.actions.refresh());
    await waitFor(() => expect(api.getObjectiveGraph).toHaveBeenCalledTimes(2));
    act(() => result.current.highlightExternalMutation({
      objectiveId: OBJECTIVE_A_ID,
      type: "objective",
    }));
    await waitFor(() => expect(api.listStrategies).toHaveBeenCalledOnce());

    await act(async () => {
      graphRefresh.resolve(freshGraph);
      await graphRefresh.promise;
    });
    await waitFor(() => expect(result.current.graph?.strategies[0]?.title).toBe("Fresh active strategy"));

    await act(async () => {
      sidebarRefresh.reject(new Error("temporary sidebar failure"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.objectiveStrategies[OBJECTIVE_A_ID]?.strategies[0]?.title)
        .toBe("Fresh active strategy");
    });
  });

  it("does not let an older overview request overwrite a newer Realtime-era snapshot", async () => {
    const { api } = createApi();
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result } = renderHook(() => useWorkspace(options));
    await waitFor(() => expect(result.current.overview?.workspace.title).toBe("Shared workspace"));

    const older = deferred<WorkspaceOverview>();
    const newer = deferred<WorkspaceOverview>();
    vi.mocked(api.getWorkspaceOverview)
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    act(() => {
      result.current.actions.refresh();
      result.current.actions.refresh();
    });
    await act(async () => {
      newer.resolve({
        ...overview,
        workspace: { ...workspace, revision: 3, title: "Newest workspace" },
      });
      await newer.promise;
    });
    await waitFor(() => expect(result.current.overview?.workspace.title).toBe("Newest workspace"));

    await act(async () => {
      older.resolve({
        ...overview,
        workspace: { ...workspace, revision: 2, title: "Older workspace" },
      });
      await older.promise;
    });

    expect(result.current.overview?.workspace.title).toBe("Newest workspace");
    await waitFor(() => expect(result.current.state.refreshing).toBe(false));
  });

  it("keeps an open step draft stale after a remote revision instead of silently overwriting it", async () => {
    const { api, graphA } = createApi();
    const updateStep = vi.fn();
    Object.assign(api, { updateStep });
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result } = renderHook(() => useWorkspace(options));
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_A_ID));
    const step = graphA.steps[0];
    if (!step) throw new Error("Expected the fixture graph to include a step.");

    act(() => {
      result.current.actions.openEditStep(step.id);
      result.current.actions.setStepDraft("title", "My unsaved local title");
    });
    const refreshedGraph: ObjectiveGraph = {
      ...graphA,
      steps: graphA.steps.map((candidate) => candidate.id === step.id
        ? { ...candidate, revision: 2, title: "Remote title" }
        : candidate),
    };
    vi.mocked(api.getObjectiveGraph).mockResolvedValue(refreshedGraph);

    act(() => result.current.actions.refresh());
    await waitFor(() => expect(result.current.graph?.steps[0]?.revision).toBe(2));
    await waitFor(() => expect(result.current.draftConflict).toContain("older graph revision"));
    expect(result.current.state.stepDraft.title).toBe("My unsaved local title");

    act(() => result.current.actions.submitStep());

    expect(updateStep).not.toHaveBeenCalled();
    expect(options.pushToast).toHaveBeenCalledWith(
      expect.stringContaining("older graph revision"),
      "error",
    );
  });

  it("activates the objective before highlighting an agent-recorded branch outcome", async () => {
    const { api } = createApi();
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result, rerender } = renderHook(
      ({ routeObjectiveId }: { routeObjectiveId: string }) => useWorkspace({
        ...options,
        objectiveId: routeObjectiveId,
      }),
      { initialProps: { routeObjectiveId: OBJECTIVE_A_ID } },
    );
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_A_ID));

    act(() => result.current.highlightExternalMutation({
      branchId: BRANCH_B_RESULT_ID,
      objectiveId: OBJECTIVE_B_ID,
      type: "branch",
    }));

    expect(options.onOpenObjective).toHaveBeenCalledWith(WORKSPACE_ID, OBJECTIVE_B_ID);
    rerender({ routeObjectiveId: OBJECTIVE_B_ID });
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_B_ID));
    await waitFor(() => expect(result.current.state.selectedBranchId).toBe(BRANCH_B_RESULT_ID));
    expect(result.current.state.selectedStrategyId).toBe(STRATEGY_B_ID);
  });

  it("activates the objective before selecting agent-created objective context", async () => {
    const { api } = createApi();
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result, rerender } = renderHook(
      ({ routeObjectiveId }: { routeObjectiveId: string }) => useWorkspace({
        ...options,
        objectiveId: routeObjectiveId,
      }),
      { initialProps: { routeObjectiveId: OBJECTIVE_A_ID } },
    );
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_A_ID));

    act(() => result.current.highlightExternalMutation({
      contextItemId: CONTEXT_B_ID,
      objectiveId: OBJECTIVE_B_ID,
      type: "context",
    }));

    expect(options.onOpenObjective).toHaveBeenCalledWith(WORKSPACE_ID, OBJECTIVE_B_ID);
    rerender({ routeObjectiveId: OBJECTIVE_B_ID });
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_B_ID));
    await waitFor(() => expect(result.current.state.selectedContextItemId).toBe(CONTEXT_B_ID));
  });

  it("handles an objective-only agent update by navigating to that objective", async () => {
    const { api } = createApi();
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result, rerender } = renderHook(
      ({ routeObjectiveId }: { routeObjectiveId: string }) => useWorkspace({
        ...options,
        objectiveId: routeObjectiveId,
      }),
      { initialProps: { routeObjectiveId: OBJECTIVE_A_ID } },
    );
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_A_ID));

    act(() => result.current.highlightExternalMutation({
      objectiveId: OBJECTIVE_B_ID,
      type: "objective",
    }));

    expect(options.onOpenObjective).toHaveBeenCalledWith(WORKSPACE_ID, OBJECTIVE_B_ID);
    rerender({ routeObjectiveId: OBJECTIVE_B_ID });
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_B_ID));
  });

  it("fixes an objective context draft to the active objective and sends explicit scope", async () => {
    const { api } = createApi();
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result } = renderHook(() => useWorkspace(options));
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_A_ID));

    act(() => result.current.actions.openContext());
    expect(result.current.state.contextDraft).toMatchObject({ objective_id: OBJECTIVE_A_ID, scope: "objective" });
    act(() => {
      result.current.actions.setContextDraft("title", "Scoped note");
      result.current.actions.setContextDraft("body_markdown", "This only applies to A.");
    });
    act(() => result.current.actions.createContext());

    await waitFor(() => expect(api.createTextContext).toHaveBeenCalledTimes(1));
    expect(api.createTextContext).toHaveBeenCalledWith(
      WORKSPACE_ID,
      expect.objectContaining({ objective_id: OBJECTIVE_A_ID, scope: "objective" }),
    );
  });

  it("records an outcome for an active branch without calling branch completion", async () => {
    const { api } = createApi();
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result } = renderHook(() => useWorkspace(options));
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_A_ID));

    act(() => result.current.actions.openResult(BRANCH_A_ID));
    act(() => {
      result.current.actions.setResultDraft("outcome_status", "unsuccessful");
      result.current.actions.setResultDraft("result_markdown", "The route contradicts the hypothesis.");
    });
    act(() => result.current.actions.submitResult());

    await waitFor(() => expect(api.setReasoningResult).toHaveBeenCalledTimes(1));
    expect(api.setReasoningResult).toHaveBeenCalledWith(
      WORKSPACE_ID,
      OBJECTIVE_A_ID,
      expect.objectContaining({
        outcome_status: "unsuccessful",
        target_id: BRANCH_A_ID,
        target_type: "branch",
      }),
    );
    expect("markEnd" in api).toBe(false);
  });

  it("uses readable plain text in the dependency success toast", async () => {
    const { api, graphA } = createApi();
    const source = graphA.steps[0];
    if (!source) throw new Error("Expected the fixture graph to include a source step.");
    source.title = "Source $\\alpha$";
    const target = {
      ...source,
      id: "91000000-0000-4000-8000-000000000002",
      ordinal: 2,
      title: "Target $\\frac{n}{2}$",
    };
    graphA.steps.push(target);
    const createStepDependency = vi.fn(async () => ({
      created: true,
      dependency_revision: 1,
      source_step_id: source.id,
      step_dependency_id: "92000000-0000-4000-8000-000000000002",
      target_step_id: target.id,
      workspace_id: WORKSPACE_ID,
    }));
    Object.assign(api, { createStepDependency });
    const options = hookOptions(api, OBJECTIVE_A_ID);
    const { result } = renderHook(() => useWorkspace(options));
    await waitFor(() => expect(result.current.graph?.objective.id).toBe(OBJECTIVE_A_ID));

    act(() => result.current.actions.connectSteps(source.id, target.id));

    await waitFor(() => expect(createStepDependency).toHaveBeenCalledOnce());
    expect(createStepDependency).toHaveBeenCalledWith(WORKSPACE_ID, {
      author_type: "human",
      idempotency_key: expect.any(String),
      source_step_id: source.id,
      target_step_id: target.id,
    });
    await waitFor(() => expect(options.pushToast).toHaveBeenCalledWith(
      "Dependency saved: “Target n/2” now depends on “Source α”.",
      "success",
    ));
  });
});
