import { webMcpToolRegistry } from "@lemma/contracts";
import type {
  BranchComparison,
  CleanSolution,
  DecisionInboxItem,
  ObjectiveGraph,
  Step,
  StepDependency,
  WorkspaceOverview,
} from "@lemma/contracts";
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  Flag,
  LoaderCircle,
  Maximize2,
  Plus,
  RefreshCw,
  ScrollText,
  Target,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useWorkspaceViewState } from "./hooks/useWorkspaceViewState";
import { cx } from "../../lib/ui";
import { BoardFocusControls } from "./components/BoardFocusControls";
import { Brand } from "../../components/Brand";
import { Button, IconButton } from "../../components/Primitives";
import { MathText } from "../../components/MarkdownMath";
import { ReasoningCanvas } from "./components/ReasoningCanvas";
import { StepInspector } from "./components/StepInspector";
import { StrategyInspector } from "./components/StrategyInspector";
import {
  DecisionCheckpointDialog,
  type DecisionTargetBreadcrumb,
} from "./components/DecisionCheckpointDialog";
import {
  type ObjectiveStrategyGroup,
  WorkspaceSidebar,
} from "./components/WorkspaceSidebar";
import {
  AssumptionDialog,
  BranchDialog,
  CleanSolutionDialog,
  CompareDialog,
  ContextDialog,
  ContextItemDialog,
  ObjectiveDialog,
  ResultDialog,
  StepDialog,
  StrategyDialog,
  type AssumptionDraft,
  type BranchDraft,
  type ContextDraft,
  type ObjectiveDraft,
  type ResultDraft,
  type StepDraft,
  type StrategyDraft,
} from "./components/WorkspaceDialogs";

const ReasoningFlowCanvas = lazy(async () => {
  const module = await import("./components/ReasoningFlowCanvas");
  return { default: module.ReasoningFlowCanvas };
});

const WEB_MCP_TOOL_COUNT = Object.keys(webMcpToolRegistry).length;

export type WorkspaceDialogName =
  | "assumption"
  | "branch"
  | "clean"
  | "compare"
  | "context"
  | "contextItem"
  | "decision"
  | "objective"
  | "result"
  | "step"
  | "strategy"
  | null;

export interface WorkspacePageState {
  activeDialog: WorkspaceDialogName;
  assumptionDraft: AssumptionDraft;
  branchDraft: BranchDraft;
  busy: boolean;
  cleanSolution: CleanSolution | null;
  compareBranchA: string;
  compareBranchB: string;
  comparison: BranchComparison | null;
  contextDraft: ContextDraft;
  decisionResolutionMarkdown: string;
  decisionResolutionOutcome: "accepted" | "redirected";
  editingObjectiveId: string | null;
  editingStepId: string | null;
  objectiveDraft: ObjectiveDraft;
  refreshing: boolean;
  resultDraft: ResultDraft;
  selectedBranchId: string | null;
  selectedContextItemId: string | null;
  selectedDecisionId: string | null;
  selectedStepId: string | null;
  selectedStrategyId: string | null;
  stepDraft: StepDraft;
  strategyDraft: StrategyDraft;
  targetBranchId: string | null;
  targetStepId: string | null;
}

export interface WorkspacePageActions {
  closeDialog: () => void;
  connectSteps: (sourceStepId: string, targetStepId: string) => void;
  copyCleanSolution: () => void;
  createAssumption: () => void;
  createBranch: () => void;
  createContext: () => void;
  createObjective: () => void;
  createStep: () => void;
  createStrategy: () => void;
  downloadContext: (contextItemId: string) => void;
  generateCleanSolution: () => void;
  goBack: () => void;
  markDeadEnd: (stepId: string) => void;
  openOldestPendingDecisionForObjective: (objectiveId: string) => void;
  openOldestPendingDecisionForStrategy: (strategyId: string) => void;
  openPendingDecision: (stepId: string) => void;
  openAssumption: (stepId: string) => void;
  openBranch: (stepId: string) => void;
  openCleanSolution: () => void;
  openCompare: () => void;
  openContext: () => void;
  openContextItem: (contextItemId: string) => void;
  openContextLink: (contextItemId: string) => void;
  openEditObjective: (objectiveId: string) => void;
  openEditStep: (stepId: string) => void;
  openNewObjective: () => void;
  openNewStep: (branchId: string) => void;
  openResult: (branchId?: string) => void;
  openStrategy: (objectiveId: string) => void;
  refresh: () => void;
  resolveDecision: () => void;
  runComparison: () => void;
  saveCleanSolution: () => void;
  selectBranch: (branchId: string) => void;
  selectObjective: (objectiveId: string) => void;
  selectStep: (stepId: string | null) => void;
  selectStrategy: (strategyId: string) => void;
  setAssumptionDraft: (field: keyof AssumptionDraft, value: string) => void;
  setBranchDraft: (value: string) => void;
  setCompareBranchA: (branchId: string) => void;
  setCompareBranchB: (branchId: string) => void;
  setContextDraft: (field: keyof ContextDraft, value: File | null | string) => void;
  setDecisionResolutionMarkdown: (value: string) => void;
  setDecisionResolutionOutcome: (value: "accepted" | "redirected") => void;
  setObjectiveDraft: (field: keyof ObjectiveDraft, value: string) => void;
  setResultDraft: (field: keyof ResultDraft, value: string) => void;
  setStepDraft: (field: keyof StepDraft, value: string) => void;
  setStrategyDraft: (field: keyof StrategyDraft, value: string) => void;
  submitResult: () => void;
  submitStep: () => void;
  toggleObjective: (objectiveId: string) => void;
  updateObjective: () => void;
}

interface WorkspacePageProps {
  actions: WorkspacePageActions;
  expandedObjectiveIds: string[];
  graph: ObjectiveGraph | null;
  loadingObjectiveIds: string[];
  objectiveStrategies: Record<string, ObjectiveStrategyGroup | undefined>;
  overview: WorkspaceOverview;
  pendingDecisions?: DecisionInboxItem[];
  state: WorkspacePageState;
  webMcpAvailable: boolean;
}

function ObjectiveBoardEmpty({
  loading,
  onCreateObjective,
}: {
  loading: boolean;
  onCreateObjective: () => void;
}) {
  return (
    <section aria-live="polite" className="objective-board-empty">
      <span>{loading ? <LoaderCircle className="spin" /> : <Target />}</span>
      <h2>{loading ? "Loading objective…" : "This workspace is ready for its first objective"}</h2>
      <p>{loading
        ? "The selected objective is being isolated from the rest of the workspace."
        : "Objectives keep their strategies, branches, outcomes, and specific context separate while sharing general workspace context."}</p>
      {!loading && <Button icon={<Plus />} onClick={onCreateObjective}>Create first objective</Button>}
    </section>
  );
}

export function WorkspacePage({
  actions,
  expandedObjectiveIds,
  graph,
  loadingObjectiveIds,
  objectiveStrategies,
  overview,
  pendingDecisions = [],
  state,
  webMcpAvailable,
}: WorkspacePageProps) {
  const [inspectedStrategyTarget, setInspectedStrategyTarget] = useState<{
    objectiveId: string;
    strategyId: string;
  } | null>(null);
  useEffect(() => {
    setInspectedStrategyTarget((current) => (
      current && current.objectiveId !== graph?.objective.id ? null : current
    ));
  }, [graph?.objective.id]);
  const closeInspector = () => {
    setInspectedStrategyTarget(null);
    actions.selectStep(null);
  };
  const viewState = useWorkspaceViewState({
    activeDialog: state.activeDialog,
    inspectorOpen: state.selectedStepId !== null
      || Boolean(
        inspectedStrategyTarget
        && graph
        && inspectedStrategyTarget.objectiveId === graph.objective.id,
      ),
    onCloseInspector: closeInspector,
    selectedStepId: state.selectedStepId,
  });
  const selectedStrategy = graph?.strategies.find((item) => item.id === state.selectedStrategyId) ?? graph?.strategies[0] ?? null;
  const strategyBranches = graph?.branches.filter((branch) => branch.strategy_id === selectedStrategy?.id) ?? [];
  const selectedBranch = graph?.branches.find((branch) => branch.id === state.selectedBranchId) ?? null;
  const selectedStep = graph?.steps.find((step) => step.id === state.selectedStepId) ?? null;
  const selectedDecision = pendingDecisions.find((item) => item.decision.id === state.selectedDecisionId) ?? null;
  const pendingCounts = useMemo(() => {
    const objectiveIds: Record<string, number> = {};
    const stepIds: Record<string, number> = {};
    const strategyIds: Record<string, number> = {};
    for (const item of pendingDecisions) {
      const { objective_id, step_id, strategy_id } = item.ancestry;
      if (objective_id) objectiveIds[objective_id] = (objectiveIds[objective_id] ?? 0) + 1;
      if (strategy_id) strategyIds[strategy_id] = (strategyIds[strategy_id] ?? 0) + 1;
      if (step_id) stepIds[step_id] = (stepIds[step_id] ?? 0) + 1;
    }
    return { objectiveIds, stepIds, strategyIds };
  }, [pendingDecisions]);
  const selectedDecisionTarget: DecisionTargetBreadcrumb | null = selectedDecision
    ? {
        branchName: graph?.branches.find((branch) => branch.id === selectedDecision.ancestry.branch_id)?.name ?? null,
        objectiveTitle: graph?.objective.id === selectedDecision.ancestry.objective_id
          ? graph.objective.title
          : null,
        stepTitle: graph?.steps.find((step) => step.id === selectedDecision.ancestry.step_id)?.title ?? null,
        strategyTitle: graph?.strategies.find((strategy) => strategy.id === selectedDecision.ancestry.strategy_id)?.title ?? null,
      }
    : null;
  const inspectedStrategyId = inspectedStrategyTarget && graph
    && inspectedStrategyTarget.objectiveId === graph.objective.id
    ? inspectedStrategyTarget.strategyId
    : null;
  const inspectedStrategy = graph?.strategies.find((strategy) => strategy.id === inspectedStrategyId) ?? null;
  const dismissInspectorFromOutside = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (state.activeDialog !== null || (!selectedStep && !inspectedStrategy)) return;
    if (
      event.target instanceof Element
      && event.target.closest("[data-workspace-inspector='true']")
    ) return;

    closeInspector();
  };
  const allContextItems = graph?.effective_context_items ?? overview.general_context_items;
  const selectedContextItem = allContextItems.find((item) => item.id === state.selectedContextItemId) ?? null;
  const targetStep = graph?.steps.find((item) => item.id === state.targetStepId) ?? null;
  const targetBranch = graph?.branches.find((item) => item.id === state.targetBranchId) ?? null;
  const selectedResultTarget = selectedBranch
    ? { id: selectedBranch.id, type: "branch" as const }
    : selectedStrategy
      ? { id: selectedStrategy.id, type: "strategy" as const }
      : null;
  const selectedResult = selectedResultTarget
    ? (graph?.reasoning_results.find(
      (result) => result.target_type === selectedResultTarget.type && result.target_id === selectedResultTarget.id,
    ) ?? null)
    : null;
  const draftResult = graph?.reasoning_results.find(
    (result) => result.target_type === state.resultDraft.target_type && result.target_id === state.resultDraft.target_id,
  ) ?? null;
  const selectedAssumptionIds = new Set(
    graph?.step_assumptions
      .filter((relation) => relation.step_id === selectedStep?.id && relation.status === "active")
      .map((relation) => relation.assumption_id) ?? [],
  );
  const selectedAssumptions = graph?.assumptions.filter((item) => selectedAssumptionIds.has(item.id)) ?? [];
  const selectedDependencies = selectedStep && graph
    ? graph.step_dependencies.flatMap<{
        dependency: StepDependency;
        direction: "depends_on" | "used_by";
        relatedStep: Step;
      }>((dependency) => {
        if (dependency.status !== "active") return [];
        if (dependency.step_id === selectedStep.id) {
          const relatedStep = graph.steps.find((step) => step.id === dependency.depends_on_step_id);
          return relatedStep ? [{ dependency, direction: "depends_on" as const, relatedStep }] : [];
        }
        if (dependency.depends_on_step_id === selectedStep.id) {
          const relatedStep = graph.steps.find((step) => step.id === dependency.step_id);
          return relatedStep ? [{ dependency, direction: "used_by" as const, relatedStep }] : [];
        }
        return [];
      })
    : [];
  const selectedSources = selectedStep && graph
    ? graph.step_sources
      .filter((relation) => relation.step_id === selectedStep.id && relation.status === "active")
      .flatMap((relation) => {
        const source = graph.sources.find((item) => item.id === relation.source_id);
        return source ? [{ relation, source }] : [];
      })
    : [];
  const selectedActivityEvents = selectedStep && graph
    ? graph.activity_events
      .filter((event) => event.entity_id === selectedStep.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 8)
    : [];
  const renderStepInspector = (presentation: "column" | "focus") => (
    <StepInspector
      activityEvents={selectedActivityEvents}
      assumptions={selectedAssumptions}
      dependencies={selectedDependencies}
      onClose={closeInspector}
      onMarkAssumption={actions.openAssumption}
      onMarkDeadEnd={actions.markDeadEnd}
      presentation={presentation}
      sources={selectedSources}
      step={selectedStep}
    />
  );
  const renderStrategyInspector = (presentation: "column" | "focus") => (
    <StrategyInspector
      onClose={closeInspector}
      presentation={presentation}
      strategy={inspectedStrategy}
    />
  );
  const selectBranch = (branchId: string) => {
    setInspectedStrategyTarget(null);
    actions.selectBranch(branchId);
  };
  const selectStep = (stepId: string | null) => {
    setInspectedStrategyTarget(null);
    actions.selectStep(stepId);
  };
  const selectObjective = (objectiveId: string) => {
    setInspectedStrategyTarget(null);
    actions.selectObjective(objectiveId);
  };
  const selectSidebarStrategy = (strategyId: string) => {
    setInspectedStrategyTarget(null);
    actions.selectStrategy(strategyId);
  };
  const inspectStrategy = (strategyId: string) => {
    if (graph?.strategies.some((strategy) => strategy.id === strategyId)) {
      setInspectedStrategyTarget({ objectiveId: graph.objective.id, strategyId });
    } else {
      setInspectedStrategyTarget(null);
    }
    actions.selectStrategy(strategyId);
  };

  const hasObjectives = overview.objectives.length > 0;
  const isLoadingObjective = hasObjectives && graph === null;
  const generalContextItems = graph?.general_context_items ?? overview.general_context_items;
  const objectiveContextItems = graph?.objective_context_items ?? [];

  return (
    <div
      className={cx("workspace-page", viewState.isBoardFocused && "is-board-focused")}
      data-workspace-mode={viewState.isBoardFocused ? "selection" : "default"}
      onClickCapture={dismissInspectorFromOutside}
    >
      {!viewState.isBoardFocused && (
        <header className="workspace-topbar">
          <div className="workspace-topbar__left">
            <IconButton label="Back to workspaces" onClick={actions.goBack}><ArrowLeft /></IconButton>
            <Brand compact />
            <span className="topbar-divider" />
            <div className="workspace-breadcrumb">
              <span>Workspaces</span><ChevronRight />
              <b><MathText markdown={overview.workspace.title} /></b>
              {graph && <><ChevronRight /><b><MathText markdown={graph.objective.title} /></b></>}
            </div>
          </div>
          <div className="workspace-topbar__center">
            <span className={`agent-chip ${webMcpAvailable ? "is-live" : ""}`}>
              <span /><Bot />{webMcpAvailable ? `${WEB_MCP_TOOL_COUNT} agent tools live` : "WebMCP unavailable"}
            </span>
          </div>
          <div className="workspace-topbar__actions">
            {state.refreshing && <span className="saving-indicator"><LoaderCircle className="spin" /> Syncing</span>}
            <IconButton label="Refresh workspace" onClick={actions.refresh}><RefreshCw /></IconButton>
            {graph && <>
              <Button aria-label="Clean solution" icon={<ScrollText />} onClick={actions.openCleanSolution} tone="secondary">Clean solution</Button>
              <Button
                aria-label={selectedResult ? "Edit outcome" : "Record outcome"}
                icon={<Flag />}
                onClick={() => actions.openResult(selectedBranch?.id)}
                tone="secondary"
              >
                {selectedResult ? "Edit outcome" : "Record outcome"}
              </Button>
            </>}
          </div>
        </header>
      )}

      <div className={cx(
        "workspace-layout",
        viewState.isBoardFocused && "is-board-focused",
        viewState.isSidebarCollapsed && "is-sidebar-collapsed",
      )}>
        <WorkspaceSidebar
          activeObjectiveId={graph?.objective.id ?? null}
          collapsed={viewState.isSidebarCollapsed}
          expandedObjectiveIds={expandedObjectiveIds}
          generalContextItems={generalContextItems}
          loadingObjectiveIds={loadingObjectiveIds}
          objectiveContextItems={objectiveContextItems}
          objectivePendingDecisionCounts={pendingCounts.objectiveIds}
          objectiveStrategies={objectiveStrategies}
          objectives={overview.objectives}
          onAddContext={actions.openContext}
          onAddObjective={actions.openNewObjective}
          onAddStrategy={actions.openStrategy}
          onEditObjective={actions.openEditObjective}
          onOpenContextItem={actions.openContextItem}
          onOpenPendingDecisionForObjective={actions.openOldestPendingDecisionForObjective}
          onOpenPendingDecisionForStrategy={actions.openOldestPendingDecisionForStrategy}
          onSelectObjective={selectObjective}
          onSelectStrategy={selectSidebarStrategy}
          onToggleCollapsed={viewState.toggleSidebarCollapsed}
          onToggleObjective={actions.toggleObjective}
          selectedStrategyId={selectedStrategy?.id ?? null}
          strategyPendingDecisionCounts={pendingCounts.strategyIds}
          workspace={overview.workspace}
        />

        <main className="workspace-stage">
          {!graph ? (
            <ObjectiveBoardEmpty loading={isLoadingObjective} onCreateObjective={actions.openNewObjective} />
          ) : viewState.isBoardFocused ? (
            <Suspense fallback={(
              <section aria-label="Loading interactive reasoning board" className="reasoning-flow-loading">
                <LoaderCircle className="spin" /> Preparing the board
              </section>
            )}>
              <ReasoningFlowCanvas
                branches={graph.branches}
                key={graph.objective.id}
                onAddStep={actions.openNewStep}
                onBranchFromStep={actions.openBranch}
                onConnectSteps={actions.connectSteps}
                onEditStep={actions.openEditStep}
                onMarkDeadEnd={actions.markDeadEnd}
                onOpenPendingDecision={actions.openPendingDecision}
                onSelectBranch={selectBranch}
                onSelectStep={selectStep}
                onSelectStrategy={inspectStrategy}
                selectedBranchId={state.selectedBranchId}
                selectedStepId={state.selectedStepId}
                selectedStrategyId={selectedStrategy?.id ?? null}
                pendingDecisionCountsByStepId={pendingCounts.stepIds}
                stepDependencies={graph.step_dependencies}
                steps={graph.steps}
                strategies={graph.strategies}
              />
            </Suspense>
          ) : (
            <ReasoningCanvas
              branches={graph.branches}
              focusMode={false}
              key={graph.objective.id}
              onAddStep={actions.openNewStep}
              onBranchFromStep={actions.openBranch}
              onEditStep={actions.openEditStep}
              onMarkDeadEnd={actions.markDeadEnd}
              onOpenPendingDecision={actions.openPendingDecision}
              onSelectBranch={selectBranch}
              onSelectStep={selectStep}
              onSelectStrategy={inspectStrategy}
              selectedBranchId={state.selectedBranchId}
              selectedStepId={state.selectedStepId}
              selectedStrategyId={selectedStrategy?.id ?? null}
              pendingDecisionCountsByStepId={pendingCounts.stepIds}
              steps={graph.steps}
              strategies={graph.strategies}
            />
          )}
          {graph && !viewState.isBoardFocused && (
            <Button
              aria-label="Enter fullscreen board"
              className="board-fullscreen-trigger"
              icon={<Maximize2 />}
              onClick={viewState.enterBoardFocus}
              tone="secondary"
            >
              Full screen
            </Button>
          )}
          {graph && viewState.isBoardFocused && (
            <BoardFocusControls
              onExit={viewState.exitBoardFocus}
              onOpenCleanSolution={actions.openCleanSolution}
              onOpenResult={() => actions.openResult(selectedBranch?.id)}
              onRefresh={actions.refresh}
              refreshing={state.refreshing}
              selectedBranch={selectedBranch}
              selectedResult={selectedResult}
              webMcpAvailable={webMcpAvailable}
            />
          )}
          {graph && viewState.isBoardFocused && selectedStep && renderStepInspector("focus")}
          {graph && viewState.isBoardFocused && !selectedStep && inspectedStrategy && renderStrategyInspector("focus")}
        </main>

        {graph && !viewState.isBoardFocused && selectedStep && renderStepInspector("column")}
        {graph && !viewState.isBoardFocused && !selectedStep && inspectedStrategy && renderStrategyInspector("column")}
      </div>

      <ObjectiveDialog busy={state.busy} draft={state.objectiveDraft} editing={state.editingObjectiveId !== null} onChange={actions.setObjectiveDraft} onClose={actions.closeDialog} onSubmit={state.editingObjectiveId ? actions.updateObjective : actions.createObjective} open={state.activeDialog === "objective"} />
      <StrategyDialog busy={state.busy} draft={state.strategyDraft} onChange={actions.setStrategyDraft} onClose={actions.closeDialog} onSubmit={actions.createStrategy} open={state.activeDialog === "strategy"} />
      <StepDialog branchName={targetBranch?.name ?? "Selected branch"} busy={state.busy} draft={state.stepDraft} editing={state.editingStepId !== null} onChange={actions.setStepDraft} onClose={actions.closeDialog} onSubmit={actions.submitStep} open={state.activeDialog === "step"} />
      <BranchDialog busy={state.busy} draft={state.branchDraft} forkStep={targetStep} onChange={actions.setBranchDraft} onClose={actions.closeDialog} onSubmit={actions.createBranch} open={state.activeDialog === "branch"} />
      <AssumptionDialog busy={state.busy} draft={state.assumptionDraft} onChange={actions.setAssumptionDraft} onClose={actions.closeDialog} onSubmit={actions.createAssumption} open={state.activeDialog === "assumption"} />
      <ContextDialog busy={state.busy} draft={state.contextDraft} onChange={actions.setContextDraft} onClose={actions.closeDialog} onSubmit={actions.createContext} open={state.activeDialog === "context"} />
      <ContextItemDialog item={selectedContextItem} onClose={actions.closeDialog} onDownload={actions.downloadContext} onOpenLink={actions.openContextLink} open={state.activeDialog === "contextItem"} />
      <CompareDialog branches={strategyBranches} busy={state.busy} comparison={state.comparison} onBranchAChange={actions.setCompareBranchA} onBranchBChange={actions.setCompareBranchB} onClose={actions.closeDialog} onCompare={actions.runComparison} open={state.activeDialog === "compare"} selectedA={state.compareBranchA} selectedB={state.compareBranchB} />
      <CleanSolutionDialog busy={state.busy} onClose={actions.closeDialog} onCopy={actions.copyCleanSolution} onGenerate={actions.generateCleanSolution} onSave={actions.saveCleanSolution} open={state.activeDialog === "clean"} solution={state.cleanSolution} />
      <ResultDialog branches={graph?.branches ?? []} busy={state.busy} draft={state.resultDraft} existingResult={draftResult} onChange={actions.setResultDraft} onClose={actions.closeDialog} onSubmit={actions.submitResult} open={state.activeDialog === "result"} strategies={graph?.strategies ?? []} />
      <DecisionCheckpointDialog
        busy={state.busy}
        decision={selectedDecision}
        onClose={actions.closeDialog}
        onOutcomeChange={actions.setDecisionResolutionOutcome}
        onResolutionMarkdownChange={actions.setDecisionResolutionMarkdown}
        onResolve={actions.resolveDecision}
        open={state.activeDialog === "decision"}
        outcome={state.decisionResolutionOutcome}
        resolutionMarkdown={state.decisionResolutionMarkdown}
        target={selectedDecisionTarget}
      />
    </div>
  );
}
