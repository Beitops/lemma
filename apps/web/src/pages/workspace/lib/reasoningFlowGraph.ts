import type { Branch, Step, StepDependency, Strategy } from "@lemma/contracts";
import { graphlib, layout as dagreLayout } from "@dagrejs/dagre";
import { Position, type Edge, type Node } from "@xyflow/react";
import { markdownToPlainText } from "../../../lib/markdownToPlainText";

const LINEAGE_SOURCE_HANDLE = "lineage-source";
const LINEAGE_TARGET_HANDLE = "lineage-target";
const DEPENDENCY_SOURCE_HANDLE = "dependency-source";
const DEPENDENCY_TARGET_HANDLE = "dependency-target";

const ESTIMATED_DIMENSIONS = {
  "branch-start": { height: 124, width: 124 },
  creation: { height: 92, width: 92 },
  "fork-junction": { height: 132, width: 132 },
  step: { height: 360, width: 420 },
  // Strategy nodes intentionally reserve room for a multi-line title and a
  // step-sized, downward-growing description. Measured React Flow dimensions
  // replace this initial estimate after paint, but this keeps the first Dagre
  // layout clear before a long description is measured.
  strategy: { height: 360, width: 420 },
} as const;

type LineageEdgeKind =
  | "branch-creation"
  | "branch-step"
  | "creation"
  | "fork"
  | "fork-continuation"
  | "fork-junction"
  | "sequence"
  | "strategy-root";

export interface StrategyFlowNodeData extends Record<string, unknown> {
  kind: "strategy";
  strategy: Strategy;
}

export interface BranchStartFlowNodeData extends Record<string, unknown> {
  branch: Branch;
  empty: boolean;
  forkStep: Step | null;
  kind: "branch-start";
  origin: "strategy" | "fork";
}

export interface ForkJunctionPath {
  branch: Branch;
  kind: "continuation" | "alternative";
}

export interface ForkJunctionFlowNodeData extends Record<string, unknown> {
  forkStep: Step;
  kind: "fork-junction";
  parentBranch: Branch;
  paths: ForkJunctionPath[];
}

export interface StepFlowNodeData extends Record<string, unknown> {
  kind: "step";
  step: Step;
}

/** A derived action point at the open end of an active branch. */
export interface CreationFlowNodeData extends Record<string, unknown> {
  afterStep: Step | null;
  branch: Branch;
  canBranch: boolean;
  kind: "creation";
}

/** Data consumed by the presentation-only React Flow node components. */
export type ReasoningFlowNodeData =
  | BranchStartFlowNodeData
  | CreationFlowNodeData
  | ForkJunctionFlowNodeData
  | StepFlowNodeData
  | StrategyFlowNodeData;

export type StrategyFlowNode = Node<StrategyFlowNodeData, "strategy">;
export type BranchStartFlowNode = Node<BranchStartFlowNodeData, "branch-start">;
/** @deprecated Use BranchStartFlowNode. */
export type BranchFlowNode = BranchStartFlowNode;
export type CreationFlowNode = Node<CreationFlowNodeData, "creation">;
export type ForkJunctionFlowNode = Node<ForkJunctionFlowNodeData, "fork-junction">;
export type StepFlowNode = Node<StepFlowNodeData, "step">;
export type ReasoningFlowNode =
  | BranchStartFlowNode
  | CreationFlowNode
  | ForkJunctionFlowNode
  | StepFlowNode
  | StrategyFlowNode;

export interface LineageFlowEdgeData extends Record<string, unknown> {
  kind: LineageEdgeKind;
}

export interface DependencyFlowEdgeData extends Record<string, unknown> {
  dependency: StepDependency;
  kind: "dependency";
}

/** Data used to distinguish graph lineage from non-layout dependency relations. */
export type ReasoningFlowEdgeData = DependencyFlowEdgeData | LineageFlowEdgeData;
export type ReasoningFlowEdge = Edge<ReasoningFlowEdgeData, "smoothstep">;

export interface BuildReasoningFlowGraphInput {
  branches: readonly Branch[];
  stepDependencies: readonly StepDependency[];
  steps: readonly Step[];
  strategies: readonly Strategy[];
}

export interface ReasoningFlowGraph {
  dependencyEdges: ReasoningFlowEdge[];
  edges: ReasoningFlowEdge[];
  nodes: ReasoningFlowNode[];
  structuralEdges: ReasoningFlowEdge[];
}

interface NodeDimensions {
  height: number;
  width: number;
}

interface DagreNodeLabel extends NodeDimensions {
  x?: number;
  y?: number;
}

interface DagreEdgeLabel {
  minlen: number;
  weight: number;
}

/** Returns a stable React Flow node id for a persisted strategy id. */
export const strategyNodeId = (strategyId: string) => `strategy:${strategyId}`;

/** Returns a stable React Flow node id for a persisted branch id. */
export const branchNodeId = (branchId: string) => `branch:${branchId}`;

/** Returns a stable React Flow node id for a persisted step id. */
export const stepNodeId = (stepId: string) => `step:${stepId}`;

/** Returns a stable React Flow node id for the derived open-ended branch action. */
export const creationNodeId = (branchId: string) => `creation:${branchId}`;

/** Returns a stable React Flow node id for the derived junction after a fork step. */
export const forkJunctionNodeId = (stepId: string) => `fork-junction:${stepId}`;

/** Checks duplicate and cycle constraints before a dependency reaches the API. */
export function isValidStepDependencyConnection(
  dependencies: readonly StepDependency[],
  sourceStepId: string,
  targetStepId: string,
): boolean {
  if (sourceStepId === targetStepId) return false;

  const dependentsBySource = new Map<string, string[]>();
  for (const dependency of dependencies) {
    if (dependency.status !== "active") continue;
    if (
      dependency.depends_on_step_id === sourceStepId
      && dependency.step_id === targetStepId
    ) {
      return false;
    }
    const dependents = dependentsBySource.get(dependency.depends_on_step_id) ?? [];
    dependents.push(dependency.step_id);
    dependentsBySource.set(dependency.depends_on_step_id, dependents);
  }

  const pending = [targetStepId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === sourceStepId) return false;
    visited.add(current);
    pending.push(...(dependentsBySource.get(current) ?? []));
  }

  return true;
}

/**
 * Projects the persisted reasoning graph into React Flow elements without
 * changing any domain data. Fork junctions are derived presentation nodes:
 * they make each continuation and alternative path explicit while lineage
 * edges determine layout and dependency edges remain cross-references only.
 */
export function buildReasoningFlowGraph({
  branches: inputBranches,
  stepDependencies: inputStepDependencies,
  steps: inputSteps,
  strategies: inputStrategies,
}: BuildReasoningFlowGraphInput): ReasoningFlowGraph {
  const strategies = uniqueById(inputStrategies, compareCreatedAtAndId);
  const branches = uniqueById(inputBranches, compareBranch);
  const steps = uniqueById(inputSteps, compareStep);
  const dependencies = uniqueById(inputStepDependencies, compareCreatedAtAndId);
  const strategyIds = new Set(strategies.map((strategy) => strategy.id));
  const branchesById = new Map(branches.map((branch) => [branch.id, branch]));
  const stepsById = new Map(steps.map((step) => [step.id, step]));
  const stepsByBranchId = groupStepsByBranch(steps);
  const attachmentByBranchId = new Map<string, boolean>();

  for (const branch of branches) {
    attachmentByBranchId.set(branch.id, canAttachFork(branch, branchesById, stepsById));
  }

  const attachedChildrenByForkStepId = groupAttachedChildrenByForkStep(
    branches,
    attachmentByBranchId,
  );
  const continuationsByForkStepId = findContinuationsByForkStep(
    attachedChildrenByForkStepId,
    stepsByBranchId,
  );
  const creationNodeByBranchId = createCreationNodes(branches, stepsByBranchId);

  const nodes: ReasoningFlowNode[] = [
    ...strategies.map(createStrategyNode),
    ...branches.map((branch) => createBranchStartNode(
      branch,
      attachmentByBranchId.get(branch.id) === true
        ? stepsById.get(branch.forked_from_step_id ?? "") ?? null
        : null,
      attachmentByBranchId.get(branch.id) === true ? "fork" : "strategy",
      (stepsByBranchId.get(branch.id)?.length ?? 0) === 0,
    )),
    ...steps.map(createStepNode),
    ...creationNodeByBranchId.values(),
    ...createForkJunctionNodes(
      attachedChildrenByForkStepId,
      stepsById,
      branchesById,
      continuationsByForkStepId,
      creationNodeByBranchId,
    ),
  ];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const structuralEdges: ReasoningFlowEdge[] = [];

  for (const branch of branches) {
    const branchId = branchNodeId(branch.id);
    const attachedToFork = attachmentByBranchId.get(branch.id) === true;

    if (attachedToFork) continue;

    if (strategyIds.has(branch.strategy_id)) {
      structuralEdges.push(createLineageEdge(
        `strategy-root:${branch.strategy_id}:${branch.id}`,
        strategyNodeId(branch.strategy_id),
        branchId,
        "strategy-root",
      ));
    }
  }

  for (const branch of branches) {
    const branchSteps = stepsByBranchId.get(branch.id) ?? [];
    const firstStep = branchSteps[0];
    const creationNode = creationNodeByBranchId.get(branch.id);

    if (firstStep) {
      structuralEdges.push(createLineageEdge(
        `branch-step:${branch.id}:${firstStep.id}`,
        branchNodeId(branch.id),
        stepNodeId(firstStep.id),
        "branch-step",
      ));
    } else if (creationNode) {
      structuralEdges.push(createLineageEdge(
        `branch-creation:${branch.id}`,
        branchNodeId(branch.id),
        creationNode.id,
        "branch-creation",
      ));
    }

    for (let index = 1; index < branchSteps.length; index += 1) {
      const previousStep = branchSteps[index - 1];
      const nextStep = branchSteps[index];
      if (!previousStep || !nextStep) continue;

      if (attachedChildrenByForkStepId.has(previousStep.id)) continue;

      structuralEdges.push(createLineageEdge(
        `sequence:${branch.id}:${previousStep.id}:${nextStep.id}`,
        stepNodeId(previousStep.id),
        stepNodeId(nextStep.id),
        "sequence",
      ));
    }

    const finalStep = branchSteps.at(-1);
    if (finalStep && creationNode && !attachedChildrenByForkStepId.has(finalStep.id)) {
      structuralEdges.push(createLineageEdge(
        `creation:${branch.id}:${finalStep.id}`,
        stepNodeId(finalStep.id),
        creationNode.id,
        "creation",
      ));
    }
  }

  for (const [forkStepId, childBranches] of attachedChildrenByForkStepId) {
    const forkStep = stepsById.get(forkStepId);
    if (!forkStep) continue;

    const junctionId = forkJunctionNodeId(forkStep.id);
    structuralEdges.push(createLineageEdge(
      `fork-junction:${forkStep.id}`,
      stepNodeId(forkStep.id),
      junctionId,
      "fork-junction",
    ));

    const continuation = continuationsByForkStepId.get(forkStep.id) ?? null;
    if (continuation) {
      structuralEdges.push(createLineageEdge(
        `fork-continuation:${forkStep.branch_id}:${forkStep.id}:${continuation.id}`,
        junctionId,
        stepNodeId(continuation.id),
        "fork-continuation",
        { sourceHandle: `path:${forkStep.branch_id}` },
      ));
    } else {
      const parentCreationNode = creationNodeByBranchId.get(forkStep.branch_id);
      if (parentCreationNode) {
        structuralEdges.push(createLineageEdge(
          `fork-continuation:${forkStep.branch_id}:${forkStep.id}:creation`,
          junctionId,
          parentCreationNode.id,
          "fork-continuation",
          { sourceHandle: `path:${forkStep.branch_id}` },
        ));
      }
    }

    for (const childBranch of childBranches) {
      structuralEdges.push(createLineageEdge(
        `fork:${forkStep.id}:${childBranch.id}`,
        junctionId,
        branchNodeId(childBranch.id),
        "fork",
        { sourceHandle: `path:${childBranch.id}` },
      ));
    }
  }

  const dependencyEdges = dependencies.flatMap((dependency) => {
    if (
      dependency.status !== "active"
      || !nodeIds.has(stepNodeId(dependency.depends_on_step_id))
      || !nodeIds.has(stepNodeId(dependency.step_id))
    ) {
      return [];
    }

    return [createDependencyEdge(dependency)];
  });

  const edges = [...structuralEdges, ...dependencyEdges];

  return {
    dependencyEdges,
    edges,
    nodes: layoutReasoningFlowGraph(nodes, edges),
    structuralEdges,
  };
}

/**
 * Applies a top-to-bottom Dagre layout. React Flow's measured dimensions take
 * precedence after initial render; estimates keep the first paint legible.
 */
export function layoutReasoningFlowGraph(
  nodes: readonly ReasoningFlowNode[],
  edges: readonly ReasoningFlowEdge[],
): ReasoningFlowNode[] {
  const dagreGraph = new graphlib.Graph<
    { align: "UL"; edgesep: number; marginx: number; marginy: number; nodesep: number; rankdir: "TB"; ranksep: number },
    DagreNodeLabel,
    DagreEdgeLabel
  >({ multigraph: true });

  dagreGraph.setGraph({
    align: "UL",
    edgesep: 72,
    marginx: 96,
    marginy: 96,
    nodesep: 132,
    rankdir: "TB",
    ranksep: 124,
  });
  dagreGraph.setDefaultEdgeLabel(() => ({ minlen: 1, weight: 1 }));

  const nodeIds = new Set(nodes.map((node) => node.id));
  const dimensionsById = new Map<string, NodeDimensions>();

  for (const node of nodes) {
    const dimensions = getNodeDimensions(node);
    dimensionsById.set(node.id, dimensions);
    dagreGraph.setNode(node.id, dimensions);
  }

  for (const edge of edges) {
    if (edge.data?.kind === "dependency") continue;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;

    dagreGraph.setEdge(
      { name: edge.id, v: edge.source, w: edge.target },
      getDagreEdgeLabel(edge.data?.kind),
    );
  }

  dagreLayout(dagreGraph);

  return nodes.map((node) => {
    const positioned = dagreGraph.node(node.id);
    const dimensions = dimensionsById.get(node.id);
    if (!positioned || !dimensions || !isFiniteCoordinate(positioned.x) || !isFiniteCoordinate(positioned.y)) {
      return { ...node, position: { ...node.position } };
    }

    return {
      ...node,
      position: {
        x: Math.round(positioned.x - dimensions.width / 2),
        y: Math.round(positioned.y - dimensions.height / 2),
      },
    };
  });
}

function createStrategyNode(strategy: Strategy): StrategyFlowNode {
  return {
    ariaLabel: `Strategy: ${markdownToPlainText(strategy.title)}`,
    connectable: false,
    data: { kind: "strategy", strategy },
    deletable: false,
    draggable: true,
    id: strategyNodeId(strategy.id),
    initialHeight: ESTIMATED_DIMENSIONS.strategy.height,
    initialWidth: ESTIMATED_DIMENSIONS.strategy.width,
    position: { x: 0, y: 0 },
    selectable: true,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    type: "strategy",
  };
}

function createBranchStartNode(
  branch: Branch,
  forkStep: Step | null,
  origin: BranchStartFlowNodeData["origin"],
  empty: boolean,
): BranchStartFlowNode {
  return {
    ariaLabel: `${origin === "strategy" ? "Starting" : "Alternative"} branch: ${markdownToPlainText(branch.name)}`,
    connectable: false,
    data: { branch, empty, forkStep, kind: "branch-start", origin },
    deletable: false,
    draggable: true,
    id: branchNodeId(branch.id),
    initialHeight: ESTIMATED_DIMENSIONS["branch-start"].height,
    initialWidth: ESTIMATED_DIMENSIONS["branch-start"].width,
    position: { x: 0, y: 0 },
    selectable: true,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    type: "branch-start",
  };
}

function createCreationNodes(
  branches: readonly Branch[],
  stepsByBranchId: ReadonlyMap<string, Step[]>,
): Map<string, CreationFlowNode> {
  const nodes = new Map<string, CreationFlowNode>();

  for (const branch of branches) {
    const afterStep = stepsByBranchId.get(branch.id)?.at(-1) ?? null;
    if (branch.status !== "active" || afterStep?.status === "dead_end") continue;

    nodes.set(branch.id, {
      ariaLabel: afterStep
        ? `Create after Step ${afterStep.ordinal} in ${markdownToPlainText(branch.name)}`
        : `Start ${markdownToPlainText(branch.name)}`,
      connectable: false,
      data: {
        afterStep,
        branch,
        canBranch: afterStep !== null,
        kind: "creation",
      },
      deletable: false,
      draggable: true,
      id: creationNodeId(branch.id),
      initialHeight: ESTIMATED_DIMENSIONS.creation.height,
      initialWidth: ESTIMATED_DIMENSIONS.creation.width,
      position: { x: 0, y: 0 },
      selectable: false,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      type: "creation",
    });
  }

  return nodes;
}

function createForkJunctionNodes(
  attachedChildrenByForkStepId: ReadonlyMap<string, Branch[]>,
  stepsById: ReadonlyMap<string, Step>,
  branchesById: ReadonlyMap<string, Branch>,
  continuationsByForkStepId: ReadonlyMap<string, Step | null>,
  creationNodeByBranchId: ReadonlyMap<string, CreationFlowNode>,
): ForkJunctionFlowNode[] {
  const nodes: ForkJunctionFlowNode[] = [];

  for (const [forkStepId, childBranches] of attachedChildrenByForkStepId) {
    const forkStep = stepsById.get(forkStepId);
    const parentBranch = forkStep ? branchesById.get(forkStep.branch_id) : undefined;
    if (!forkStep || !parentBranch) continue;

    const continuation = continuationsByForkStepId.get(forkStep.id) ?? null;
    const hasParentCreation = creationNodeByBranchId.has(parentBranch.id);
    const paths: ForkJunctionPath[] = [
      ...(continuation || hasParentCreation
        ? [{ branch: parentBranch, kind: "continuation" as const }]
        : []),
      ...childBranches.map((branch) => ({ branch, kind: "alternative" as const })),
    ];

    nodes.push({
      ariaLabel: `Fork after Step ${forkStep.ordinal}: ${childBranches.length} alternative${childBranches.length === 1 ? "" : "s"}`,
      connectable: false,
      data: { forkStep, kind: "fork-junction", parentBranch, paths },
      deletable: false,
      draggable: true,
      id: forkJunctionNodeId(forkStep.id),
      initialHeight: ESTIMATED_DIMENSIONS["fork-junction"].height,
      initialWidth: ESTIMATED_DIMENSIONS["fork-junction"].width,
      position: { x: 0, y: 0 },
      selectable: false,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      type: "fork-junction",
    });
  }

  return nodes;
}

function createStepNode(step: Step): StepFlowNode {
  return {
    ariaLabel: `Step ${step.ordinal}: ${markdownToPlainText(step.title)}`,
    connectable: false,
    data: { kind: "step", step },
    deletable: false,
    draggable: true,
    id: stepNodeId(step.id),
    initialHeight: ESTIMATED_DIMENSIONS.step.height,
    initialWidth: ESTIMATED_DIMENSIONS.step.width,
    position: { x: 0, y: 0 },
    selectable: true,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    type: "step",
  };
}

function createLineageEdge(
  id: string,
  source: string,
  target: string,
  kind: LineageEdgeKind,
  overrides: Partial<Pick<ReasoningFlowEdge, "sourceHandle" | "targetHandle">> = {},
): ReasoningFlowEdge {
  const appearance = getLineageEdgeAppearance(kind);

  return {
    className: `lemma-flow-edge lemma-flow-edge--lineage lemma-flow-edge--${kind}`,
    data: { kind },
    id,
    markerEnd: { color: appearance.color, type: "arrowclosed" },
    selectable: false,
    source,
    sourceHandle: LINEAGE_SOURCE_HANDLE,
    style: { stroke: appearance.color, strokeWidth: appearance.width },
    target,
    targetHandle: LINEAGE_TARGET_HANDLE,
    type: "smoothstep",
    ...overrides,
  };
}

function getLineageEdgeAppearance(kind: LineageEdgeKind): { color: string; width: number } {
  if (kind === "fork-junction") return { color: "#69489b", width: 2 };
  if (kind === "fork") return { color: "#b36d66", width: 1.8 };
  if (kind === "creation" || kind === "branch-creation") {
    return { color: "#737d46", width: 1.8 };
  }
  if (kind === "fork-continuation") return { color: "#746b77", width: 1.8 };
  return { color: "#98918e", width: 1.45 };
}

function createDependencyEdge(dependency: StepDependency): ReasoningFlowEdge {
  return {
    animated: false,
    className: "lemma-flow-edge lemma-flow-edge--dependency",
    data: { dependency, kind: "dependency" },
    id: `dependency:${dependency.id}`,
    label: humanizeDependencyRelation(dependency.relation_kind),
    labelBgBorderRadius: 4,
    labelBgPadding: [4, 3],
    labelBgStyle: { fill: "#f7f2fb", fillOpacity: 0.94 },
    labelShowBg: true,
    labelStyle: { fill: "#6d4aa5", fontSize: 10, fontWeight: 700 },
    markerEnd: { color: "#6d4aa5", type: "arrowclosed" },
    selectable: false,
    source: stepNodeId(dependency.depends_on_step_id),
    sourceHandle: DEPENDENCY_SOURCE_HANDLE,
    style: { stroke: "#6d4aa5", strokeDasharray: "6 5", strokeWidth: 1.65 },
    target: stepNodeId(dependency.step_id),
    targetHandle: DEPENDENCY_TARGET_HANDLE,
    type: "smoothstep",
    zIndex: 1,
  };
}

function groupStepsByBranch(steps: readonly Step[]): Map<string, Step[]> {
  const stepsByBranchId = new Map<string, Step[]>();

  for (const step of steps) {
    const branchSteps = stepsByBranchId.get(step.branch_id) ?? [];
    branchSteps.push(step);
    stepsByBranchId.set(step.branch_id, branchSteps);
  }

  for (const branchSteps of stepsByBranchId.values()) {
    branchSteps.sort(compareStep);
  }

  return stepsByBranchId;
}

function groupAttachedChildrenByForkStep(
  branches: readonly Branch[],
  attachmentByBranchId: ReadonlyMap<string, boolean>,
): Map<string, Branch[]> {
  const childrenByForkStepId = new Map<string, Branch[]>();

  for (const branch of branches) {
    if (!attachmentByBranchId.get(branch.id) || !branch.forked_from_step_id) continue;
    const children = childrenByForkStepId.get(branch.forked_from_step_id) ?? [];
    children.push(branch);
    childrenByForkStepId.set(branch.forked_from_step_id, children);
  }

  const orderedForkStepIds = [...childrenByForkStepId.keys()].sort(compareText);
  const ordered = new Map<string, Branch[]>();
  for (const forkStepId of orderedForkStepIds) {
    const children = childrenByForkStepId.get(forkStepId);
    if (!children) continue;
    ordered.set(forkStepId, [...children].sort(compareCreatedAtAndId));
  }
  return ordered;
}

function findContinuationsByForkStep(
  attachedChildrenByForkStepId: ReadonlyMap<string, Branch[]>,
  stepsByBranchId: ReadonlyMap<string, Step[]>,
): Map<string, Step | null> {
  const continuations = new Map<string, Step | null>();

  for (const forkStepId of attachedChildrenByForkStepId.keys()) {
    const branchSteps = [...stepsByBranchId.values()].find((steps) => (
      steps.some((step) => step.id === forkStepId)
    ));
    if (!branchSteps) {
      continuations.set(forkStepId, null);
      continue;
    }
    const forkIndex = branchSteps.findIndex((step) => step.id === forkStepId);
    continuations.set(forkStepId, forkIndex >= 0 ? branchSteps[forkIndex + 1] ?? null : null);
  }

  return continuations;
}

function getDagreEdgeLabel(kind: LineageEdgeKind | undefined): DagreEdgeLabel {
  switch (kind) {
    case "fork-junction":
      return { minlen: 1, weight: 8 };
    case "fork-continuation":
      return { minlen: 1, weight: 7 };
    case "fork":
      return { minlen: 1, weight: 4 };
    case "sequence":
      return { minlen: 1, weight: 6 };
    case "creation":
      return { minlen: 1, weight: 7 };
    case "branch-creation":
    case "branch-step":
    case "strategy-root":
      return { minlen: 1, weight: 5 };
    default:
      return { minlen: 1, weight: 1 };
  }
}

function canAttachFork(
  branch: Branch,
  branchesById: ReadonlyMap<string, Branch>,
  stepsById: ReadonlyMap<string, Step>,
): boolean {
  if (!branch.parent_branch_id || !branch.forked_from_step_id) return false;

  const parentBranch = branchesById.get(branch.parent_branch_id);
  const forkStep = stepsById.get(branch.forked_from_step_id);
  if (!parentBranch || !forkStep) return false;

  if (
    parentBranch.id === branch.id
    || parentBranch.strategy_id !== branch.strategy_id
    || parentBranch.workspace_id !== branch.workspace_id
    || forkStep.branch_id !== parentBranch.id
    || forkStep.strategy_id !== branch.strategy_id
    || forkStep.workspace_id !== branch.workspace_id
  ) {
    return false;
  }

  return !wouldCreateBranchCycle(branch.id, parentBranch, branchesById);
}

function wouldCreateBranchCycle(
  branchId: string,
  parentBranch: Branch,
  branchesById: ReadonlyMap<string, Branch>,
): boolean {
  const visited = new Set<string>();
  let current: Branch | undefined = parentBranch;

  while (current) {
    if (current.id === branchId || visited.has(current.id)) return true;
    visited.add(current.id);
    current = current.parent_branch_id ? branchesById.get(current.parent_branch_id) : undefined;
  }

  return false;
}

function getNodeDimensions(node: ReasoningFlowNode): NodeDimensions {
  const estimate = ESTIMATED_DIMENSIONS[node.data.kind];
  return {
    height: pickDimension(node.measured?.height, node.height, node.initialHeight, estimate.height),
    width: pickDimension(node.measured?.width, node.width, node.initialWidth, estimate.width),
  };
}

function pickDimension(...candidates: Array<number | undefined>): number {
  for (const candidate of candidates) {
    if (isValidDimension(candidate)) return candidate;
  }
  const fallback = candidates.at(-1);
  if (fallback === undefined) throw new Error("A reasoning flow node requires a fallback dimension.");
  return fallback;
}

function isValidDimension(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function isFiniteCoordinate(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function uniqueById<T extends { id: string }>(values: readonly T[], compare: (left: T, right: T) => number): T[] {
  const unique = new Map<string, T>();

  for (const value of [...values].sort(compare)) {
    if (!unique.has(value.id)) unique.set(value.id, value);
  }

  return [...unique.values()];
}

function compareBranch(left: Branch, right: Branch): number {
  return compareText(left.strategy_id, right.strategy_id)
    || compareCreatedAtAndId(left, right);
}

function compareStep(left: Step, right: Step): number {
  return compareText(left.branch_id, right.branch_id)
    || left.ordinal - right.ordinal
    || compareCreatedAtAndId(left, right);
}

function compareCreatedAtAndId<T extends { created_at: string; id: string }>(left: T, right: T): number {
  return compareText(left.created_at, right.created_at) || compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function humanizeDependencyRelation(relationKind: StepDependency["relation_kind"]): string {
  switch (relationKind) {
    case "contradicts":
      return "Contradicts";
    case "logical":
      return "Logical dependency";
    case "motivated_by":
      return "Motivated by";
    case "uses_result":
      return "Uses result";
  }
}
