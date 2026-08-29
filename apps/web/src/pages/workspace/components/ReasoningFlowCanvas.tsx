import type { Branch, Step, StepDependency, Strategy } from "@lemma/contracts";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import {
  Bot,
  Compass,
  Edit3,
  Flag,
  GitBranch,
  GripHorizontal,
  Plus,
  Split,
  UserRound,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useReasoningFlow } from "../hooks/useReasoningFlow";
import {
  type ReasoningFlowEdge,
  type ReasoningFlowNode,
} from "../lib/reasoningFlowGraph";
import { markdownToPlainText } from "../../../lib/markdownToPlainText";
import { cx, formatRelativeTime } from "../../../lib/ui";
import { MarkdownMath, MathText } from "../../../components/MarkdownMath";
import { IconButton, StatusBadge } from "../../../components/Primitives";

interface ReasoningFlowCanvasProps {
  branches: Branch[];
  onAddStep: (branchId: string) => void;
  onBranchFromStep: (stepId: string) => void;
  onConnectSteps: (sourceStepId: string, targetStepId: string) => void;
  onEditStep: (stepId: string) => void;
  onMarkDeadEnd: (stepId: string) => void;
  onOpenPendingDecision: (stepId: string) => void;
  onSelectBranch: (branchId: string) => void;
  onSelectStep: (stepId: string | null) => void;
  onSelectStrategy: (strategyId: string) => void;
  selectedBranchId: string | null;
  selectedStepId: string | null;
  selectedStrategyId: string | null;
  pendingDecisionCountsByStepId: Readonly<Record<string, number>>;
  stepDependencies: StepDependency[];
  steps: Step[];
  strategies: Strategy[];
}

interface FlowNodeActions {
  activeCreationBranchId: string | null;
  onAddStep: (branchId: string) => void;
  onBranchFromStep: (stepId: string) => void;
  onEditStep: (stepId: string) => void;
  onMarkDeadEnd: (stepId: string) => void;
  onOpenPendingDecision: (stepId: string) => void;
  pendingDecisionCountsByStepId: Readonly<Record<string, number>>;
  onToggleCreation: (branchId: string) => void;
}

const FlowNodeActionsContext = createContext<FlowNodeActions | null>(null);

function useFlowNodeActions(): FlowNodeActions {
  const actions = useContext(FlowNodeActionsContext);
  if (!actions) throw new Error("Reasoning Flow nodes must be rendered inside their action provider.");
  return actions;
}

function StructuralHandle({
  id,
  position,
  style,
  type,
}: {
  id: string;
  position: Position;
  style?: CSSProperties;
  type: "source" | "target";
}) {
  return (
    <Handle
      aria-hidden="true"
      className="lemma-structural-handle nodrag nopan"
      id={id}
      isConnectable={false}
      position={position}
      style={style}
      tabIndex={-1}
      type={type}
    />
  );
}

function StrategyFlowNode({ data, selected }: NodeProps<ReasoningFlowNode>) {
  if (data.kind !== "strategy") return null;
  const { strategy } = data;
  const isAgent = strategy.author_type === "agent";

  return (
    <article
      className={cx(
        "strategy-origin step-card flow-step-card flow-strategy-origin flow-node__drag-handle",
        selected && "is-selected",
      )}
      data-flow-node-kind="strategy"
      data-strategy-id={strategy.id}
      data-strategy-origin="true"
    >
      <StructuralHandle id="lineage-source" position={Position.Bottom} type="source" />
      <header className="step-card__header">
        <div className="strategy-origin__select step-card__select">
          <span className="step-card__topline">
            <span className="strategy-origin__marker step-number">
              <Compass aria-hidden="true" /> Strategy
            </span>
            <span aria-hidden="true" className="flow-node__grip"><GripHorizontal /></span>
            <StatusBadge status={strategy.status} />
          </span>
          <h4><MathText markdown={strategy.title} /></h4>
        </div>
      </header>
      {strategy.description_markdown && (
        <div
          aria-label="Full strategy description"
          className="strategy-origin__description step-card__body"
        >
          <MarkdownMath markdown={strategy.description_markdown} />
        </div>
      )}
      <footer className="step-card__footer">
        <span className={cx("author-chip", isAgent && "author-chip--agent")}>
          {isAgent ? <Bot /> : <UserRound />}
          {isAgent ? (strategy.author_agent_name ?? "Agent") : "You"}
        </span>
        <span>{formatRelativeTime(strategy.updated_at)}</span>
      </footer>
    </article>
  );
}

function BranchStartFlowNode({ data, selected }: NodeProps<ReasoningFlowNode>) {
  if (data.kind !== "branch-start") return null;
  const { branch, forkStep, origin } = data;
  const isFork = origin === "fork";

  return (
    <article
      className={cx(
        "flow-branch-start flow-node__drag-handle",
        isFork ? "is-fork" : "is-root",
        `is-${branch.status.replace("_", "-")}`,
        selected && "is-selected",
      )}
      data-flow-node-kind="branch-start"
      data-branch-id={branch.id}
      title={`${isFork ? "New branch" : "Branch start"}: ${markdownToPlainText(branch.name)}`}
    >
      <StructuralHandle id="lineage-target" position={Position.Top} type="target" />
      <StructuralHandle id="lineage-source" position={Position.Bottom} type="source" />
      <div className="flow-branch-start__orb">
        <span className="flow-branch-start__marker" aria-hidden="true">
          <Flag />
        </span>
        <span className="flow-branch-start__copy">
          <span className="flow-branch-start__eyebrow">
            {isFork ? "New branch" : "Branch start"}
          </span>
          <b><MathText markdown={branch.name} /></b>
          <small>
            {isFork && forkStep
              ? `After ${String(forkStep.ordinal).padStart(2, "0")}`
              : "From strategy"}
          </small>
        </span>
        <span aria-label={`Branch ${branch.status}`} className="flow-branch-start__status" />
      </div>
    </article>
  );
}

function ForkJunctionFlowNode({ data }: NodeProps<ReasoningFlowNode>) {
  if (data.kind !== "fork-junction") return null;
  const { forkStep, parentBranch, paths } = data;
  const alternativeCount = paths.filter((path) => path.kind === "alternative").length;

  return (
    <article
      className="flow-fork-junction flow-node__drag-handle"
      data-flow-node-kind="fork-junction"
      title={`Fork from ${markdownToPlainText(parentBranch.name)} after Step ${forkStep.ordinal}`}
    >
      <StructuralHandle id="lineage-target" position={Position.Top} type="target" />
      {paths.map((path, index) => (
        <StructuralHandle
          id={`path:${path.branch.id}`}
          key={path.branch.id}
          position={Position.Bottom}
          style={{ left: `${((index + 1) / (paths.length + 1)) * 100}%` }}
          type="source"
        />
      ))}
      <div className="flow-fork-junction__orb">
        <span className="flow-fork-junction__icon" aria-hidden="true"><Split /></span>
        <small>Fork</small>
        <b>After {String(forkStep.ordinal).padStart(2, "0")}</b>
        <em>{alternativeCount} {alternativeCount === 1 ? "alternative" : "alternatives"}</em>
      </div>
    </article>
  );
}

function CreationFlowNode({ data }: NodeProps<ReasoningFlowNode>) {
  const actions = useFlowNodeActions();
  if (data.kind !== "creation") return null;
  const { afterStep, branch, canBranch } = data;
  const open = actions.activeCreationBranchId === branch.id;
  const triggerLabel = afterStep
    ? `Create after ${markdownToPlainText(afterStep.title)}`
    : `Create the first step in ${markdownToPlainText(branch.name)}`;

  return (
    <article
      className={cx("flow-creation-node flow-node__drag-handle", open && "is-open")}
      data-flow-node-kind="creation"
    >
      <StructuralHandle id="lineage-target" position={Position.Top} type="target" />
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={triggerLabel}
        className="flow-creation-node__trigger"
        onClick={(event) => {
          event.stopPropagation();
          actions.onToggleCreation(branch.id);
        }}
        type="button"
      >
        <Plus aria-hidden="true" />
      </button>
      <span className="flow-creation-node__label">
        {afterStep ? "Next move" : "First step"}
      </span>
      {open && (
        <div aria-label={`Create in ${markdownToPlainText(branch.name)}`} className="flow-creation-menu nodrag nopan" role="menu">
          <button
            onClick={(event) => {
              event.stopPropagation();
              actions.onToggleCreation(branch.id);
              actions.onAddStep(branch.id);
            }}
            role="menuitem"
            type="button"
          >
            <span aria-hidden="true"><Plus /></span>
            <span><b>Add step</b><small>Continue <MathText markdown={branch.name} /></small></span>
          </button>
          {canBranch && afterStep && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                actions.onToggleCreation(branch.id);
                actions.onBranchFromStep(afterStep.id);
              }}
              role="menuitem"
              type="button"
            >
              <span aria-hidden="true"><GitBranch /></span>
              <span><b>Create branch</b><small>Split from Step {String(afterStep.ordinal).padStart(2, "0")}</small></span>
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function StepFlowNode({ data, selected }: NodeProps<ReasoningFlowNode>) {
  const actions = useFlowNodeActions();
  if (data.kind !== "step") return null;
  const { step } = data;
  const isAgent = step.author_type === "agent";

  return (
    <article
      className={cx(
        "step-card flow-step-card flow-node__drag-handle",
        selected && "is-selected",
        `step-card--${step.status}`,
      )}
      data-step-id={step.id}
    >
      <StructuralHandle id="lineage-target" position={Position.Top} type="target" />
      <StructuralHandle id="lineage-source" position={Position.Bottom} type="source" />
      <header className="step-card__header">
        <div className="step-card__select">
          <span className="step-card__topline">
            <span className="step-number">Step {String(step.ordinal).padStart(2, "0")}</span>
            <span className="flow-node__grip" aria-hidden="true"><GripHorizontal /></span>
            <StatusBadge status={step.status} />
          </span>
          <h4><MathText markdown={step.title} /></h4>
          {step.summary && <MathText className="step-card__summary" markdown={step.summary} />}
        </div>
        <IconButton
          className="step-card__edit nodrag nopan"
          label={`Edit ${markdownToPlainText(step.title)}`}
          onClick={() => actions.onEditStep(step.id)}
        >
          <Edit3 />
        </IconButton>
      </header>

      <div className="step-card__body">
        <MarkdownMath markdown={step.body_markdown} />
      </div>

      {(step.concepts.length > 0 || step.theorem_tags.length > 0) && (
        <div className="step-card__tags" aria-label="Mathematical tags">
          {step.concepts.slice(0, 3).map((concept) => <span key={concept}><MathText markdown={concept} /></span>)}
          {step.theorem_tags.slice(0, 2).map((theorem) => <span className="is-theorem" key={theorem}><MathText markdown={theorem} /></span>)}
        </div>
      )}

      <footer className="step-card__footer">
        <span className={cx("author-chip", isAgent && "author-chip--agent")}>
          {isAgent ? <Bot /> : <UserRound />}
          {isAgent ? (step.author_agent_name ?? "Agent") : "You"}
        </span>
        <span>{formatRelativeTime(step.updated_at)}</span>
        {(actions.pendingDecisionCountsByStepId[step.id] ?? 0) > 0 && (
          <button
            aria-label={`Review ${actions.pendingDecisionCountsByStepId[step.id]} pending human decision${actions.pendingDecisionCountsByStepId[step.id] === 1 ? "" : "s"} for ${markdownToPlainText(step.title)}`}
            className="human-checkpoint-chip nodrag nopan"
            onClick={(event) => {
              event.stopPropagation();
              actions.onOpenPendingDecision(step.id);
            }}
            type="button"
          >
            Your call · {actions.pendingDecisionCountsByStepId[step.id]}
          </button>
        )}
        {step.status !== "dead_end" && (
          <IconButton
            className="nodrag nopan"
            label="Mark step as dead end"
            onClick={(event) => {
              event.stopPropagation();
              actions.onMarkDeadEnd(step.id);
            }}
          >
            <Flag />
          </IconButton>
        )}
      </footer>
    </article>
  );
}

const nodeTypes: NodeTypes = {
  "branch-start": BranchStartFlowNode,
  creation: CreationFlowNode,
  "fork-junction": ForkJunctionFlowNode,
  step: StepFlowNode,
  strategy: StrategyFlowNode,
};

function ReasoningFlowSurface(props: ReasoningFlowCanvasProps) {
  const [activeCreationBranchId, setActiveCreationBranchId] = useState<string | null>(null);
  const flow = useReasoningFlow({
    branches: props.branches,
    onConnectSteps: props.onConnectSteps,
    onSelectBranch: props.onSelectBranch,
    onSelectStep: props.onSelectStep,
    onSelectStrategy: props.onSelectStrategy,
    selectedBranchId: props.selectedBranchId,
    selectedStepId: props.selectedStepId,
    selectedStrategyId: props.selectedStrategyId,
    stepDependencies: props.stepDependencies,
    steps: props.steps,
    strategies: props.strategies,
  });
  const onToggleCreation = useCallback((branchId: string) => {
    setActiveCreationBranchId((current) => current === branchId ? null : branchId);
  }, []);
  const nodeActions = useMemo<FlowNodeActions>(() => ({
    activeCreationBranchId,
    onAddStep: props.onAddStep,
    onBranchFromStep: props.onBranchFromStep,
    onEditStep: props.onEditStep,
    onMarkDeadEnd: props.onMarkDeadEnd,
    onOpenPendingDecision: props.onOpenPendingDecision,
    pendingDecisionCountsByStepId: props.pendingDecisionCountsByStepId,
    onToggleCreation,
  }), [
    activeCreationBranchId,
    onToggleCreation,
    props.onAddStep,
    props.onBranchFromStep,
    props.onEditStep,
    props.onMarkDeadEnd,
    props.onOpenPendingDecision,
    props.pendingDecisionCountsByStepId,
  ]);

  return (
    <FlowNodeActionsContext.Provider value={nodeActions}>
      <section aria-label="Interactive reasoning board" className="reasoning-flow-canvas">
        <ReactFlow<ReasoningFlowNode, ReasoningFlowEdge>
          deleteKeyCode={null}
          edges={flow.edges}
          elevateEdgesOnSelect
          maxZoom={1.8}
          minZoom={0.12}
          nodeClickDistance={4}
          nodeDragThreshold={4}
          nodeTypes={nodeTypes}
          nodes={flow.nodes}
          nodesConnectable={false}
          nodesDraggable
          onEdgesChange={flow.onEdgesChange}
          onNodeClick={flow.onNodeClick}
          onNodesChange={flow.onNodesChange}
          onPaneClick={() => {
            setActiveCreationBranchId(null);
            flow.onPaneClick();
          }}
          onSelectionChange={flow.onSelectionChange}
          onlyRenderVisibleElements
          panOnDrag
          proOptions={{ hideAttribution: true }}
          selectNodesOnDrag={false}
          selectionOnDrag={false}
          zoomOnDoubleClick={false}
          zoomOnPinch
          zoomOnScroll
        >
          <Background color="rgb(85 72 92 / 0.18)" gap={22} size={1} variant={BackgroundVariant.Dots} />
          <Controls className="lemma-flow-controls" position="bottom-left" showInteractive={false} />
          <MiniMap
            className="lemma-flow-minimap"
            maskColor="rgb(239 235 227 / 0.72)"
            nodeColor={(node) => {
              if (node.type === "strategy") return "#5f3fa3";
              if (node.type === "branch-start") return "#d9cef0";
              if (node.type === "creation") return "#dce7a7";
              if (node.type === "fork-junction") return "#b9a7c9";
              return "#fffdf8";
            }}
            pannable
            position="bottom-right"
            zoomable
          />
        </ReactFlow>
      </section>
    </FlowNodeActionsContext.Provider>
  );
}

export function ReasoningFlowCanvas(props: ReasoningFlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <ReasoningFlowSurface {...props} />
    </ReactFlowProvider>
  );
}
