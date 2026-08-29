import type { Branch, Step, StepDependency, Strategy } from "@lemma/contracts";
import {
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
  type NodeMouseHandler,
  type OnSelectionChangeFunc,
  type XYPosition,
} from "@xyflow/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  buildReasoningFlowGraph,
  branchNodeId,
  isValidStepDependencyConnection,
  layoutReasoningFlowGraph,
  stepNodeId,
  strategyNodeId,
  type ReasoningFlowEdge,
  type ReasoningFlowNode,
} from "../lib/reasoningFlowGraph";

interface UseReasoningFlowOptions {
  branches: Branch[];
  onConnectSteps: (sourceStepId: string, targetStepId: string) => void;
  onSelectBranch: (branchId: string) => void;
  onSelectStep: (stepId: string | null) => void;
  onSelectStrategy: (strategyId: string) => void;
  selectedBranchId: string | null;
  selectedStepId: string | null;
  selectedStrategyId: string | null;
  stepDependencies: StepDependency[];
  steps: Step[];
  strategies: Strategy[];
}

function domainId(nodeId: string, prefix: "branch" | "step" | "strategy"): string | null {
  const marker = `${prefix}:`;
  return nodeId.startsWith(marker) ? nodeId.slice(marker.length) : null;
}

function nodeMatchesSelection(
  node: ReasoningFlowNode,
  selectedStrategyId: string | null,
  selectedBranchId: string | null,
  selectedStepId: string | null,
): boolean {
  if (selectedStepId) return node.data.kind === "step" && node.data.step.id === selectedStepId;
  if (selectedBranchId) {
    return node.data.kind === "branch-start" && node.data.branch.id === selectedBranchId;
  }
  return node.data.kind === "strategy" && node.data.strategy.id === selectedStrategyId;
}

export function useReasoningFlow({
  branches,
  onConnectSteps,
  onSelectBranch,
  onSelectStep,
  onSelectStrategy,
  selectedBranchId,
  selectedStepId,
  selectedStrategyId,
  stepDependencies,
  steps,
  strategies,
}: UseReasoningFlowOptions) {
  const model = useMemo(
    () => buildReasoningFlowGraph({ branches, stepDependencies, steps, strategies }),
    [branches, stepDependencies, steps, strategies],
  );
  const [nodes, setNodes, applyNodeChanges] = useNodesState<ReasoningFlowNode>(model.nodes);
  const [edges, setEdges, applyEdgeChanges] = useEdgesState<ReasoningFlowEdge>(model.edges);
  const [layoutGeneration, setLayoutGeneration] = useState(0);
  const manuallyPositionedNodes = useRef(new Map<string, XYPosition>());
  const measuredLayoutGeneration = useRef(-1);
  const initialFitComplete = useRef(false);
  const suppressSelectionEcho = useRef(false);
  const focusedStrategyId = useRef(selectedStrategyId);
  const focusedStepRevision = useRef(
    selectedStepId
      ? `${selectedStepId}:${steps.find((step) => step.id === selectedStepId)?.revision ?? "unknown"}`
      : null,
  );
  const nodesInitialized = useNodesInitialized();
  const { fitView } = useReactFlow<ReasoningFlowNode, ReasoningFlowEdge>();
  const initialFocusNodeId = selectedStepId
    ? stepNodeId(selectedStepId)
    : selectedStrategyId
      ? strategyNodeId(selectedStrategyId)
      : selectedBranchId
        ? branchNodeId(selectedBranchId)
        : model.nodes[0]?.id;

  useEffect(() => {
    const validNodeIds = new Set(model.nodes.map((node) => node.id));
    for (const nodeId of manuallyPositionedNodes.current.keys()) {
      if (!validNodeIds.has(nodeId)) manuallyPositionedNodes.current.delete(nodeId);
    }

    setNodes((currentNodes) => {
      const selectedNodeIds = new Set(
        currentNodes.filter((node) => node.selected).map((node) => node.id),
      );
      return model.nodes.map((node) => ({
        ...node,
        position: manuallyPositionedNodes.current.get(node.id) ?? node.position,
        selected: selectedNodeIds.has(node.id),
      }));
    });
    setEdges(model.edges);
    measuredLayoutGeneration.current = -1;
    setLayoutGeneration((generation) => generation + 1);
  }, [model, setEdges, setNodes]);

  useLayoutEffect(() => {
    suppressSelectionEcho.current = true;
    setNodes((currentNodes) => currentNodes.map((node) => {
      const selected = nodeMatchesSelection(node, selectedStrategyId, selectedBranchId, selectedStepId);
      return node.selected === selected ? node : { ...node, selected };
    }));

    const frame = requestAnimationFrame(() => {
      suppressSelectionEcho.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedBranchId, selectedStepId, selectedStrategyId, setNodes]);

  useEffect(() => {
    if (!nodesInitialized || measuredLayoutGeneration.current === layoutGeneration) return;
    measuredLayoutGeneration.current = layoutGeneration;

    setNodes((currentNodes) => layoutReasoningFlowGraph(currentNodes, model.edges).map((node) => ({
      ...node,
      position: manuallyPositionedNodes.current.get(node.id) ?? node.position,
    })));

    if (initialFitComplete.current) return;
    initialFitComplete.current = true;
    const frame = requestAnimationFrame(() => {
      void fitView({
        duration: 420,
        maxZoom: 0.92,
        minZoom: 0.78,
        padding: 0.28,
        ...(initialFocusNodeId ? { nodes: [{ id: initialFocusNodeId }] } : {}),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitView, initialFocusNodeId, layoutGeneration, model.edges, nodesInitialized, setNodes]);

  const selectedStepRevision = selectedStepId
    ? `${selectedStepId}:${steps.find((step) => step.id === selectedStepId)?.revision ?? "unknown"}`
    : null;

  useEffect(() => {
    if (!selectedStepId || !selectedStepRevision) {
      focusedStepRevision.current = null;
      return;
    }
    if (
      !nodesInitialized
      || !initialFitComplete.current
      || focusedStepRevision.current === selectedStepRevision
    ) {
      return;
    }

    focusedStepRevision.current = selectedStepRevision;
    const stepId = selectedStepId;
    const frame = requestAnimationFrame(() => {
      void fitView({
        duration: 320,
        maxZoom: 1,
        minZoom: 0.78,
        nodes: [{ id: stepNodeId(stepId) }],
        padding: 0.3,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitView, nodesInitialized, selectedStepId, selectedStepRevision]);

  useEffect(() => {
    if (!selectedStrategyId) {
      focusedStrategyId.current = null;
      return;
    }
    if (
      selectedStepId
      || !nodesInitialized
      || !initialFitComplete.current
      || focusedStrategyId.current === selectedStrategyId
    ) {
      return;
    }

    focusedStrategyId.current = selectedStrategyId;
    const frame = requestAnimationFrame(() => {
      void fitView({
        duration: 360,
        maxZoom: 0.92,
        minZoom: 0.78,
        nodes: [{ id: strategyNodeId(selectedStrategyId) }],
        padding: 0.28,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitView, nodesInitialized, selectedStepId, selectedStrategyId]);

  const onNodesChange = useCallback((changes: NodeChange<ReasoningFlowNode>[]) => {
    for (const change of changes) {
      if (change.type === "position" && change.position && change.dragging !== undefined) {
        manuallyPositionedNodes.current.set(change.id, change.position);
      }
    }
    applyNodeChanges(changes);
  }, [applyNodeChanges]);

  const onEdgesChange = useCallback((changes: EdgeChange<ReasoningFlowEdge>[]) => {
    applyEdgeChanges(changes);
  }, [applyEdgeChanges]);

  const stepIds = useMemo(() => new Set(steps.map((step) => step.id)), [steps]);

  const isValidConnection = useCallback<IsValidConnection<ReasoningFlowEdge>>((connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return false;
    const sourceStepId = domainId(connection.source, "step");
    const targetStepId = domainId(connection.target, "step");
    if (!sourceStepId || !targetStepId || !stepIds.has(sourceStepId) || !stepIds.has(targetStepId)) {
      return false;
    }
    return isValidStepDependencyConnection(stepDependencies, sourceStepId, targetStepId);
  }, [stepDependencies, stepIds]);

  const onConnect = useCallback((connection: Connection) => {
    if (!isValidConnection(connection)) return;
    const sourceStepId = connection.source ? domainId(connection.source, "step") : null;
    const targetStepId = connection.target ? domainId(connection.target, "step") : null;
    if (sourceStepId && targetStepId) onConnectSteps(sourceStepId, targetStepId);
  }, [isValidConnection, onConnectSteps]);

  const selectNode = useCallback((node: ReasoningFlowNode) => {
    if (node.data.kind === "step" && node.data.step.id !== selectedStepId) {
      onSelectStep(node.data.step.id);
    }
    if (node.data.kind === "branch-start" && node.data.branch.id !== selectedBranchId) {
      onSelectBranch(node.data.branch.id);
    }
    if (
      node.data.kind === "strategy"
      && node.data.strategy.id !== selectedStrategyId
    ) {
      onSelectStrategy(node.data.strategy.id);
    }
  }, [onSelectBranch, onSelectStep, onSelectStrategy, selectedBranchId, selectedStepId, selectedStrategyId]);

  const onNodeClick = useCallback<NodeMouseHandler<ReasoningFlowNode>>((event, node) => {
    const target = event.target;
    if (target instanceof Element && target.closest("a, button, input, select, textarea, .react-flow__handle")) return;
    // A direct click opens the inspector even when React Flow already marks
    // this strategy as selected. Selection-change echoes must not reopen it.
    if (node.data.kind === "strategy") {
      onSelectStrategy(node.data.strategy.id);
      return;
    }
    selectNode(node);
  }, [onSelectStrategy, selectNode]);

  const onSelectionChange = useCallback<OnSelectionChangeFunc<ReasoningFlowNode, ReasoningFlowEdge>>(
    ({ nodes: selectedNodes }) => {
      if (suppressSelectionEcho.current) return;
      const selectedNode = selectedNodes.at(-1);
      if (selectedNode) selectNode(selectedNode);
    },
    [selectNode],
  );

  const onPaneClick = useCallback(() => onSelectStep(null), [onSelectStep]);

  return {
    edges,
    isValidConnection,
    nodes,
    onConnect,
    onEdgesChange,
    onNodeClick,
    onNodesChange,
    onPaneClick,
    onSelectionChange,
  };
}
