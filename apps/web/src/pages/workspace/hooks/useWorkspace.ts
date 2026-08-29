import type {
  DecisionInboxItem,
  ObjectiveGraph,
  ResolutionOutcome,
  WorkspaceOverview,
} from "@lemma/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AssumptionDraft,
  ContextDraft,
  ObjectiveDraft,
  ResultDraft,
  StepDraft,
  StrategyDraft,
} from "../components/WorkspaceDialogs";
import type {
  WorkspacePageActions,
  WorkspacePageState,
} from "../WorkspacePage";
import type { ObjectiveStrategyGroup } from "../components/WorkspaceSidebar";
import type { ToastTone } from "../../../components/Primitives";
import { ApiClientError, type LemmaApi } from "../../../lib/api";
import { markdownToPlainText } from "../../../lib/markdownToPlainText";

const EMPTY_STRATEGY: StrategyDraft = {
  description_markdown: "",
  root_branch_name: "Main",
  title: "",
};

const EMPTY_STEP: StepDraft = {
  body_markdown: "",
  concepts: "",
  status: "active",
  summary: "",
  theorem_tags: "",
  title: "",
};

const EMPTY_ASSUMPTION: AssumptionDraft = {
  label: "",
  note_markdown: "",
  statement_markdown: "",
  status: "proposed",
  usage_kind: "used",
};

const EMPTY_CONTEXT: ContextDraft = {
  body_markdown: "",
  file: null,
  mode: "text",
  objective_id: null,
  objective_title: "",
  scope: "workspace",
  source_url: "",
  title: "",
};

const EMPTY_OBJECTIVE: ObjectiveDraft = {
  constraints_markdown: "",
  objective_markdown: "",
  title: "",
};

const EMPTY_RESULT: ResultDraft = {
  outcome_status: "inconclusive",
  result_markdown: "",
  target_id: "",
  target_type: "branch",
};

function initialPageState(): WorkspacePageState {
  return {
    activeDialog: null,
    assumptionDraft: EMPTY_ASSUMPTION,
    branchDraft: { name: "" },
    busy: false,
    cleanSolution: null,
    compareBranchA: "",
    compareBranchB: "",
    comparison: null,
    contextDraft: EMPTY_CONTEXT,
    decisionResolutionMarkdown: "",
    decisionResolutionOutcome: "accepted",
    editingObjectiveId: null,
    editingStepId: null,
    objectiveDraft: EMPTY_OBJECTIVE,
    refreshing: false,
    resultDraft: EMPTY_RESULT,
    selectedBranchId: null,
    selectedContextItemId: null,
    selectedDecisionId: null,
    selectedStepId: null,
    selectedStrategyId: null,
    stepDraft: EMPTY_STEP,
    strategyDraft: EMPTY_STRATEGY,
    targetBranchId: null,
    targetStepId: null,
  };
}

function readableError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "REVISION_CONFLICT") {
      return "The reasoning graph changed before this edit was saved. It has been refreshed; review the latest revision and try again.";
    }
    if (error.code === "NOT_FOUND" || error.code === "WORKSPACE_NOT_FOUND") {
      return "This workspace or reasoning node is no longer available.";
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Lemma could not complete that action.";
}

function parseTags(value: string): string[] {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))].slice(0, 64);
}

interface UseWorkspaceOptions {
  api: LemmaApi;
  objectiveId: string | null;
  onOpenObjective: (workspaceId: string, objectiveId: string) => void;
  onReplaceObjective: (workspaceId: string, objectiveId: string) => void;
  pushToast: (message: string, tone?: ToastTone) => void;
  workspaceId: string | null;
}

export interface ExternalMutationNotice {
  branchId?: string;
  contextItemId?: string;
  objectiveId?: string;
  stepId?: string;
  strategyId?: string;
  type?: "assumption" | "branch" | "context" | "objective" | "step" | "strategy";
}

interface WorkspaceSelection {
  selectedBranchId: string | null;
  selectedStepId: string | null;
  selectedStrategyId: string;
}

function resolveBranchSelection(
  graph: ObjectiveGraph | null,
  branchId: string,
): WorkspaceSelection | null {
  if (!graph) return null;

  const branch = graph.branches.find((item) => item.id === branchId);
  if (!branch) return null;

  const strategy = graph.strategies.find((item) => item.id === branch.strategy_id);
  if (!strategy) return null;

  return {
    selectedBranchId: branch.id,
    selectedStepId: null,
    selectedStrategyId: strategy.id,
  };
}

function resolveStepSelection(
  graph: ObjectiveGraph | null,
  stepId: string,
): WorkspaceSelection | null {
  if (!graph) return null;

  const step = graph.steps.find((item) => item.id === stepId);
  if (!step) return null;

  const branch = graph.branches.find(
    (item) => item.id === step.branch_id && item.strategy_id === step.strategy_id,
  );
  const strategy = graph.strategies.find((item) => item.id === step.strategy_id);
  if (!branch || !strategy) return null;

  return {
    selectedBranchId: branch.id,
    selectedStepId: step.id,
    selectedStrategyId: strategy.id,
  };
}

function firstBranchForStrategy(graph: ObjectiveGraph, strategyId: string): string | null {
  const branches = graph.branches.filter((branch) => branch.strategy_id === strategyId);
  return branches.find((branch) => branch.status === "active")?.id ?? branches[0]?.id ?? null;
}

function resolveExternalMutationSelection(
  graph: ObjectiveGraph,
  notice: ExternalMutationNotice,
): WorkspaceSelection | null {
  if (notice.objectiveId && graph.objective.id !== notice.objectiveId) return null;
  if (notice.type === "objective" || notice.type === "context") return null;

  if (notice.stepId) {
    const stepSelection = resolveStepSelection(graph, notice.stepId);
    return stepSelection
      ? { ...stepSelection, selectedStepId: null }
      : null;
  }
  if (notice.branchId) return resolveBranchSelection(graph, notice.branchId);

  if (notice.strategyId) {
    const strategy = graph.strategies.find((item) => item.id === notice.strategyId);
    if (!strategy) return null;
    return {
      selectedBranchId: firstBranchForStrategy(graph, strategy.id),
      selectedStepId: null,
      selectedStrategyId: strategy.id,
    };
  }

  return null;
}

function objectiveForRoute(overview: WorkspaceOverview, objectiveId: string | null) {
  return overview.objectives.find((objective) => objective.id === objectiveId)
    ?? overview.objectives.find((objective) => objective.status === "active")
    ?? overview.objectives[0]
    ?? null;
}

export interface WorkspaceController {
  actions: WorkspacePageActions;
  error: string | null;
  expandedObjectiveIds: string[];
  graph: ObjectiveGraph | null;
  highlightExternalMutation: (notice?: ExternalMutationNotice) => void;
  loading: boolean;
  loadingObjectiveIds: string[];
  objectiveStrategies: Record<string, ObjectiveStrategyGroup | undefined>;
  overview: WorkspaceOverview | null;
  pendingDecisions: DecisionInboxItem[];
  refreshFromAgent: (signal: AbortSignal) => Promise<void>;
  state: WorkspacePageState;
}

export interface PendingDecisionCounts {
  objectiveIds: Record<string, number>;
  stepIds: Record<string, number>;
  strategyIds: Record<string, number>;
}

export function comparePendingDecisions(left: DecisionInboxItem, right: DecisionInboxItem): number {
  return left.decision.created_at.localeCompare(right.decision.created_at)
    || left.decision.id.localeCompare(right.decision.id);
}

export function pendingDecisionCounts(decisions: readonly DecisionInboxItem[]): PendingDecisionCounts {
  const counts: PendingDecisionCounts = {
    objectiveIds: {},
    stepIds: {},
    strategyIds: {},
  };
  for (const item of decisions) {
    const { objective_id, step_id, strategy_id } = item.ancestry;
    if (objective_id) counts.objectiveIds[objective_id] = (counts.objectiveIds[objective_id] ?? 0) + 1;
    if (strategy_id) counts.strategyIds[strategy_id] = (counts.strategyIds[strategy_id] ?? 0) + 1;
    if (step_id) counts.stepIds[step_id] = (counts.stepIds[step_id] ?? 0) + 1;
  }
  return counts;
}

function oldestPendingDecision(
  decisions: readonly DecisionInboxItem[],
  matches: (item: DecisionInboxItem) => boolean,
): DecisionInboxItem | null {
  return [...decisions].filter(matches).sort(comparePendingDecisions)[0] ?? null;
}

function resolveDecisionSelection(
  graph: ObjectiveGraph | null,
  item: DecisionInboxItem,
): WorkspaceSelection | null {
  if (!graph || item.ancestry.objective_id !== graph.objective.id) return null;
  if (item.ancestry.step_id) return resolveStepSelection(graph, item.ancestry.step_id);
  if (item.ancestry.branch_id) return resolveBranchSelection(graph, item.ancestry.branch_id);
  if (item.ancestry.strategy_id) {
    const strategy = graph.strategies.find((candidate) => candidate.id === item.ancestry.strategy_id);
    return strategy
      ? {
          selectedBranchId: firstBranchForStrategy(graph, strategy.id),
          selectedStepId: null,
          selectedStrategyId: strategy.id,
        }
      : null;
  }
  return null;
}

function decisionTargetSelector(item: DecisionInboxItem): string | null {
  if (item.ancestry.step_id) return `[data-step-id="${item.ancestry.step_id}"]`;
  if (item.ancestry.branch_id) return `[data-branch-id="${item.ancestry.branch_id}"]`;
  if (item.ancestry.strategy_id) return `[data-strategy-id="${item.ancestry.strategy_id}"]`;
  return null;
}

function centerDecisionTarget(item: DecisionInboxItem): void {
  const selector = decisionTargetSelector(item);
  if (!selector) return;
  window.requestAnimationFrame(() => {
    document.querySelector(selector)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });
  });
}

export function useWorkspace({
  api,
  objectiveId,
  onOpenObjective,
  onReplaceObjective,
  pushToast,
  workspaceId,
}: UseWorkspaceOptions): WorkspaceController {
  const [overview, setOverview] = useState<WorkspaceOverview | null>(null);
  const [graph, setGraph] = useState<ObjectiveGraph | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingObjectiveIds, setLoadingObjectiveIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<WorkspacePageState>(() => initialPageState());
  const [expandedObjectiveIds, setExpandedObjectiveIds] = useState<string[]>([]);
  const [objectiveStrategies, setObjectiveStrategies] = useState<Record<string, ObjectiveStrategyGroup | undefined>>({});
  const [pendingDecisions, setPendingDecisions] = useState<DecisionInboxItem[]>([]);
  const graphRef = useRef<ObjectiveGraph | null>(null);
  const overviewRef = useRef<WorkspaceOverview | null>(null);
  const pendingDecisionsRef = useRef<DecisionInboxItem[]>([]);
  const workspaceIdRef = useRef<string | null>(workspaceId);
  const objectiveLoadVersionRef = useRef(0);
  const pendingStrategyDialogObjectiveIdRef = useRef<string | null>(null);
  const pendingStrategyIdRef = useRef<string | null>(null);
  const pendingDecisionFocusRef = useRef<string | null>(null);
  const pendingDecisionOpenDialogRef = useRef(false);
  const pendingExternalMutationRef = useRef<ExternalMutationNotice | null>(null);

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);

  const fetchOverview = useCallback(async (signal?: AbortSignal) => {
    if (!workspaceId) return null;
    const nextOverview = await api.getWorkspaceOverview(workspaceId, signal);
    if (workspaceIdRef.current !== workspaceId) return null;
    overviewRef.current = nextOverview;
    setOverview(nextOverview);
    setError(null);
    return nextOverview;
  }, [api, workspaceId]);

  const fetchPendingDecisions = useCallback(async (signal?: AbortSignal) => {
    if (!workspaceId) return [];
    const result = await api.listPendingDecisions(workspaceId, signal);
    if (workspaceIdRef.current !== workspaceId) return [];
    const decisions = result.decisions;
    pendingDecisionsRef.current = decisions;
    setPendingDecisions(decisions);
    return decisions;
  }, [api, workspaceId]);

  const fetchObjectiveGraph = useCallback(async (nextObjectiveId: string, signal?: AbortSignal) => {
    if (!workspaceId) return null;
    const loadVersion = ++objectiveLoadVersionRef.current;
    setLoadingObjectiveIds((current) => current.includes(nextObjectiveId) ? current : [...current, nextObjectiveId]);
    try {
      const nextGraph = await api.getObjectiveGraph(workspaceId, nextObjectiveId, signal);
      if (workspaceIdRef.current !== workspaceId || loadVersion !== objectiveLoadVersionRef.current) return null;
      graphRef.current = nextGraph;
      setGraph(nextGraph);
      setObjectiveStrategies((current) => ({
        ...current,
        [nextObjectiveId]: {
          branches: nextGraph.branches,
          strategies: nextGraph.strategies,
        },
      }));
      setError(null);
      return nextGraph;
    } finally {
      if (workspaceIdRef.current === workspaceId) {
        setLoadingObjectiveIds((current) => current.filter((item) => item !== nextObjectiveId));
      }
    }
  }, [api, workspaceId]);

  const fetchObjectiveStrategies = useCallback(async (
    nextObjectiveId: string,
    options: { force?: boolean; signal?: AbortSignal } = {},
  ) => {
    const { force = false, signal } = options;
    if (!workspaceId || (!force && objectiveStrategies[nextObjectiveId])) return;
    setLoadingObjectiveIds((current) => current.includes(nextObjectiveId) ? current : [...current, nextObjectiveId]);
    try {
      const result = await api.listStrategies(workspaceId, nextObjectiveId, signal);
      if (workspaceIdRef.current !== workspaceId) return;
      setObjectiveStrategies((current) => ({
        ...current,
        [nextObjectiveId]: {
          branches: result.branches,
          strategies: result.strategies,
        },
      }));
    } catch (loadError) {
      if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
        pushToast(readableError(loadError), "error");
      }
    } finally {
      if (workspaceIdRef.current === workspaceId) {
        setLoadingObjectiveIds((current) => current.filter((item) => item !== nextObjectiveId));
      }
    }
  }, [api, objectiveStrategies, pushToast, workspaceId]);

  useEffect(() => {
    objectiveLoadVersionRef.current += 1;
    graphRef.current = null;
    overviewRef.current = null;
    pendingStrategyDialogObjectiveIdRef.current = null;
    pendingStrategyIdRef.current = null;
    pendingDecisionFocusRef.current = null;
    pendingDecisionOpenDialogRef.current = false;
    pendingExternalMutationRef.current = null;
    setGraph(null);
    setOverview(null);
    setError(null);
    setState(initialPageState());
    setExpandedObjectiveIds([]);
    setObjectiveStrategies({});
    pendingDecisionsRef.current = [];
    setPendingDecisions([]);
    if (!workspaceId) {
      setLoadingOverview(false);
      setLoadingObjectiveIds([]);
      return;
    }

    const controller = new AbortController();
    setLoadingOverview(true);
    void fetchOverview(controller.signal)
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(readableError(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingOverview(false);
      });
    void fetchPendingDecisions(controller.signal).catch((loadError: unknown) => {
      if (!controller.signal.aborted) pushToast(readableError(loadError), "error");
    });

    return () => controller.abort();
  }, [fetchOverview, fetchPendingDecisions, pushToast, workspaceId]);

  useEffect(() => {
    if (!overview || !workspaceId) return;
    const nextObjective = objectiveForRoute(overview, objectiveId);
    if (!nextObjective) {
      graphRef.current = null;
      setGraph(null);
      return;
    }

    setExpandedObjectiveIds((current) => current.includes(nextObjective.id) ? current : [...current, nextObjective.id]);
    if (nextObjective.id !== objectiveId) {
      onReplaceObjective(workspaceId, nextObjective.id);
      return;
    }

    if (graphRef.current?.objective.id === nextObjective.id) return;
    graphRef.current = null;
    setGraph(null);
    void fetchObjectiveGraph(nextObjective.id).catch((loadError: unknown) => {
      setError(readableError(loadError));
    });
  }, [fetchObjectiveGraph, objectiveId, onReplaceObjective, overview, workspaceId]);

  useEffect(() => {
    if (!objectiveId) return;
    setState((current) => ({
      ...current,
      activeDialog: null,
      decisionResolutionMarkdown: "",
      decisionResolutionOutcome: "accepted",
      editingObjectiveId: null,
      editingStepId: null,
      selectedBranchId: null,
      selectedContextItemId: null,
      selectedDecisionId: null,
      selectedStepId: null,
      selectedStrategyId: null,
      targetBranchId: null,
      targetStepId: null,
    }));
  }, [objectiveId]);

  useEffect(() => {
    if (!graph) return;
    const shouldOpenStrategyDialog = pendingStrategyDialogObjectiveIdRef.current === graph.objective.id;
    const pendingStrategyId = pendingStrategyIdRef.current;
    const pendingDecisionId = pendingDecisionFocusRef.current;
    const pendingDecisionShouldOpenDialog = pendingDecisionOpenDialogRef.current;
    const pendingDecision = pendingDecisionId
      ? pendingDecisionsRef.current.find((item) => item.decision.id === pendingDecisionId) ?? null
      : null;
    const pendingDecisionTargetsGraph = pendingDecision
      ? !pendingDecision.ancestry.objective_id || pendingDecision.ancestry.objective_id === graph.objective.id
      : false;
    const pendingDecisionSelection = pendingDecision && pendingDecisionTargetsGraph
      ? resolveDecisionSelection(graph, pendingDecision)
      : null;
    const pendingMutation = pendingExternalMutationRef.current;
    const pendingMutationTargetsGraph = pendingMutation
      ? !pendingMutation.objectiveId || pendingMutation.objectiveId === graph.objective.id
      : false;
    const pendingStrategySelection = pendingStrategyId
      ? graph.strategies.find((strategy) => strategy.id === pendingStrategyId)
      : null;
    const pendingMutationSelection = pendingMutation && pendingMutationTargetsGraph
      ? resolveExternalMutationSelection(graph, pendingMutation)
      : null;
    const pendingContextItemId = pendingMutation?.contextItemId && pendingMutationTargetsGraph
      && graph.effective_context_items.some((item) => item.id === pendingMutation.contextItemId)
      ? pendingMutation.contextItemId
      : null;

    if (shouldOpenStrategyDialog) pendingStrategyDialogObjectiveIdRef.current = null;
    if (pendingStrategySelection) pendingStrategyIdRef.current = null;
    if (pendingDecisionId && !pendingDecision) {
      pendingDecisionFocusRef.current = null;
      pendingDecisionOpenDialogRef.current = false;
    }
    if (pendingDecision && pendingDecisionTargetsGraph) {
      pendingDecisionFocusRef.current = null;
      pendingDecisionOpenDialogRef.current = false;
    }
    if (
      pendingMutationTargetsGraph
      && pendingMutation
      && (
        pendingMutation.type === "objective"
        || pendingMutationSelection !== null
        || pendingContextItemId !== null
      )
    ) {
      pendingExternalMutationRef.current = null;
    }

    setState((current) => {
      const selectedStep = current.selectedStepId
        ? resolveStepSelection(graph, current.selectedStepId)
        : null;
      const externalSelection = pendingDecisionSelection ?? pendingMutationSelection ?? (pendingStrategySelection
        ? {
            selectedBranchId: firstBranchForStrategy(graph, pendingStrategySelection.id),
            selectedStepId: null,
            selectedStrategyId: pendingStrategySelection.id,
          }
        : null);
      const selection = externalSelection ?? selectedStep;

      if (selection) {
        return {
          ...current,
          ...selection,
          ...(shouldOpenStrategyDialog
            ? { activeDialog: "strategy" as const, strategyDraft: EMPTY_STRATEGY }
            : pendingDecision && pendingDecisionTargetsGraph && pendingDecisionShouldOpenDialog
              ? {
                  activeDialog: "decision" as const,
                  decisionResolutionMarkdown: "",
                  decisionResolutionOutcome: "accepted" as ResolutionOutcome,
                  selectedDecisionId: pendingDecision.decision.id,
                }
              : {}),
          selectedContextItemId: pendingContextItemId
            ?? (graph.effective_context_items.some((item) => item.id === current.selectedContextItemId)
              ? current.selectedContextItemId
              : null),
        };
      }

      const strategyId = graph.strategies.some((item) => item.id === current.selectedStrategyId)
        ? current.selectedStrategyId
        : (graph.strategies[0]?.id ?? null);
      const strategyBranches = graph.branches.filter((branch) => branch.strategy_id === strategyId);
      const branchId = strategyBranches.some((branch) => branch.id === current.selectedBranchId)
        ? current.selectedBranchId
        : (strategyBranches.find((branch) => branch.status === "active")?.id ?? strategyBranches[0]?.id ?? null);

      return {
        ...current,
        ...(shouldOpenStrategyDialog
          ? { activeDialog: "strategy" as const, strategyDraft: EMPTY_STRATEGY }
          : pendingDecision && pendingDecisionTargetsGraph && pendingDecisionShouldOpenDialog
            ? {
                activeDialog: "decision" as const,
                decisionResolutionMarkdown: "",
                decisionResolutionOutcome: "accepted" as ResolutionOutcome,
                selectedDecisionId: pendingDecision.decision.id,
              }
            : {}),
        selectedBranchId: branchId,
        selectedContextItemId: pendingContextItemId
          ?? (graph.effective_context_items.some((item) => item.id === current.selectedContextItemId)
            ? current.selectedContextItemId
            : null),
        selectedStepId: null,
        selectedStrategyId: strategyId,
      };
    });

    if (pendingMutation?.stepId) {
      window.requestAnimationFrame(() => {
        document.querySelector(`[data-step-id="${pendingMutation.stepId}"]`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center",
        });
      });
    }
    if (pendingDecision && pendingDecisionTargetsGraph) centerDecisionTarget(pendingDecision);
  }, [graph]);

  const refresh = useCallback(() => {
    if (!workspaceId) return;
    setState((current) => ({ ...current, refreshing: true }));
    void (async () => {
      const [refreshedOverview] = await Promise.all([fetchOverview(), fetchPendingDecisions()]);
      const nextObjective = refreshedOverview ? objectiveForRoute(refreshedOverview, objectiveId) : null;
      if (nextObjective && nextObjective.id === objectiveId) await fetchObjectiveGraph(nextObjective.id);
    })()
      .catch((refreshError: unknown) => {
        const message = readableError(refreshError);
        setError(message);
        pushToast(message, "error");
      })
      .finally(() => setState((current) => ({ ...current, refreshing: false })));
  }, [fetchObjectiveGraph, fetchOverview, fetchPendingDecisions, objectiveId, pushToast, workspaceId]);

  const closeDialog = useCallback(() => {
    setState((current) => ({
      ...current,
      activeDialog: null,
      decisionResolutionMarkdown: "",
      decisionResolutionOutcome: "accepted",
      editingObjectiveId: null,
      editingStepId: null,
      selectedContextItemId: null,
      selectedDecisionId: null,
      targetBranchId: null,
      targetStepId: null,
    }));
  }, []);

  const refreshAfterMutation = useCallback(async (targetObjectiveId: string | null) => {
    await Promise.all([fetchOverview(), fetchPendingDecisions()]);
    if (targetObjectiveId && graphRef.current?.objective.id === targetObjectiveId) {
      await fetchObjectiveGraph(targetObjectiveId);
    }
  }, [fetchObjectiveGraph, fetchOverview, fetchPendingDecisions]);

  const runMutation = useCallback(
    async <T,>(
      operation: () => Promise<T>,
      successMessage: string,
      targetObjectiveId: string | null,
      after?: (result: T) => void,
    ) => {
      setState((current) => ({ ...current, busy: true }));
      try {
        const result = await operation();
        await refreshAfterMutation(targetObjectiveId);
        after?.(result);
        setState((current) => ({
          ...current,
          activeDialog: null,
          busy: false,
          editingObjectiveId: null,
          editingStepId: null,
          selectedContextItemId: null,
          targetBranchId: null,
          targetStepId: null,
        }));
        pushToast(successMessage, "success");
      } catch (mutationError) {
        const message = readableError(mutationError);
        setState((current) => ({ ...current, busy: false }));
        pushToast(message, "error");
        if (mutationError instanceof ApiClientError && mutationError.code === "REVISION_CONFLICT") {
          void refreshAfterMutation(targetObjectiveId).catch(() => undefined);
        }
      }
    },
    [pushToast, refreshAfterMutation],
  );

  const createObjective = useCallback(() => {
    if (!workspaceId) return;
    const draft = state.objectiveDraft;
    setState((current) => ({ ...current, busy: true }));
    void api.createObjective(workspaceId, {
      author_type: "human",
      constraints_markdown: draft.constraints_markdown.trim(),
      idempotency_key: crypto.randomUUID(),
      objective_markdown: draft.objective_markdown.trim(),
      title: draft.title.trim(),
    })
      .then(async (result) => {
        await fetchOverview();
        setState((current) => ({
          ...current,
          activeDialog: null,
          busy: false,
          objectiveDraft: EMPTY_OBJECTIVE,
        }));
        pushToast("Objective created. Add a strategy when you are ready.", "success");
        onOpenObjective(workspaceId, result.objective_id);
      })
      .catch((creationError: unknown) => {
        setState((current) => ({ ...current, busy: false }));
        pushToast(readableError(creationError), "error");
      });
  }, [api, fetchOverview, onOpenObjective, pushToast, state.objectiveDraft, workspaceId]);

  const updateObjective = useCallback(() => {
    const activeGraph = graphRef.current;
    const editingObjectiveId = state.editingObjectiveId;
    if (!workspaceId || !activeGraph || editingObjectiveId !== activeGraph.objective.id) {
      pushToast("Select the objective you want to edit.", "error");
      return;
    }
    const draft = state.objectiveDraft;
    void runMutation(
      () => api.updateObjective(workspaceId, editingObjectiveId, {
        author_type: "human",
        constraints_markdown: draft.constraints_markdown.trim(),
        expected_revision: activeGraph.objective.revision,
        idempotency_key: crypto.randomUUID(),
        objective_markdown: draft.objective_markdown.trim(),
        title: draft.title.trim(),
      }),
      "Objective updated.",
      activeGraph.objective.id,
      () => setState((current) => ({ ...current, objectiveDraft: EMPTY_OBJECTIVE })),
    );
  }, [api, pushToast, runMutation, state.editingObjectiveId, state.objectiveDraft, workspaceId]);

  const createStrategy = useCallback(() => {
    const activeGraph = graphRef.current;
    if (!workspaceId || !activeGraph) {
      pushToast("Create or select an objective before adding a strategy.", "error");
      return;
    }
    const draft = state.strategyDraft;
    void runMutation(
      () => api.createStrategy(workspaceId, activeGraph.objective.id, {
        author_type: "human",
        description_markdown: draft.description_markdown.trim(),
        idempotency_key: crypto.randomUUID(),
        root_branch_name: draft.root_branch_name.trim(),
        title: draft.title.trim(),
      }),
      "Strategy and root branch created.",
      activeGraph.objective.id,
      (result) => setState((current) => ({
        ...current,
        selectedBranchId: result.root_branch_id,
        selectedStrategyId: result.strategy_id,
        strategyDraft: EMPTY_STRATEGY,
      })),
    );
  }, [api, pushToast, runMutation, state.strategyDraft, workspaceId]);

  const createStep = useCallback(() => {
    const activeGraph = graphRef.current;
    const branch = activeGraph?.branches.find((item) => item.id === state.targetBranchId);
    if (!activeGraph || !branch) {
      pushToast("Select an active branch before adding a step.", "error");
      return;
    }
    if (branch.status !== "active") {
      pushToast("A completed or dead-end branch cannot accept new steps.", "error");
      return;
    }
    const draft = state.stepDraft;
    void runMutation(
      () => api.createStep(branch.id, {
        author_type: "human",
        body_markdown: draft.body_markdown.trim(),
        concepts: parseTags(draft.concepts),
        expected_branch_revision: branch.revision,
        idempotency_key: crypto.randomUUID(),
        status: draft.status,
        summary: draft.summary.trim() || null,
        theorem_tags: parseTags(draft.theorem_tags),
        title: draft.title.trim(),
      }),
      "Reasoning step added.",
      activeGraph.objective.id,
      (result) => setState((current) => ({
        ...current,
        selectedBranchId: result.branch_id,
        selectedStepId: null,
        stepDraft: EMPTY_STEP,
      })),
    );
  }, [api, pushToast, runMutation, state.stepDraft, state.targetBranchId]);

  const connectSteps = useCallback((sourceStepId: string, targetStepId: string) => {
    const activeGraph = graphRef.current;
    if (!workspaceId || !activeGraph) return;
    if (sourceStepId === targetStepId) {
      pushToast("A step cannot depend on itself.", "error");
      return;
    }

    const source = activeGraph.steps.find((step) => step.id === sourceStepId);
    const target = activeGraph.steps.find((step) => step.id === targetStepId);
    if (!source || !target) {
      pushToast("Both connected steps must belong to the selected objective.", "error");
      return;
    }

    void runMutation(
      () => api.createStepDependency(workspaceId, {
        idempotency_key: crypto.randomUUID(),
        source_step_id: source.id,
        target_step_id: target.id,
      }),
      `Dependency saved: “${markdownToPlainText(target.title)}” now depends on “${markdownToPlainText(source.title)}”.`,
      activeGraph.objective.id,
      (result) => {
        const selection = resolveStepSelection(graphRef.current, result.target_step_id);
        if (!selection) return;
        setState((current) => ({ ...current, ...selection }));
      },
    );
  }, [api, pushToast, runMutation, workspaceId]);

  const updateStep = useCallback(() => {
    const activeGraph = graphRef.current;
    const step = activeGraph?.steps.find((item) => item.id === state.editingStepId);
    if (!activeGraph || !step) {
      pushToast("Select a step before revising it.", "error");
      return;
    }
    const draft = state.stepDraft;
    void runMutation(
      () => api.updateStep(step.id, {
        author_type: "human",
        body_markdown: draft.body_markdown.trim(),
        concepts: parseTags(draft.concepts),
        expected_step_revision: step.revision,
        idempotency_key: crypto.randomUUID(),
        status: draft.status,
        summary: draft.summary.trim() || null,
        theorem_tags: parseTags(draft.theorem_tags),
        title: draft.title.trim(),
      }),
      "Step revision saved.",
      activeGraph.objective.id,
      (result) => setState((current) => ({ ...current, selectedStepId: result.step_id })),
    );
  }, [api, pushToast, runMutation, state.editingStepId, state.stepDraft]);

  const createBranch = useCallback(() => {
    const activeGraph = graphRef.current;
    const stepId = state.targetStepId;
    if (!activeGraph || !stepId) return;
    void runMutation(
      () => api.branchFromStep(stepId, {
        author_type: "human",
        idempotency_key: crypto.randomUUID(),
        name: state.branchDraft.name.trim(),
      }),
      "New branch created; the original path is preserved.",
      activeGraph.objective.id,
      (result) => setState((current) => ({
        ...current,
        branchDraft: { name: "" },
        selectedBranchId: result.branch_id,
        selectedStrategyId: result.strategy_id,
        selectedStepId: null,
      })),
    );
  }, [api, runMutation, state.branchDraft.name, state.targetStepId]);

  const createAssumption = useCallback(() => {
    const activeGraph = graphRef.current;
    const step = activeGraph?.steps.find((item) => item.id === state.targetStepId);
    if (!activeGraph || !step) return;
    const draft = state.assumptionDraft;
    void runMutation(
      () => api.markAssumption(step.id, {
        assumption_status: draft.status,
        author_type: "human",
        expected_step_revision: step.revision,
        idempotency_key: crypto.randomUUID(),
        label: draft.label.trim(),
        note_markdown: draft.note_markdown.trim(),
        statement_markdown: draft.statement_markdown.trim(),
        usage_kind: draft.usage_kind,
      }),
      "Assumption attached to the step.",
      activeGraph.objective.id,
      () => setState((current) => ({ ...current, assumptionDraft: EMPTY_ASSUMPTION })),
    );
  }, [api, runMutation, state.assumptionDraft, state.targetStepId]);

  const markDeadEnd = useCallback((stepId: string) => {
    const activeGraph = graphRef.current;
    const step = activeGraph?.steps.find((item) => item.id === stepId);
    if (!activeGraph || !step || step.status === "dead_end") return;
    void runMutation(
      () => api.markDeadEnd(step.id, {
        author_type: "human",
        expected_step_revision: step.revision,
        idempotency_key: crypto.randomUUID(),
      }),
      "Dead end marked without deleting its history.",
      activeGraph.objective.id,
      (result) => setState((current) => ({ ...current, selectedStepId: result.step_id })),
    );
  }, [api, runMutation]);

  const createContext = useCallback(() => {
    if (!workspaceId) return;
    const activeGraph = graphRef.current;
    const draft = state.contextDraft;
    if (draft.scope === "objective" && !draft.objective_id) {
      pushToast("Select an objective before adding objective-specific context.", "error");
      return;
    }
    const scopeFields = draft.scope === "objective"
      ? { objective_id: draft.objective_id as string, scope: "objective" as const }
      : { scope: "workspace" as const };
    const common = {
      author_type: "human" as const,
      idempotency_key: crypto.randomUUID(),
      ...scopeFields,
      title: draft.title.trim(),
    };
    let operation: () => Promise<unknown>;
    if (draft.mode === "text") {
      operation = () => api.createTextContext(workspaceId, {
        ...common,
        body_markdown: draft.body_markdown.trim(),
        kind: "text",
        metadata: {},
      });
    } else if (draft.mode === "link") {
      operation = () => api.createLinkContext(workspaceId, {
        ...common,
        body_markdown: draft.body_markdown.trim(),
        kind: "link",
        metadata: {},
        source_url: draft.source_url.trim(),
      });
    } else if (draft.file) {
      const file = draft.file;
      operation = () => api.uploadContext(workspaceId, { ...common, file, metadata: {} });
    } else {
      pushToast("Choose a PDF or image to upload.", "error");
      return;
    }
    void runMutation(
      operation,
      draft.scope === "workspace" ? "General workspace context added." : "Objective-specific context added.",
      draft.scope === "objective" ? draft.objective_id : activeGraph?.objective.id ?? null,
      () => setState((current) => ({ ...current, contextDraft: EMPTY_CONTEXT })),
    );
  }, [api, pushToast, runMutation, state.contextDraft, workspaceId]);

  const downloadContext = useCallback((contextItemId: string) => {
    if (!workspaceId) return;
    void api.getContextDownload(workspaceId, contextItemId)
      .then((result) => window.open(result.signed_url, "_blank", "noopener,noreferrer"))
      .catch((downloadError: unknown) => pushToast(readableError(downloadError), "error"));
  }, [api, pushToast, workspaceId]);

  const runComparison = useCallback(() => {
    if (!state.compareBranchA || !state.compareBranchB) {
      pushToast("Choose two branches to compare.", "error");
      return;
    }
    setState((current) => ({ ...current, busy: true }));
    void api.compareBranches({
      branch_a_id: state.compareBranchA,
      branch_b_id: state.compareBranchB,
    })
      .then((comparison) => setState((current) => ({ ...current, comparison })))
      .catch((compareError: unknown) => pushToast(readableError(compareError), "error"))
      .finally(() => setState((current) => ({ ...current, busy: false })));
  }, [api, pushToast, state.compareBranchA, state.compareBranchB]);

  const generateCleanSolution = useCallback(() => {
    if (!state.selectedBranchId) {
      pushToast("Select a branch to generate its clean solution.", "error");
      return;
    }
    setState((current) => ({ ...current, busy: true }));
    void api.generateCleanSolution(state.selectedBranchId)
      .then((cleanSolution) => setState((current) => ({ ...current, cleanSolution })))
      .catch((solutionError: unknown) => pushToast(readableError(solutionError), "error"))
      .finally(() => setState((current) => ({ ...current, busy: false })));
  }, [api, pushToast, state.selectedBranchId]);

  const saveCleanSolution = useCallback(() => {
    const activeGraph = graphRef.current;
    const branchId = state.cleanSolution?.branch_id;
    if (!activeGraph || !branchId) return;
    void runMutation(
      () => api.saveCleanSolution(branchId, {
        author_type: "human",
        idempotency_key: crypto.randomUUID(),
      }),
      "Clean-solution snapshot saved.",
      activeGraph.objective.id,
    );
  }, [api, runMutation, state.cleanSolution?.branch_id]);

  const copyCleanSolution = useCallback(() => {
    const markdown = state.cleanSolution?.body_markdown;
    if (!markdown) return;
    void navigator.clipboard.writeText(markdown)
      .then(() => pushToast("Markdown copied to the clipboard.", "success"))
      .catch(() => pushToast("The browser could not copy the solution.", "error"));
  }, [pushToast, state.cleanSolution?.body_markdown]);

  const submitResult = useCallback(() => {
    const activeGraph = graphRef.current;
    if (!workspaceId || !activeGraph) return;
    const draft = state.resultDraft;
    const target = draft.target_type === "branch"
      ? activeGraph.branches.find((branch) => branch.id === draft.target_id)
      : activeGraph.strategies.find((strategy) => strategy.id === draft.target_id);
    if (!target) {
      pushToast(`Choose a ${draft.target_type} before recording its outcome.`, "error");
      return;
    }
    const resultMarkdown = draft.result_markdown.trim();
    if (!resultMarkdown) {
      pushToast("Write the outcome before saving it.", "error");
      return;
    }
    const existingResult = activeGraph.reasoning_results.find(
      (result) => result.target_type === draft.target_type && result.target_id === target.id,
    );

    void runMutation(
      () => api.setReasoningResult(workspaceId, activeGraph.objective.id, {
        author_type: "human",
        expected_result_revision: existingResult?.revision ?? null,
        expected_target_revision: target.revision,
        idempotency_key: crypto.randomUUID(),
        outcome_status: draft.outcome_status,
        result_markdown: resultMarkdown,
        target_id: target.id,
        target_type: draft.target_type,
      }),
      "Outcome recorded without changing the branch or strategy status.",
      activeGraph.objective.id,
      () => {
        const selection = draft.target_type === "branch"
          ? resolveBranchSelection(graphRef.current, target.id)
          : graphRef.current?.strategies.some((strategy) => strategy.id === target.id)
            ? {
                selectedBranchId: firstBranchForStrategy(graphRef.current, target.id),
                selectedStepId: null,
                selectedStrategyId: target.id,
              }
            : null;
        setState((current) => ({
          ...current,
          ...(selection ?? {}),
          resultDraft: EMPTY_RESULT,
        }));
      },
    );
  }, [api, pushToast, runMutation, state.resultDraft, workspaceId]);

  const refreshFromAgent = useCallback(async (signal: AbortSignal) => {
    if (!workspaceId) return;
    setState((current) => ({ ...current, refreshing: true }));
    try {
      const [refreshedOverview] = await Promise.all([
        fetchOverview(signal),
        fetchPendingDecisions(signal),
      ]);
      const nextObjective = refreshedOverview ? objectiveForRoute(refreshedOverview, objectiveId) : null;
      if (nextObjective && nextObjective.id === objectiveId) await fetchObjectiveGraph(nextObjective.id, signal);
    } finally {
      setState((current) => ({ ...current, refreshing: false }));
    }
  }, [fetchObjectiveGraph, fetchOverview, fetchPendingDecisions, objectiveId, workspaceId]);

  const selectObjective = useCallback((nextObjectiveId: string) => {
    if (!workspaceId) return;
    setExpandedObjectiveIds((current) => current.includes(nextObjectiveId) ? current : [...current, nextObjectiveId]);
    if (nextObjectiveId === objectiveId) return;
    onOpenObjective(workspaceId, nextObjectiveId);
  }, [objectiveId, onOpenObjective, workspaceId]);

  const openStrategy = useCallback((nextObjectiveId: string) => {
    if (!workspaceId || !nextObjectiveId) {
      pushToast("Create or select an objective before adding a strategy.", "error");
      return;
    }

    if (graphRef.current?.objective.id === nextObjectiveId) {
      setState((current) => ({
        ...current,
        activeDialog: "strategy",
        strategyDraft: EMPTY_STRATEGY,
      }));
      return;
    }

    pendingStrategyDialogObjectiveIdRef.current = nextObjectiveId;
    setExpandedObjectiveIds((current) => current.includes(nextObjectiveId)
      ? current
      : [...current, nextObjectiveId]);
    if (objectiveId !== nextObjectiveId) onOpenObjective(workspaceId, nextObjectiveId);
  }, [objectiveId, onOpenObjective, pushToast, workspaceId]);

  const toggleObjective = useCallback((nextObjectiveId: string) => {
    const wasExpanded = expandedObjectiveIds.includes(nextObjectiveId);
    setExpandedObjectiveIds((current) => wasExpanded
      ? current.filter((item) => item !== nextObjectiveId)
      : [...current, nextObjectiveId]);
    if (!wasExpanded) void fetchObjectiveStrategies(nextObjectiveId);
  }, [expandedObjectiveIds, fetchObjectiveStrategies]);

  const selectStrategy = useCallback((strategyId: string) => {
    const activeGraph = graphRef.current;
    const activeStrategy = activeGraph?.strategies.find((strategy) => strategy.id === strategyId);
    if (activeGraph && activeStrategy) {
      setState((current) => ({
        ...current,
        selectedBranchId: firstBranchForStrategy(activeGraph, strategyId),
        selectedStepId: null,
        selectedStrategyId: strategyId,
      }));
      return;
    }

    const otherStrategy = Object.values(objectiveStrategies)
      .flatMap((group) => group?.strategies ?? [])
      .find((strategy) => strategy.id === strategyId);
    if (!workspaceId || !otherStrategy) return;
    pendingStrategyIdRef.current = strategyId;
    onOpenObjective(workspaceId, otherStrategy.objective_id);
  }, [objectiveStrategies, onOpenObjective, workspaceId]);

  const focusPendingDecision = useCallback((item: DecisionInboxItem, openDialog: boolean) => {
    const targetObjectiveId = item.ancestry.objective_id;
    const activeGraph = graphRef.current;
    if (targetObjectiveId && activeGraph?.objective.id !== targetObjectiveId) {
      pendingDecisionFocusRef.current = item.decision.id;
      pendingDecisionOpenDialogRef.current = openDialog;
      setExpandedObjectiveIds((current) => current.includes(targetObjectiveId)
        ? current
        : [...current, targetObjectiveId]);
      if (workspaceId && objectiveId !== targetObjectiveId) {
        onOpenObjective(workspaceId, targetObjectiveId);
      } else {
        void fetchObjectiveGraph(targetObjectiveId).catch((loadError: unknown) => {
          pushToast(readableError(loadError), "error");
        });
      }
      return;
    }

    const selection = resolveDecisionSelection(activeGraph, item);
    setState((current) => {
      const alreadyOpen = current.activeDialog === "decision"
        && current.selectedDecisionId === item.decision.id;
      return {
        ...current,
        ...(selection ?? {}),
        ...(openDialog && !alreadyOpen
          ? {
              activeDialog: "decision" as const,
              decisionResolutionMarkdown: "",
              decisionResolutionOutcome: "accepted" as ResolutionOutcome,
              selectedDecisionId: item.decision.id,
            }
          : {}),
      };
    });
    centerDecisionTarget(item);
  }, [fetchObjectiveGraph, objectiveId, onOpenObjective, pushToast, workspaceId]);

  const openPendingDecision = useCallback((stepId: string) => {
    const item = oldestPendingDecision(
      pendingDecisionsRef.current,
      (candidate) => candidate.ancestry.step_id === stepId,
    );
    if (!item) {
      pushToast("That human checkpoint is no longer pending.", "info");
      return;
    }
    focusPendingDecision(item, true);
  }, [focusPendingDecision, pushToast]);

  const openOldestPendingDecisionForObjective = useCallback((targetObjectiveId: string) => {
    const item = oldestPendingDecision(
      pendingDecisionsRef.current,
      (candidate) => candidate.ancestry.objective_id === targetObjectiveId,
    );
    if (item) focusPendingDecision(item, false);
  }, [focusPendingDecision]);

  const openOldestPendingDecisionForStrategy = useCallback((strategyId: string) => {
    const item = oldestPendingDecision(
      pendingDecisionsRef.current,
      (candidate) => candidate.ancestry.strategy_id === strategyId,
    );
    if (item) focusPendingDecision(item, false);
  }, [focusPendingDecision]);

  const resolveDecision = useCallback(() => {
    const item = state.selectedDecisionId
      ? pendingDecisionsRef.current.find((candidate) => candidate.decision.id === state.selectedDecisionId) ?? null
      : null;
    if (!item) {
      pushToast("That human checkpoint is no longer pending.", "info");
      closeDialog();
      return;
    }

    const guidance = state.decisionResolutionMarkdown.trim();
    if (state.decisionResolutionOutcome === "redirected" && !guidance) {
      pushToast("Add guidance before redirecting the agent.", "error");
      return;
    }

    const resolutionMarkdown = guidance || "Continue as proposed.";
    const activeObjectiveId = graphRef.current?.objective.id ?? null;
    setState((current) => ({ ...current, busy: true }));
    void api.resolveDecision(item.decision.id, {
      expected_decision_revision: item.decision.revision,
      idempotency_key: crypto.randomUUID(),
      resolution_markdown: resolutionMarkdown,
      resolution_outcome: state.decisionResolutionOutcome,
    })
      .then(async () => {
        await refreshAfterMutation(activeObjectiveId);
        setState((current) => ({
          ...current,
          activeDialog: null,
          busy: false,
          decisionResolutionMarkdown: "",
          decisionResolutionOutcome: "accepted",
          selectedDecisionId: null,
        }));
        pushToast(
          state.decisionResolutionOutcome === "redirected"
            ? "Redirection saved to the shared reasoning graph."
            : "Decision saved to the shared reasoning graph.",
          "success",
        );
      })
      .catch((resolveError: unknown) => {
        setState((current) => ({ ...current, busy: false }));
        pushToast(readableError(resolveError), "error");
        if (resolveError instanceof ApiClientError && resolveError.code === "REVISION_CONFLICT") {
          void refreshAfterMutation(activeObjectiveId).catch(() => undefined);
        }
      });
  }, [api, closeDialog, pushToast, refreshAfterMutation, state.decisionResolutionMarkdown, state.decisionResolutionOutcome, state.selectedDecisionId]);

  const highlightExternalMutation = useCallback((notice?: ExternalMutationNotice) => {
    if (!notice) {
      pushToast("The agent updated the shared reasoning graph.", "info");
      return;
    }

    const activeGraph = graphRef.current;
    const targetObjectiveId = notice.objectiveId
      ?? (notice.strategyId
        ? Object.values(objectiveStrategies)
          .flatMap((group) => group?.strategies ?? [])
          .find((strategy) => strategy.id === notice.strategyId)?.objective_id
        : undefined);
    const targetNeedsNavigation = Boolean(
      workspaceId
      && targetObjectiveId
      && objectiveId !== targetObjectiveId,
    );
    const targetNeedsGraph = Boolean(
      targetObjectiveId
      && activeGraph?.objective.id !== targetObjectiveId,
    );
    if (workspaceId && targetObjectiveId) {
      setObjectiveStrategies((current) => {
        const next = { ...current };
        delete next[targetObjectiveId];
        return next;
      });
      void fetchObjectiveStrategies(targetObjectiveId, { force: true });
    }
    if (workspaceId && targetObjectiveId && (targetNeedsNavigation || targetNeedsGraph)) {
      pendingExternalMutationRef.current = notice;
      setExpandedObjectiveIds((current) => current.includes(targetObjectiveId)
        ? current
        : [...current, targetObjectiveId]);
      if (targetNeedsNavigation) onOpenObjective(workspaceId, targetObjectiveId);
      pushToast("The agent updated an objective; it is now selected.", "info");
      return;
    }

    if (activeGraph) {
      // A refreshed step may be scrolled into view, but only a direct node click
      // is allowed to change the step currently open in the inspector.
      const selection = notice.stepId
        ? null
        : resolveExternalMutationSelection(activeGraph, notice);
      const contextItemId = notice.contextItemId
        && activeGraph.effective_context_items.some((item) => item.id === notice.contextItemId)
        ? notice.contextItemId
        : null;
      if (selection || contextItemId) {
        setState((current) => ({
          ...current,
          ...(selection ?? {}),
          ...(contextItemId ? { selectedContextItemId: contextItemId } : {}),
        }));
      }
    }
    pushToast("The agent updated the shared reasoning graph.", "info");

    if (notice.stepId) {
      window.requestAnimationFrame(() => {
        document.querySelector(`[data-step-id="${notice.stepId}"]`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center",
        });
      });
    }
  }, [fetchObjectiveStrategies, objectiveId, objectiveStrategies, onOpenObjective, pushToast, workspaceId]);

  const actions = useMemo<WorkspacePageActions>(() => ({
    closeDialog,
    connectSteps,
    copyCleanSolution,
    createAssumption,
    createBranch,
    createContext,
    createObjective,
    createStep,
    createStrategy,
    downloadContext,
    generateCleanSolution,
    goBack: () => undefined,
    markDeadEnd,
    openOldestPendingDecisionForObjective,
    openOldestPendingDecisionForStrategy,
    openPendingDecision,
    openAssumption: (stepId) => setState((current) => ({
      ...current,
      activeDialog: "assumption",
      assumptionDraft: EMPTY_ASSUMPTION,
      targetStepId: stepId,
    })),
    openBranch: (stepId) => setState((current) => ({
      ...current,
      activeDialog: "branch",
      branchDraft: { name: "" },
      targetStepId: stepId,
    })),
    openCleanSolution: () => {
      if (!state.selectedBranchId) {
        pushToast("Create or select a branch first.", "error");
        return;
      }
      setState((current) => ({ ...current, activeDialog: "clean", cleanSolution: null }));
    },
    openCompare: () => {
      const activeGraph = graphRef.current;
      const branches = activeGraph?.branches.filter((branch) => branch.strategy_id === state.selectedStrategyId) ?? [];
      const first = state.selectedBranchId ?? branches[0]?.id ?? "";
      const second = branches.find((branch) => branch.id !== first)?.id ?? "";
      setState((current) => ({
        ...current,
        activeDialog: "compare",
        compareBranchA: first,
        compareBranchB: second,
        comparison: null,
      }));
    },
    openContext: () => {
      const activeGraph = graphRef.current;
      setState((current) => ({
        ...current,
        activeDialog: "context",
        contextDraft: {
          ...EMPTY_CONTEXT,
          objective_id: activeGraph?.objective.id ?? null,
          objective_title: activeGraph?.objective.title ?? "",
          scope: activeGraph ? "objective" : "workspace",
        },
      }));
    },
    openContextItem: (contextItemId) => setState((current) => ({
      ...current,
      activeDialog: "contextItem",
      selectedContextItemId: contextItemId,
    })),
    openContextLink: (contextItemId) => {
      const sourceUrl = graphRef.current?.effective_context_items.find((item) => item.id === contextItemId)?.source_url
        ?? overviewRef.current?.general_context_items.find((item) => item.id === contextItemId)?.source_url;
      if (sourceUrl) window.open(sourceUrl, "_blank", "noopener,noreferrer");
    },
    openEditObjective: (nextObjectiveId) => {
      const activeGraph = graphRef.current;
      if (!activeGraph || activeGraph.objective.id !== nextObjectiveId) {
        selectObjective(nextObjectiveId);
        return;
      }
      const { objective } = activeGraph;
      setState((current) => ({
        ...current,
        activeDialog: "objective",
        editingObjectiveId: objective.id,
        objectiveDraft: {
          constraints_markdown: objective.constraints_markdown,
          objective_markdown: objective.objective_markdown,
          title: objective.title,
        },
      }));
    },
    openEditStep: (stepId) => {
      const step = graphRef.current?.steps.find((item) => item.id === stepId);
      if (!step) return;
      setState((current) => ({
        ...current,
        activeDialog: "step",
        editingStepId: step.id,
        stepDraft: {
          body_markdown: step.body_markdown,
          concepts: step.concepts.join(", "),
          status: step.status === "draft" ? "draft" : "active",
          summary: step.summary ?? "",
          theorem_tags: step.theorem_tags.join(", "),
          title: step.title,
        },
        targetBranchId: step.branch_id,
      }));
    },
    openNewObjective: () => setState((current) => ({
      ...current,
      activeDialog: "objective",
      editingObjectiveId: null,
      objectiveDraft: EMPTY_OBJECTIVE,
    })),
    openNewStep: (branchId) => {
      const selection = resolveBranchSelection(graphRef.current, branchId);
      if (!selection) return;
      setState((current) => ({
        ...current,
        ...selection,
        activeDialog: "step",
        editingStepId: null,
        stepDraft: EMPTY_STEP,
        targetBranchId: selection.selectedBranchId,
      }));
    },
    openResult: (branchId) => {
      const activeGraph = graphRef.current;
      if (!activeGraph) return;
      const targetBranch = branchId
        ? activeGraph.branches.find((branch) => branch.id === branchId)
        : activeGraph.branches.find((branch) => branch.id === state.selectedBranchId);
      const targetType = targetBranch ? "branch" : "strategy";
      const targetId = targetBranch?.id ?? state.selectedStrategyId ?? activeGraph.strategies[0]?.id ?? "";
      if (!targetId) {
        pushToast("Create or select a strategy or branch first.", "error");
        return;
      }
      const existingResult = activeGraph.reasoning_results.find(
        (result) => result.target_type === targetType && result.target_id === targetId,
      );
      const selection = targetType === "branch"
        ? resolveBranchSelection(activeGraph, targetId)
        : {
            selectedBranchId: firstBranchForStrategy(activeGraph, targetId),
            selectedStepId: null,
            selectedStrategyId: targetId,
          };
      setState((current) => ({
        ...current,
        ...selection,
        activeDialog: "result",
        resultDraft: {
          outcome_status: existingResult?.outcome_status ?? "inconclusive",
          result_markdown: existingResult?.result_markdown ?? "",
          target_id: targetId,
          target_type: targetType,
        },
      }));
    },
    openStrategy,
    refresh,
    resolveDecision,
    runComparison,
    saveCleanSolution,
    selectBranch: (branchId) => {
      const selection = resolveBranchSelection(graphRef.current, branchId);
      if (!selection) return;
      setState((current) => ({ ...current, ...selection }));
    },
    selectObjective,
    selectStep: (stepId) => {
      if (!stepId) {
        setState((current) => ({ ...current, selectedStepId: null }));
        return;
      }
      const selection = resolveStepSelection(graphRef.current, stepId);
      if (!selection) return;
      setState((current) => ({ ...current, ...selection }));
    },
    selectStrategy,
    setAssumptionDraft: (field, value) => setState((current) => ({
      ...current,
      assumptionDraft: { ...current.assumptionDraft, [field]: value },
    })),
    setBranchDraft: (value) => setState((current) => ({ ...current, branchDraft: { name: value } })),
    setCompareBranchA: (branchId) => setState((current) => ({ ...current, compareBranchA: branchId, comparison: null })),
    setCompareBranchB: (branchId) => setState((current) => ({ ...current, compareBranchB: branchId, comparison: null })),
    setContextDraft: (field, value) => setState((current) => ({
      ...current,
      contextDraft: { ...current.contextDraft, [field]: value },
    } as WorkspacePageState)),
    setDecisionResolutionMarkdown: (value) => setState((current) => ({
      ...current,
      decisionResolutionMarkdown: value,
    })),
    setDecisionResolutionOutcome: (value) => setState((current) => ({
      ...current,
      decisionResolutionOutcome: value,
    })),
    setObjectiveDraft: (field, value) => setState((current) => ({
      ...current,
      objectiveDraft: { ...current.objectiveDraft, [field]: value },
    })),
    setResultDraft: (field, value) => setState((current) => {
      if (field !== "target_type") {
        return { ...current, resultDraft: { ...current.resultDraft, [field]: value } } as WorkspacePageState;
      }
      const targetType = value === "strategy" ? "strategy" : "branch";
      const activeGraph = graphRef.current;
      const targetId = targetType === "branch"
        ? current.selectedBranchId ?? activeGraph?.branches[0]?.id ?? ""
        : current.selectedStrategyId ?? activeGraph?.strategies[0]?.id ?? "";
      const existingResult = activeGraph?.reasoning_results.find(
        (result) => result.target_type === targetType && result.target_id === targetId,
      );
      return {
        ...current,
        resultDraft: {
          outcome_status: existingResult?.outcome_status ?? "inconclusive",
          result_markdown: existingResult?.result_markdown ?? "",
          target_id: targetId,
          target_type: targetType,
        },
      };
    }),
    setStepDraft: (field, value) => setState((current) => ({
      ...current,
      stepDraft: { ...current.stepDraft, [field]: value },
    })),
    setStrategyDraft: (field, value) => setState((current) => ({
      ...current,
      strategyDraft: { ...current.strategyDraft, [field]: value },
    })),
    submitResult,
    submitStep: () => {
      if (state.editingStepId) updateStep();
      else createStep();
    },
    toggleObjective,
    updateObjective,
  }), [
    closeDialog,
    connectSteps,
    copyCleanSolution,
    createAssumption,
    createBranch,
    createContext,
    createObjective,
    createStep,
    createStrategy,
    downloadContext,
    generateCleanSolution,
    markDeadEnd,
    openOldestPendingDecisionForObjective,
    openOldestPendingDecisionForStrategy,
    openPendingDecision,
    openStrategy,
    pushToast,
    refresh,
    resolveDecision,
    runComparison,
    saveCleanSolution,
    selectObjective,
    selectStrategy,
    state.editingStepId,
    state.selectedBranchId,
    state.selectedStrategyId,
    submitResult,
    toggleObjective,
    updateObjective,
    updateStep,
  ]);

  return useMemo(
    () => ({
      actions,
      error,
      expandedObjectiveIds,
      graph,
      highlightExternalMutation,
      loading: loadingOverview || loadingObjectiveIds.length > 0,
      loadingObjectiveIds,
      objectiveStrategies,
      overview,
      pendingDecisions,
      refreshFromAgent,
      state,
    }),
    [
      actions,
      error,
      expandedObjectiveIds,
      graph,
      highlightExternalMutation,
      loadingObjectiveIds,
      loadingOverview,
      objectiveStrategies,
      overview,
      pendingDecisions,
      refreshFromAgent,
      state,
    ],
  );
}
