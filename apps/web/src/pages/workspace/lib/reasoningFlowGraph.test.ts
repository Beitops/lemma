import type { Branch, Step, StepDependency, Strategy } from "@lemma/contracts";
import { describe, expect, it } from "vitest";
import {
  branchNodeId,
  buildReasoningFlowGraph,
  creationNodeId,
  forkJunctionNodeId,
  isValidStepDependencyConnection,
  layoutReasoningFlowGraph,
  stepNodeId,
  strategyNodeId,
  type BranchStartFlowNode,
  type CreationFlowNode,
  type ForkJunctionFlowNode,
  type StepFlowNode,
} from "./reasoningFlowGraph";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const CREATED_AT = "2026-08-31T12:00:00.000Z";

function makeStrategy(id: string, overrides: Partial<Strategy> = {}): Strategy {
  return {
    author_agent_name: null,
    author_type: "human",
    author_user_id: USER_ID,
    created_at: CREATED_AT,
    description_markdown: "A proof route.",
    id,
    objective_id: "25000000-0000-4000-8000-000000000001",
    revision: 1,
    status: "active",
    title: `Strategy ${id.slice(-2)}`,
    updated_at: CREATED_AT,
    workspace_id: WORKSPACE_ID,
    ...overrides,
  };
}

function makeBranch(strategyId: string, id: string, overrides: Partial<Branch> = {}): Branch {
  return {
    author_agent_name: null,
    author_type: "human",
    author_user_id: USER_ID,
    created_at: CREATED_AT,
    forked_from_step_id: null,
    id,
    name: `Branch ${id.slice(-2)}`,
    parent_branch_id: null,
    revision: 1,
    status: "active",
    strategy_id: strategyId,
    updated_at: CREATED_AT,
    workspace_id: WORKSPACE_ID,
    ...overrides,
  };
}

function makeStep(
  strategyId: string,
  branchId: string,
  id: string,
  ordinal: number,
  overrides: Partial<Step> = {},
): Step {
  return {
    author_agent_name: "Lemma Agent",
    author_type: "agent",
    author_user_id: null,
    body_markdown: "A justified mathematical move.",
    branch_id: branchId,
    concepts: [],
    created_at: CREATED_AT,
    id,
    ordinal,
    revision: 1,
    status: "active",
    strategy_id: strategyId,
    summary: null,
    supersedes_step_id: null,
    theorem_tags: [],
    title: `Step ${ordinal}`,
    updated_at: CREATED_AT,
    workspace_id: WORKSPACE_ID,
    ...overrides,
  };
}

function makeDependency(
  id: string,
  sourceStepId: string,
  targetStepId: string,
  overrides: Partial<StepDependency> = {},
): StepDependency {
  return {
    author_agent_name: "Lemma Agent",
    author_type: "agent",
    author_user_id: null,
    created_at: CREATED_AT,
    depends_on_step_id: sourceStepId,
    id,
    rationale_markdown: "The result is needed here.",
    relation_kind: "uses_result",
    revision: 1,
    status: "active",
    step_id: targetStepId,
    updated_at: CREATED_AT,
    workspace_id: WORKSPACE_ID,
    ...overrides,
  };
}

function findBranchStartNode(
  nodes: ReturnType<typeof buildReasoningFlowGraph>["nodes"],
  branchId: string,
): BranchStartFlowNode {
  const node = nodes.find(
    (candidate): candidate is BranchStartFlowNode => candidate.id === branchNodeId(branchId),
  );
  if (!node) throw new Error(`Missing branch-start node ${branchId}`);
  return node;
}

function findForkJunctionNode(
  nodes: ReturnType<typeof buildReasoningFlowGraph>["nodes"],
  stepId: string,
): ForkJunctionFlowNode {
  const node = nodes.find(
    (candidate): candidate is ForkJunctionFlowNode => candidate.id === forkJunctionNodeId(stepId),
  );
  if (!node) throw new Error(`Missing fork junction node ${stepId}`);
  return node;
}

function findCreationNode(
  nodes: ReturnType<typeof buildReasoningFlowGraph>["nodes"],
  branchId: string,
): CreationFlowNode {
  const node = nodes.find(
    (candidate): candidate is CreationFlowNode => candidate.id === creationNodeId(branchId),
  );
  if (!node) throw new Error(`Missing creation node ${branchId}`);
  return node;
}

function findStepNode(
  nodes: ReturnType<typeof buildReasoningFlowGraph>["nodes"],
  stepId: string,
): StepFlowNode {
  const node = nodes.find(
    (candidate): candidate is StepFlowNode => candidate.id === stepNodeId(stepId),
  );
  if (!node) throw new Error(`Missing step node ${stepId}`);
  return node;
}

function hasStructuralEdge(
  graph: ReturnType<typeof buildReasoningFlowGraph>,
  source: string,
  target: string,
): boolean {
  return graph.structuralEdges.some((edge) => edge.source === source && edge.target === target);
}

describe("reasoningFlowGraph", () => {
  it("projects root branches as non-connectable branch-start nodes with stable ids", () => {
    const firstStrategy = makeStrategy("30000000-0000-4000-8000-000000000001");
    const secondStrategy = makeStrategy("30000000-0000-4000-8000-000000000002", {
      created_at: "2026-08-31T12:01:00.000Z",
    });
    const firstBranch = makeBranch(firstStrategy.id, "40000000-0000-4000-8000-000000000001");
    const secondBranch = makeBranch(secondStrategy.id, "40000000-0000-4000-8000-000000000002");

    const graph = buildReasoningFlowGraph({
      branches: [secondBranch, firstBranch],
      stepDependencies: [],
      steps: [],
      strategies: [secondStrategy, firstStrategy],
    });

    expect(graph.nodes.filter((node) => node.type === "strategy").map((node) => node.id)).toEqual([
      strategyNodeId(firstStrategy.id),
      strategyNodeId(secondStrategy.id),
    ]);
    expect(graph.nodes.filter((node) => node.type === "branch-start")).toHaveLength(2);
    expect(findBranchStartNode(graph.nodes, firstBranch.id)).toMatchObject({
      connectable: false,
      data: { empty: true, forkStep: null, kind: "branch-start", origin: "strategy" },
      type: "branch-start",
    });
    expect(findCreationNode(graph.nodes, firstBranch.id)).toMatchObject({
      connectable: false,
      data: {
        afterStep: null,
        branch: { id: firstBranch.id },
        canBranch: false,
        kind: "creation",
      },
      draggable: true,
      selectable: false,
      type: "creation",
    });
    expect(graph.structuralEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: { kind: "strategy-root" },
        source: strategyNodeId(firstStrategy.id),
        sourceHandle: "lineage-source",
        target: branchNodeId(firstBranch.id),
        targetHandle: "lineage-target",
      }),
      expect.objectContaining({
        data: { kind: "strategy-root" },
        source: strategyNodeId(secondStrategy.id),
        target: branchNodeId(secondBranch.id),
      }),
      expect.objectContaining({
        data: { kind: "branch-creation" },
        source: branchNodeId(firstBranch.id),
        sourceHandle: "lineage-source",
        target: creationNodeId(firstBranch.id),
        targetHandle: "lineage-target",
      }),
    ]));
  });

  it("reserves a larger initial Dagre footprint for full strategy titles and descriptions", () => {
    const strategy = makeStrategy("30000000-0000-4000-8000-000000000003", {
      description_markdown: "A deliberately long explanation that remains scrollable in the strategy node.",
      title: "A multi-line strategy title that should never be ellipsized in the board",
    });

    const graph = buildReasoningFlowGraph({
      branches: [],
      stepDependencies: [],
      steps: [],
      strategies: [strategy],
    });
    const strategyNode = graph.nodes.find((node) => node.id === strategyNodeId(strategy.id));

    expect(strategyNode).toMatchObject({
      initialHeight: 360,
      initialWidth: 420,
      type: "strategy",
    });
  });

  it("uses one fork junction to separate continuation and alternative paths", () => {
    const strategy = makeStrategy("30000000-0000-4000-8000-000000000011");
    const root = makeBranch(strategy.id, "40000000-0000-4000-8000-000000000011");
    const forkStep = makeStep(strategy.id, root.id, "50000000-0000-4000-8000-000000000011", 1);
    const continuation = makeStep(strategy.id, root.id, "50000000-0000-4000-8000-000000000012", 2);
    const child = makeBranch(strategy.id, "40000000-0000-4000-8000-000000000012", {
      forked_from_step_id: forkStep.id,
      parent_branch_id: root.id,
    });
    const childStep = makeStep(strategy.id, child.id, "50000000-0000-4000-8000-000000000013", 1);

    const graph = buildReasoningFlowGraph({
      branches: [child, root],
      stepDependencies: [],
      steps: [childStep, continuation, forkStep],
      strategies: [strategy],
    });
    const junction = findForkJunctionNode(graph.nodes, forkStep.id);

    expect(findBranchStartNode(graph.nodes, child.id).data).toMatchObject({
      empty: false,
      forkStep: { id: forkStep.id },
      kind: "branch-start",
      origin: "fork",
    });
    expect(junction).toMatchObject({
      connectable: false,
      data: {
        forkStep: { id: forkStep.id },
        kind: "fork-junction",
        parentBranch: { id: root.id },
        paths: [
          { branch: { id: root.id }, kind: "continuation" },
          { branch: { id: child.id }, kind: "alternative" },
        ],
      },
      selectable: false,
      type: "fork-junction",
    });
    expect(graph.structuralEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: { kind: "fork-junction" },
        source: stepNodeId(forkStep.id),
        sourceHandle: "lineage-source",
        target: forkJunctionNodeId(forkStep.id),
        targetHandle: "lineage-target",
      }),
      expect.objectContaining({
        data: { kind: "fork-continuation" },
        source: forkJunctionNodeId(forkStep.id),
        sourceHandle: `path:${root.id}`,
        target: stepNodeId(continuation.id),
      }),
      expect.objectContaining({
        data: { kind: "fork" },
        source: forkJunctionNodeId(forkStep.id),
        sourceHandle: `path:${child.id}`,
        target: branchNodeId(child.id),
        targetHandle: "lineage-target",
      }),
    ]));
    expect(hasStructuralEdge(graph, stepNodeId(forkStep.id), branchNodeId(child.id))).toBe(false);
    expect(hasStructuralEdge(graph, stepNodeId(forkStep.id), stepNodeId(continuation.id))).toBe(false);
    expect(hasStructuralEdge(graph, stepNodeId(forkStep.id), creationNodeId(root.id))).toBe(false);
    expect(hasStructuralEdge(graph, stepNodeId(continuation.id), creationNodeId(root.id))).toBe(true);
    expect(hasStructuralEdge(graph, stepNodeId(childStep.id), creationNodeId(child.id))).toBe(true);
  });

  it("orders multiple alternatives deterministically and keeps one junction per fork step", () => {
    const strategy = makeStrategy("30000000-0000-4000-8000-000000000021");
    const root = makeBranch(strategy.id, "40000000-0000-4000-8000-000000000021");
    const forkStep = makeStep(strategy.id, root.id, "50000000-0000-4000-8000-000000000021", 1);
    const continuation = makeStep(strategy.id, root.id, "50000000-0000-4000-8000-000000000022", 2);
    const secondAlternative = makeBranch(strategy.id, "40000000-0000-4000-8000-000000000023", {
      created_at: "2026-08-31T12:02:00.000Z",
      forked_from_step_id: forkStep.id,
      parent_branch_id: root.id,
    });
    const firstAlternative = makeBranch(strategy.id, "40000000-0000-4000-8000-000000000022", {
      created_at: "2026-08-31T12:01:00.000Z",
      forked_from_step_id: forkStep.id,
      parent_branch_id: root.id,
    });

    const graph = buildReasoningFlowGraph({
      branches: [secondAlternative, root, firstAlternative],
      stepDependencies: [],
      steps: [continuation, forkStep],
      strategies: [strategy],
    });
    const junction = findForkJunctionNode(graph.nodes, forkStep.id);

    expect(graph.nodes.filter((node) => node.id === forkJunctionNodeId(forkStep.id))).toHaveLength(1);
    expect(junction.data.paths.map(({ branch, kind }) => `${kind}:${branch.id}`)).toEqual([
      `continuation:${root.id}`,
      `alternative:${firstAlternative.id}`,
      `alternative:${secondAlternative.id}`,
    ]);
    expect(graph.structuralEdges.filter((edge) => edge.data?.kind === "fork").map((edge) => edge.target)).toEqual([
      branchNodeId(firstAlternative.id),
      branchNodeId(secondAlternative.id),
    ]);
  });

  it("projects nested forks independently without restoring obsolete direct edges", () => {
    const strategy = makeStrategy("30000000-0000-4000-8000-000000000031");
    const root = makeBranch(strategy.id, "40000000-0000-4000-8000-000000000031");
    const rootForkStep = makeStep(strategy.id, root.id, "50000000-0000-4000-8000-000000000031", 1);
    const rootContinuation = makeStep(strategy.id, root.id, "50000000-0000-4000-8000-000000000032", 2);
    const child = makeBranch(strategy.id, "40000000-0000-4000-8000-000000000032", {
      forked_from_step_id: rootForkStep.id,
      parent_branch_id: root.id,
    });
    const childForkStep = makeStep(strategy.id, child.id, "50000000-0000-4000-8000-000000000033", 1);
    const childContinuation = makeStep(strategy.id, child.id, "50000000-0000-4000-8000-000000000034", 2);
    const grandchild = makeBranch(strategy.id, "40000000-0000-4000-8000-000000000033", {
      forked_from_step_id: childForkStep.id,
      parent_branch_id: child.id,
    });

    const graph = buildReasoningFlowGraph({
      branches: [grandchild, child, root],
      stepDependencies: [],
      steps: [childContinuation, childForkStep, rootContinuation, rootForkStep],
      strategies: [strategy],
    });

    expect(graph.nodes.filter((node) => node.type === "fork-junction").map((node) => node.id)).toEqual([
      forkJunctionNodeId(rootForkStep.id),
      forkJunctionNodeId(childForkStep.id),
    ]);
    expect(hasStructuralEdge(graph, stepNodeId(rootForkStep.id), stepNodeId(rootContinuation.id))).toBe(false);
    expect(hasStructuralEdge(graph, stepNodeId(childForkStep.id), stepNodeId(childContinuation.id))).toBe(false);
    expect(hasStructuralEdge(graph, stepNodeId(rootForkStep.id), branchNodeId(child.id))).toBe(false);
    expect(hasStructuralEdge(graph, stepNodeId(childForkStep.id), branchNodeId(grandchild.id))).toBe(false);
    expect(hasStructuralEdge(graph, forkJunctionNodeId(rootForkStep.id), stepNodeId(rootContinuation.id))).toBe(true);
    expect(hasStructuralEdge(graph, forkJunctionNodeId(childForkStep.id), stepNodeId(childContinuation.id))).toBe(true);
    expect(hasStructuralEdge(graph, forkJunctionNodeId(rootForkStep.id), branchNodeId(child.id))).toBe(true);
    expect(hasStructuralEdge(graph, forkJunctionNodeId(childForkStep.id), branchNodeId(grandchild.id))).toBe(true);
  });

  it("routes a final fork through the parent creator and child creator", () => {
    const strategy = makeStrategy("30000000-0000-4000-8000-000000000041");
    const root = makeBranch(strategy.id, "40000000-0000-4000-8000-000000000041");
    const finalStep = makeStep(strategy.id, root.id, "50000000-0000-4000-8000-000000000041", 1);
    const child = makeBranch(strategy.id, "40000000-0000-4000-8000-000000000042", {
      forked_from_step_id: finalStep.id,
      parent_branch_id: root.id,
    });

    const graph = buildReasoningFlowGraph({
      branches: [child, root],
      stepDependencies: [],
      steps: [finalStep],
      strategies: [strategy],
    });
    const junction = findForkJunctionNode(graph.nodes, finalStep.id);
    const incomingForkEdge = graph.structuralEdges.find(
      (edge) => edge.data?.kind === "fork-junction",
    );

    expect(junction.data.paths).toEqual([
      { branch: root, kind: "continuation" },
      { branch: child, kind: "alternative" },
    ]);
    expect(findCreationNode(graph.nodes, root.id).data).toMatchObject({
      afterStep: { id: finalStep.id },
      branch: { id: root.id },
      canBranch: true,
    });
    expect(findCreationNode(graph.nodes, child.id).data).toMatchObject({
      afterStep: null,
      branch: { id: child.id },
      canBranch: false,
    });
    expect(graph.structuralEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: { kind: "fork-continuation" },
        source: forkJunctionNodeId(finalStep.id),
        sourceHandle: `path:${root.id}`,
        target: creationNodeId(root.id),
        targetHandle: "lineage-target",
      }),
      expect.objectContaining({
        data: { kind: "branch-creation" },
        source: branchNodeId(child.id),
        target: creationNodeId(child.id),
      }),
    ]));
    expect(hasStructuralEdge(graph, stepNodeId(finalStep.id), creationNodeId(root.id))).toBe(false);
    expect(hasStructuralEdge(graph, forkJunctionNodeId(finalStep.id), branchNodeId(child.id))).toBe(true);
    expect(incomingForkEdge).toMatchObject({
      markerEnd: { color: "#69489b", type: "arrowclosed" },
      style: { stroke: "#69489b", strokeWidth: 2 },
    });
  });

  it("creates a terminal action only for open active branches", () => {
    const strategy = makeStrategy("30000000-0000-4000-8000-000000000051");
    const activeBranch = makeBranch(strategy.id, "40000000-0000-4000-8000-000000000051");
    const completedBranch = makeBranch(strategy.id, "40000000-0000-4000-8000-000000000052", {
      status: "completed",
    });
    const activeFirst = makeStep(strategy.id, activeBranch.id, "50000000-0000-4000-8000-000000000051", 1);
    const activeLast = makeStep(strategy.id, activeBranch.id, "50000000-0000-4000-8000-000000000052", 2);
    const completedLast = makeStep(strategy.id, completedBranch.id, "50000000-0000-4000-8000-000000000053", 1);

    const graph = buildReasoningFlowGraph({
      branches: [completedBranch, activeBranch],
      stepDependencies: [],
      steps: [activeLast, completedLast, activeFirst],
      strategies: [strategy],
    });

    expect(findCreationNode(graph.nodes, activeBranch.id).data).toMatchObject({
      afterStep: { id: activeLast.id },
      canBranch: true,
    });
    expect(findStepNode(graph.nodes, activeFirst.id).data).toEqual({ kind: "step", step: activeFirst });
    expect(graph.nodes.some((node) => node.id === creationNodeId(completedBranch.id))).toBe(false);
    expect(graph.structuralEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: { kind: "creation" },
        source: stepNodeId(activeLast.id),
        sourceHandle: "lineage-source",
        target: creationNodeId(activeBranch.id),
        targetHandle: "lineage-target",
      }),
    ]));
  });

  it("does not create an action point after a dead-end final step", () => {
    const strategy = makeStrategy("30000000-0000-4000-8000-000000000056");
    const branch = makeBranch(strategy.id, "40000000-0000-4000-8000-000000000056");
    const first = makeStep(strategy.id, branch.id, "50000000-0000-4000-8000-000000000056", 1);
    const deadEnd = makeStep(
      strategy.id,
      branch.id,
      "50000000-0000-4000-8000-000000000057",
      2,
      { status: "dead_end" },
    );

    const graph = buildReasoningFlowGraph({
      branches: [branch],
      stepDependencies: [],
      steps: [deadEnd, first],
      strategies: [strategy],
    });

    expect(graph.nodes.some((node) => node.id === creationNodeId(branch.id))).toBe(false);
    expect(graph.structuralEdges.some((edge) => edge.data?.kind === "creation")).toBe(false);
  });

  it("promotes invalid forks to strategy origins without deriving a junction", () => {
    const strategy = makeStrategy("30000000-0000-4000-8000-000000000061");
    const root = makeBranch(strategy.id, "40000000-0000-4000-8000-000000000061");
    const orphan = makeBranch(strategy.id, "40000000-0000-4000-8000-000000000062", {
      forked_from_step_id: "50000000-0000-4000-8000-000000000099",
      parent_branch_id: root.id,
    });
    const repeatedStep = makeStep(strategy.id, root.id, "50000000-0000-4000-8000-000000000061", 1);

    const graph = buildReasoningFlowGraph({
      branches: [orphan, root],
      stepDependencies: [],
      steps: [repeatedStep, repeatedStep],
      strategies: [strategy],
    });
    const stepIds = graph.nodes.filter((node) => node.data.kind === "step").map((node) => node.id);
    const orphanNode = findBranchStartNode(graph.nodes, orphan.id);

    expect(stepIds).toEqual([stepNodeId(repeatedStep.id)]);
    expect(orphanNode.data).toMatchObject({ forkStep: null, origin: "strategy" });
    expect(graph.nodes.filter((node) => node.type === "fork-junction")).toHaveLength(0);
    expect(graph.structuralEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: { kind: "strategy-root" },
        source: strategyNodeId(strategy.id),
        target: branchNodeId(orphan.id),
      }),
    ]));
  });

  it("keeps dependencies directed, handle-scoped, and outside vertical lineage layout", () => {
    const strategy = makeStrategy("30000000-0000-4000-8000-000000000071");
    const branch = makeBranch(strategy.id, "40000000-0000-4000-8000-000000000071");
    const source = makeStep(strategy.id, branch.id, "50000000-0000-4000-8000-000000000071", 1);
    const target = makeStep(strategy.id, branch.id, "50000000-0000-4000-8000-000000000072", 2);
    const activeDependency = makeDependency("60000000-0000-4000-8000-000000000071", source.id, target.id);
    const removedDependency = makeDependency("60000000-0000-4000-8000-000000000072", target.id, source.id, {
      status: "removed",
    });

    const graph = buildReasoningFlowGraph({
      branches: [branch],
      stepDependencies: [removedDependency, activeDependency],
      steps: [source, target],
      strategies: [strategy],
    });
    const [edge] = graph.dependencyEdges;
    if (!edge) throw new Error("Expected active dependency edge.");

    expect(graph.dependencyEdges).toHaveLength(1);
    expect(edge).toMatchObject({
      className: "lemma-flow-edge lemma-flow-edge--dependency",
      data: { dependency: activeDependency, kind: "dependency" },
      label: "Uses result",
      source: stepNodeId(source.id),
      sourceHandle: "dependency-source",
      target: stepNodeId(target.id),
      targetHandle: "dependency-target",
    });
    expect(edge.style?.strokeDasharray).toBe("6 5");

    const dependencyOnlyLayout = layoutReasoningFlowGraph(
      [findStepNode(graph.nodes, source.id), findStepNode(graph.nodes, target.id)],
      graph.dependencyEdges,
    );
    expect(findStepNode(dependencyOnlyLayout, source.id).position.y).toBe(
      findStepNode(dependencyOnlyLayout, target.id).position.y,
    );
  });

  it("lays structural lineage from top to bottom", () => {
    const strategy = makeStrategy("30000000-0000-4000-8000-000000000081");
    const branch = makeBranch(strategy.id, "40000000-0000-4000-8000-000000000081");
    const first = makeStep(strategy.id, branch.id, "50000000-0000-4000-8000-000000000081", 1);
    const second = makeStep(strategy.id, branch.id, "50000000-0000-4000-8000-000000000082", 2);

    const graph = buildReasoningFlowGraph({
      branches: [branch],
      stepDependencies: [],
      steps: [second, first],
      strategies: [strategy],
    });
    const strategyNode = graph.nodes.find((node) => node.id === strategyNodeId(strategy.id));
    if (!strategyNode) throw new Error("Expected strategy node.");
    const branchNode = findBranchStartNode(graph.nodes, branch.id);

    expect(strategyNode.position.y).toBeLessThan(branchNode.position.y);
    expect(branchNode.position.y).toBeLessThan(findStepNode(graph.nodes, first.id).position.y);
    expect(findStepNode(graph.nodes, first.id).position.y).toBeLessThan(
      findStepNode(graph.nodes, second.id).position.y,
    );
    expect(findStepNode(graph.nodes, second.id).position.y).toBeLessThan(
      findCreationNode(graph.nodes, branch.id).position.y,
    );
  });

  it("rejects duplicate and cyclic dependency connections before persistence", () => {
    const first = "50000000-0000-4000-8000-000000000091";
    const second = "50000000-0000-4000-8000-000000000092";
    const third = "50000000-0000-4000-8000-000000000093";
    const dependencies = [
      makeDependency("60000000-0000-4000-8000-000000000091", first, second),
      makeDependency("60000000-0000-4000-8000-000000000092", second, third),
    ];

    expect(isValidStepDependencyConnection(dependencies, first, second)).toBe(false);
    expect(isValidStepDependencyConnection(dependencies, third, first)).toBe(false);
    expect(isValidStepDependencyConnection(dependencies, first, first)).toBe(false);
    expect(isValidStepDependencyConnection(dependencies, first, third)).toBe(true);
  });
});
