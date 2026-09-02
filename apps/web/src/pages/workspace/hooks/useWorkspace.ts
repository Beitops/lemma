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
import {
  useWorkspaceRealtime,
  type WorkspaceRealtimeInvalidation,
  type WorkspaceRealtimeStatus,
} from "./useWorkspaceRealtime";

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

type RevisionEditSession =
  | { entityId: string; kind: "assumption" | "step"; revision: number }
  | { entityId: string; kind: "new-step"; revision: number }
  | { entityId: string; kind: "objective"; revision: number }
  | {
      kind: "result";
      resultRevision: number | null;
      targetId: string;
      targetRevision: number;
      targetType: "branch" | "strategy";
    };

const STALE_DRAFT_MESSAGE = "This draft is based on an older graph revision. Close it and reopen the latest version before saving.";

function resultEditSession(
  graph: ObjectiveGraph,
  targetType: "branch" | "strategy",
  targetId: string,
): RevisionEditSession | null {
  const target = targetType === "branch"
    ? graph.branches.find((branch) => branch.id === targetId)
    : graph.strategies.find((strategy) => strategy.id === targetId);
  if (!target) return null;
  const result = graph.reasoning_results.find(
    (candidate) => candidate.target_type === targetType && candidate.target_id === targetId,
  );
  return {
    kind: "result",
    resultRevision: result?.revision ?? null,
    targetId,
    targetRevision: target.revision,
    targetType,
  };
}

function revisionEditConflict(
  graph: ObjectiveGraph | null,
  session: RevisionEditSession | null,
): string | null {
  if (!graph || !session) return null;

  if (session.kind === "objective") {
    return graph.objective.id === session.entityId && graph.objective.revision === session.revision
      ? null
      : STALE_DRAFT_MESSAGE;
  }
  if (session.kind === "new-step") {
    const branch = graph.branches.find((candidate) => candidate.id === session.entityId);
    return branch?.revision === session.revision ? null : STALE_DRAFT_MESSAGE;
  }
  if (session.kind === "step" || session.kind === "assumption") {
    const step = graph.steps.find((candidate) => candidate.id === session.entityId);
    return step?.revision === session.revision ? null : STALE_DRAFT_MESSAGE;
  }

  if (session.kind === "result") {
    const target = session.targetType === "branch"
      ? graph.branches.find((branch) => branch.id === session.targetId)
      : graph.strategies.find((strategy) => strategy.id === session.targetId);
    const result = graph.reasoning_results.find(
      (candidate) => candidate.target_type === session.targetType && candidate.target_id === session.targetId,
    );
    return target?.revision === session.targetRevision
      && (result?.revision ?? null) === session.resultRevision
      ? null
      : STALE_DRAFT_MESSAGE;
  }

  return STALE_DRAFT_MESSAGE;
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
  draftConflict: string | null;
  error: string | null;
  expandedObjectiveIds: string[];
  graph: ObjectiveGraph | null;
  highlightExternalMutation: (notice?: ExternalMutationNotice) => void;
  loading: boolean;
  loadingObjectiveIds: string[];
  objectiveStrategies: Record<string, ObjectiveStrategyGroup | undefined>;
  overview: WorkspaceOverview | null;
  pendingDecisions: DecisionInboxItem[];
  realtimeStatus: WorkspaceRealtimeStatus;
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
  const [draftConflict, setDraftConflict] = useState<string | null>(null);
  const graphRef = useRef<ObjectiveGraph | null>(null);
  const overviewRef = useRef<WorkspaceOverview | null>(null);
  const pendingDecisionsRef = useRef<DecisionInboxItem[]>([]);
  const workspaceIdRef = useRef<string | null>(workspaceId);
  const overviewLoadVersionRef = useRef(0);
  const pendingDecisionLoadVersionRef = useRef(0);
  const objectiveLoadVersionRef = useRef(0);
  const objectiveStrategyLoadVersionsRef = useRef(new Map<string, number>());
  const objectiveLoadingCountsRef = useRef(new Map<string, number>());
  const refreshingOperationsRef = useRef(new Set<symbol>());
  const revisionEditSessionRef = useRef<RevisionEditSession | null>(null);
  const pendingStrategyDialogObjectiveIdRef = useRef<string | null>(null);
  const pendingStrategyIdRef = useRef<string | null>(null);
  const pendingDecisionFocusRef = useRef<string | null>(null);
  const pendingDecisionOpenDialogRef = useRef(false);
  const pendingExternalMutationRef = useRef<ExternalMutationNotice | null>(null);

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);

  const beginRefreshing = useCallback(() => {
    const operation = Symbol("workspace-refresh");
    refreshingOperationsRef.current.add(operation);
    setState((current) => current.refreshing ? current : { ...current, refreshing: true });
    return operation;
  }, []);

  const endRefreshing = useCallback((operation: symbol) => {
    refreshingOperationsRef.current.delete(operation);
    if (refreshingOperationsRef.current.size === 0) {
      setState((current) => current.refreshing ? { ...current, refreshing: false } : current);
    }
  }, []);

  const fetchOverview = useCallback(async (signal?: AbortSignal) => {
    if (!workspaceId) return null;
    const loadVersion = ++overviewLoadVersionRef.current;
    const nextOverview = await api.getWorkspaceOverview(workspaceId, signal);
    if (
      workspaceIdRef.current !== workspaceId
      || loadVersion !== overviewLoadVersionRef.current
    ) return null;
    overviewRef.current = nextOverview;
    setOverview(nextOverview);
    setError(null);
    return nextOverview;
  }, [api, workspaceId]);

  const fetchPendingDecisions = useCallback(async (signal?: AbortSignal) => {
    if (!workspaceId) return [];
    const loadVersion = ++pendingDecisionLoadVersionRef.current;
    const result = await api.listPendingDecisions(workspaceId, signal);
    if (
      workspaceIdRef.current !== workspaceId
      || loadVersion !== pendingDecisionLoadVersionRef.current
    ) return [];
    const decisions = result.decisions;
    pendingDecisionsRef.current = decisions;
    setPendingDecisions(decisions);
    return decisions;
  }, [api, workspaceId]);

  const fetchObjectiveGraph = useCallback(async (nextObjectiveId: string, signal?: AbortSignal) => {
    if (!workspaceId) return null;
    const loadVersion = ++objectiveLoadVersionRef.current;
    const previousStrategyCacheVersion = objectiveStrategyLoadVersionsRef.current.get(nextObjectiveId) ?? 0;
    const strategyCacheVersion = previousStrategyCacheVersion + 1;
    objectiveStrategyLoadVersionsRef.current.set(nextObjectiveId, strategyCacheVersion);
    const releaseStrategyCacheVersion = () => {
      if (objectiveStrategyLoadVersionsRef.current.get(nextObjectiveId) === strategyCacheVersion) {
        objectiveStrategyLoadVersionsRef.current.set(nextObjectiveId, previousStrategyCacheVersion);
      }
    };
    objectiveLoadingCountsRef.current.set(
      nextObjectiveId,
      (objectiveLoadingCountsRef.current.get(nextObjectiveId) ?? 0) + 1,
    );
    setLoadingObjectiveIds((current) => current.includes(nextObjectiveId) ? current : [...current, nextObjectiveId]);
    try {
      const nextGraph = await api.getObjectiveGraph(workspaceId, nextObjectiveId, signal);
      if (workspaceIdRef.current !== workspaceId || loadVersion !== objectiveLoadVersionRef.current) {
        releaseStrategyCacheVersion();
        return null;
      }
      graphRef.current = nextGraph;
      setGraph(nextGraph);
      if (objectiveStrategyLoadVersionsRef.current.get(nextObjectiveId) === strategyCacheVersion) {
        setObjectiveStrategies((current) => ({
          ...current,
          [nextObjectiveId]: {
            branches: nextGraph.branches,
            strategies: nextGraph.strategies,
          },
        }));
      }
      setError(null);
      return nextGraph;
    } catch (loadError) {
      releaseStrategyCacheVersion();
      throw loadError;
    } finally {
      if (workspaceIdRef.current === workspaceId) {
        const remaining = Math.max(
          0,
          (objectiveLoadingCountsRef.current.get(nextObjectiveId) ?? 1) - 1,
        );
        if (remaining > 0) objectiveLoadingCountsRef.current.set(nextObjectiveId, remaining);
        else {
          objectiveLoadingCountsRef.current.delete(nextObjectiveId);
          setLoadingObjectiveIds((current) => current.filter((item) => item !== nextObjectiveId));
        }
      }
    }
  }, [api, workspaceId]);

  const fetchObjectiveStrategies = useCallback(async (
    nextObjectiveId: string,
    options: { force?: boolean; signal?: AbortSignal; silent?: boolean } = {},
  ) => {
    const { force = false, signal, silent = false } = options;
    if (!workspaceId || (!force && objectiveStrategies[nextObjectiveId])) return;
    const previousLoadVersion = objectiveStrategyLoadVersionsRef.current.get(nextObjectiveId) ?? 0;
    const loadVersion = previousLoadVersion + 1;
    objectiveStrategyLoadVersionsRef.current.set(nextObjectiveId, loadVersion);
    objectiveLoadingCountsRef.current.set(
      nextObjectiveId,
      (objectiveLoadingCountsRef.current.get(nextObjectiveId) ?? 0) + 1,
    );
    setLoadingObjectiveIds((current) => current.includes(nextObjectiveId) ? current : [...current, nextObjectiveId]);
    try {
      const result = await api.listStrategies(workspaceId, nextObjectiveId, signal);
      if (
        workspaceIdRef.current !== workspaceId
        || objectiveStrategyLoadVersionsRef.current.get(nextObjectiveId) !== loadVersion
      ) return;
      setObjectiveStrategies((current) => ({
        ...current,
        [nextObjectiveId]: {
          branches: result.branches,
          strategies: result.strategies,
        },
      }));
    } catch (loadError) {
      if (objectiveStrategyLoadVersionsRef.current.get(nextObjectiveId) === loadVersion) {
        objectiveStrategyLoadVersionsRef.current.set(nextObjectiveId, previousLoadVersion);
        const currentGraph = graphRef.current;
        if (currentGraph?.objective.id === nextObjectiveId) {
          setObjectiveStrategies((current) => ({
            ...current,
            [nextObjectiveId]: {
              branches: currentGraph.branches,
              strategies: currentGraph.strategies,
            },
          }));
        }
      }
      if (silent) throw loadError;
      if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
        pushToast(readableError(loadError), "error");
      }
    } finally {
      if (workspaceIdRef.current === workspaceId) {
        const remaining = Math.max(
          0,
          (objectiveLoadingCountsRef.current.get(nextObjectiveId) ?? 1) - 1,
        );
        if (remaining > 0) objectiveLoadingCountsRef.current.set(nextObjectiveId, remaining);
        else {
          objectiveLoadingCountsRef.current.delete(nextObjectiveId);
          setLoadingObjectiveIds((current) => current.filter((item) => item !== nextObjectiveId));
        }
      }
    }
  }, [api, objectiveStrategies, pushToast, workspaceId]);

  useEffect(() => {
    overviewLoadVersionRef.current += 1;
    pendingDecisionLoadVersionRef.current += 1;
    objectiveLoadVersionRef.current += 1;
    objectiveStrategyLoadVersionsRef.current.clear();
    objectiveLoadingCountsRef.current.clear();
    refreshingOperationsRef.current.clear();
    revisionEditSessionRef.current = null;
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
    setDraftConflict(null);
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
    revisionEditSessionRef.current = null;
    setDraftConflict(null);
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
    setDraftConflict(revisionEditConflict(graph, revisionEditSessionRef.current));
  }, [graph]);

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
    const refreshOperation = beginRefreshing();
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
      .finally(() => endRefreshing(refreshOperation));
  }, [beginRefreshing, endRefreshing, fetchObjectiveGraph, fetchOverview, fetchPendingDecisions, objectiveId, pushToast, workspaceId]);

  const closeDialog = useCallback(() => {
    revisionEditSessionRef.current = null;
    setDraftConflict(null);
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

  const rejectStaleDraft = useCallback(() => {
    setDraftConflict(STALE_DRAFT_MESSAGE);
    pushToast(STALE_DRAFT_MESSAGE, "error");
  }, [pushToast]);

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
        revisionEditSessionRef.current = null;
        setDraftConflict(null);
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
          setDraftConflict(STALE_DRAFT_MESSAGE);
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
    const editSession = revisionEditSessionRef.current;
    if (
      editSession?.kind !== "objective"
      || editSession.entityId !== editingObjectiveId
      || editSession.revision !== activeGraph.objective.revision
    ) {
      rejectStaleDraft();
      return;
    }
    const draft = state.objectiveDraft;
    void runMutation(
      () => api.updateObjective(workspaceId, editingObjectiveId, {
        author_type: "human",
        constraints_markdown: draft.constraints_markdown.trim(),
        expected_revision: editSession.revision,
        idempotency_key: crypto.randomUUID(),
        objective_markdown: draft.objective_markdown.trim(),
        title: draft.title.trim(),
      }),
      "Objective updated.",
      activeGraph.objective.id,
      () => setState((current) => ({ ...current, objectiveDraft: EMPTY_OBJECTIVE })),
    );
  }, [api, pushToast, rejectStaleDraft, runMutation, state.editingObjectiveId, state.objectiveDraft, workspaceId]);

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
    const editSession = revisionEditSessionRef.current;
    if (
      editSession?.kind !== "new-step"
      || editSession.entityId !== branch.id
      || editSession.revision !== branch.revision
    ) {
      rejectStaleDraft();
      return;
    }
    const draft = state.stepDraft;
    void runMutation(
      () => api.createStep(branch.id, {
        author_type: "human",
        body_markdown: draft.body_markdown.trim(),
        concepts: parseTags(draft.concepts),
        depends_on_step_ids: [],
        expected_branch_revision: editSession.revision,
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
  }, [api, pushToast, rejectStaleDraft, runMutation, state.stepDraft, state.targetBranchId]);

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
        author_type: "human",
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
    const editSession = revisionEditSessionRef.current;
    if (
      editSession?.kind !== "step"
      || editSession.entityId !== step.id
      || editSession.revision !== step.revision
    ) {
      rejectStaleDraft();
      return;
    }
    const draft = state.stepDraft;
    void runMutation(
      () => api.updateStep(step.id, {
        author_type: "human",
        body_markdown: draft.body_markdown.trim(),
        concepts: parseTags(draft.concepts),
        expected_step_revision: editSession.revision,
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
  }, [api, pushToast, rejectStaleDraft, runMutation, state.editingStepId, state.stepDraft]);

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
    const editSession = revisionEditSessionRef.current;
    if (
      editSession?.kind !== "assumption"
      || editSession.entityId !== step.id
      || editSession.revision !== step.revision
    ) {
      rejectStaleDraft();
      return;
    }
    const draft = state.assumptionDraft;
    void runMutation(
      () => api.markAssumption(step.id, {
        assumption_status: draft.status,
        author_type: "human",
        expected_step_revision: editSession.revision,
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
  }, [api, rejectStaleDraft, runMutation, state.assumptionDraft, state.targetStepId]);

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
    const editSession = revisionEditSessionRef.current;
    if (
      editSession?.kind !== "result"
      || editSession.targetId !== target.id
      || editSession.targetType !== draft.target_type
      || editSession.targetRevision !== target.revision
      || editSession.resultRevision !== (existingResult?.revision ?? null)
    ) {
      rejectStaleDraft();
      return;
    }

    void runMutation(
      () => api.setReasoningResult(workspaceId, activeGraph.objective.id, {
        author_type: "human",
        expected_result_revision: editSession.resultRevision,
        expected_target_revision: editSession.targetRevision,
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
  }, [api, pushToast, rejectStaleDraft, runMutation, state.resultDraft, workspaceId]);

  const refreshFromAgent = useCallback(async (signal: AbortSignal) => {
    if (!workspaceId) return;
    const refreshOperation = beginRefreshing();
    try {
      const [refreshedOverview] = await Promise.all([
        fetchOverview(signal),
        fetchPendingDecisions(signal),
      ]);
      const nextObjective = refreshedOverview ? objectiveForRoute(refreshedOverview, objectiveId) : null;
      if (nextObjective && nextObjective.id === objectiveId) await fetchObjectiveGraph(nextObjective.id, signal);
    } finally {
      endRefreshing(refreshOperation);
    }
  }, [beginRefreshing, endRefreshing, fetchObjectiveGraph, fetchOverview, fetchPendingDecisions, objectiveId, workspaceId]);

  const refreshFromRealtime = useCallback(async ({
    activityEvents,
    reconcile,
    signal,
  }: WorkspaceRealtimeInvalidation) => {
    if (!workspaceId) return;

    const refreshOperation = beginRefreshing();
    try {
      const activeObjectiveId = graphRef.current?.objective.id ?? objectiveId;
      const activeGraphAffected = Boolean(
        activeObjectiveId
        && (
          reconcile
          || activityEvents.some((event) => (
            event.objective_id === null || event.objective_id === activeObjectiveId
          ))
        ),
      );
      const pendingDecisionsAffected = reconcile
        || activityEvents.some((event) => event.entity_type === "decisions");
      const inactiveSidebarObjectives = new Set<string>();

      if (reconcile) {
        for (const expandedObjectiveId of expandedObjectiveIds) {
          if (expandedObjectiveId !== activeObjectiveId) {
            inactiveSidebarObjectives.add(expandedObjectiveId);
          }
        }
      } else {
        for (const event of activityEvents) {
          if (
            event.objective_id
            && event.objective_id !== activeObjectiveId
            && expandedObjectiveIds.includes(event.objective_id)
            && (event.entity_type === "strategies" || event.entity_type === "branches")
          ) {
            inactiveSidebarObjectives.add(event.objective_id);
          }
        }
      }

      const refreshes: Promise<unknown>[] = [fetchOverview(signal)];
      if (pendingDecisionsAffected) refreshes.push(fetchPendingDecisions(signal));
      if (activeGraphAffected && activeObjectiveId) {
        refreshes.push(fetchObjectiveGraph(activeObjectiveId, signal));
      }
      for (const inactiveObjectiveId of inactiveSidebarObjectives) {
        refreshes.push(fetchObjectiveStrategies(inactiveObjectiveId, {
          force: true,
          signal,
          silent: true,
        }));
      }
      await Promise.all(refreshes);
    } finally {
      endRefreshing(refreshOperation);
    }
  }, [
    beginRefreshing,
    endRefreshing,
    expandedObjectiveIds,
    fetchObjectiveGraph,
    fetchObjectiveStrategies,
    fetchOverview,
    fetchPendingDecisions,
    objectiveId,
    workspaceId,
  ]);

  const { status: realtimeStatus } = useWorkspaceRealtime({
    onInvalidate: refreshFromRealtime,
    workspaceId,
  });

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

    if (
      notice.stepId
      && !activeGraph?.steps.some((step) => step.id === notice.stepId)
    ) {
      // The originating WebMCP refresh and the Realtime reconciliation can
      // overlap. Preserve the focus request until whichever canonical fetch
      // commits the new node, instead of losing the post-mutation highlight.
      pendingExternalMutationRef.current = notice;
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
    openAssumption: (stepId) => {
      const step = graphRef.current?.steps.find((candidate) => candidate.id === stepId);
      if (!step) return;
      revisionEditSessionRef.current = {
        entityId: step.id,
        kind: "assumption",
        revision: step.revision,
      };
      setDraftConflict(null);
      setState((current) => ({
        ...current,
        activeDialog: "assumption",
        assumptionDraft: EMPTY_ASSUMPTION,
        targetStepId: stepId,
      }));
    },
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
      revisionEditSessionRef.current = {
        entityId: objective.id,
        kind: "objective",
        revision: objective.revision,
      };
      setDraftConflict(null);
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
      revisionEditSessionRef.current = {
        entityId: step.id,
        kind: "step",
        revision: step.revision,
      };
      setDraftConflict(null);
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
    openNewObjective: () => {
      revisionEditSessionRef.current = null;
      setDraftConflict(null);
      setState((current) => ({
        ...current,
        activeDialog: "objective",
        editingObjectiveId: null,
        objectiveDraft: EMPTY_OBJECTIVE,
      }));
    },
    openNewStep: (branchId) => {
      const activeGraph = graphRef.current;
      const selection = resolveBranchSelection(activeGraph, branchId);
      const branch = activeGraph?.branches.find((candidate) => candidate.id === branchId);
      if (!selection || !branch) return;
      revisionEditSessionRef.current = {
        entityId: branch.id,
        kind: "new-step",
        revision: branch.revision,
      };
      setDraftConflict(null);
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
      revisionEditSessionRef.current = resultEditSession(activeGraph, targetType, targetId);
      setDraftConflict(null);
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
    setResultDraft: (field, value) => {
      if (field !== "target_type" && field !== "target_id") {
        setState((current) => ({
          ...current,
          resultDraft: { ...current.resultDraft, [field]: value },
        } as WorkspacePageState));
        return;
      }
      const activeGraph = graphRef.current;
      const targetType = field === "target_type"
        ? (value === "strategy" ? "strategy" : "branch")
        : state.resultDraft.target_type;
      const targetId = field === "target_id"
        ? value
        : targetType === "branch"
          ? state.selectedBranchId ?? activeGraph?.branches[0]?.id ?? ""
          : state.selectedStrategyId ?? activeGraph?.strategies[0]?.id ?? "";
      const existingResult = activeGraph?.reasoning_results.find(
        (result) => result.target_type === targetType && result.target_id === targetId,
      );
      revisionEditSessionRef.current = activeGraph
        ? resultEditSession(activeGraph, targetType, targetId)
        : null;
      setDraftConflict(null);
      setState((current) => ({
        ...current,
        resultDraft: {
          outcome_status: existingResult?.outcome_status ?? "inconclusive",
          result_markdown: existingResult?.result_markdown ?? "",
          target_id: targetId,
          target_type: targetType,
        },
      }));
    },
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
    state.resultDraft.target_type,
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
      draftConflict,
      error,
      expandedObjectiveIds,
      graph,
      highlightExternalMutation,
      loading: loadingOverview || loadingObjectiveIds.length > 0,
      loadingObjectiveIds,
      objectiveStrategies,
      overview,
      pendingDecisions,
      realtimeStatus,
      refreshFromAgent,
      state,
    }),
    [
      actions,
      draftConflict,
      error,
      expandedObjectiveIds,
      graph,
      highlightExternalMutation,
      loadingObjectiveIds,
      loadingOverview,
      objectiveStrategies,
      overview,
      pendingDecisions,
      realtimeStatus,
      refreshFromAgent,
      state,
    ],
  );
}
