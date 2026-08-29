import type { Branch, Step, StepDependency, Strategy } from "@lemma/contracts";
import { ReactFlowProvider, type Connection } from "@xyflow/react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stepNodeId, strategyNodeId, type ReasoningFlowNode } from "../lib/reasoningFlowGraph";
import { useReasoningFlow } from "./useReasoningFlow";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const STRATEGY_ID = "30000000-0000-4000-8000-000000000001";
const BRANCH_ID = "40000000-0000-4000-8000-000000000001";
const FIRST_STEP_ID = "50000000-0000-4000-8000-000000000001";
const SECOND_STEP_ID = "50000000-0000-4000-8000-000000000002";
const THIRD_STEP_ID = "50000000-0000-4000-8000-000000000003";
const TIMESTAMP = "2026-08-31T10:00:00.000Z";

const strategy: Strategy = {
  author_agent_name: null,
  author_type: "human",
  author_user_id: USER_ID,
  created_at: TIMESTAMP,
  description_markdown: "Use the invariant.",
  id: STRATEGY_ID,
  objective_id: "25000000-0000-4000-8000-000000000001",
  revision: 1,
  status: "active",
  title: "Invariant route",
  updated_at: TIMESTAMP,
  workspace_id: WORKSPACE_ID,
};

const branch: Branch = {
  author_agent_name: null,
  author_type: "human",
  author_user_id: USER_ID,
  created_at: TIMESTAMP,
  forked_from_step_id: null,
  id: BRANCH_ID,
  name: "Main line",
  parent_branch_id: null,
  revision: 1,
  status: "active",
  strategy_id: STRATEGY_ID,
  updated_at: TIMESTAMP,
  workspace_id: WORKSPACE_ID,
};

function makeStep(id: string, ordinal: number): Step {
  return {
    author_agent_name: "Lemma Agent",
    author_type: "agent",
    author_user_id: null,
    body_markdown: `Step ${ordinal} establishes $x_${ordinal}$.`,
    branch_id: BRANCH_ID,
    concepts: [],
    created_at: TIMESTAMP,
    id,
    ordinal,
    revision: 1,
    status: "active",
    strategy_id: STRATEGY_ID,
    summary: null,
    supersedes_step_id: null,
    theorem_tags: [],
    title: `Step ${ordinal}`,
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
  };
}

const steps = [
  makeStep(FIRST_STEP_ID, 1),
  makeStep(SECOND_STEP_ID, 2),
  makeStep(THIRD_STEP_ID, 3),
];

function makeDependency(
  id: string,
  sourceStepId: string,
  targetStepId: string,
): StepDependency {
  return {
    author_agent_name: "Lemma Agent",
    author_type: "agent",
    author_user_id: null,
    created_at: TIMESTAMP,
    depends_on_step_id: sourceStepId,
    id,
    rationale_markdown: "The prerequisite is required.",
    relation_kind: "uses_result",
    revision: 1,
    status: "active",
    step_id: targetStepId,
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
  };
}

function flowProvider({ children }: PropsWithChildren) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

function connection(source: string, target: string): Connection {
  return {
    source,
    sourceHandle: null,
    target,
    targetHandle: null,
  };
}

function findStepNode(nodes: ReasoningFlowNode[], stepId: string): ReasoningFlowNode {
  const node = nodes.find((candidate) => candidate.id === stepNodeId(stepId));
  if (!node) throw new Error(`Missing flow node for step ${stepId}`);
  return node;
}

function renderReasoningFlow(overrides: Partial<Parameters<typeof useReasoningFlow>[0]> = {}) {
  const callbacks = {
    onConnectSteps: vi.fn(),
    onSelectBranch: vi.fn(),
    onSelectStep: vi.fn(),
    onSelectStrategy: vi.fn(),
  };
  const options = {
    branches: [branch],
    selectedBranchId: null,
    selectedStepId: null,
    selectedStrategyId: null,
    stepDependencies: [],
    steps,
    strategies: [strategy],
    ...callbacks,
    ...overrides,
  };

  const hook = renderHook((props: typeof options) => useReasoningFlow(props), {
    initialProps: options,
    wrapper: flowProvider,
  });

  return { ...callbacks, ...hook };
}

beforeEach(() => {
  let frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    frameId += 1;
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useReasoningFlow", () => {
  it("sends a valid source-to-target connection to the persisted graph action", () => {
    const { onConnectSteps, result } = renderReasoningFlow();
    const validConnection = connection(stepNodeId(FIRST_STEP_ID), stepNodeId(THIRD_STEP_ID));

    expect(result.current.isValidConnection(validConnection)).toBe(true);

    act(() => {
      result.current.onConnect(validConnection);
    });

    expect(onConnectSteps).toHaveBeenCalledTimes(1);
    expect(onConnectSteps).toHaveBeenCalledWith(FIRST_STEP_ID, THIRD_STEP_ID);
  });

  it("rejects self, non-step, duplicate, and cyclic connections before persistence", () => {
    const dependencies = [
      makeDependency("60000000-0000-4000-8000-000000000001", FIRST_STEP_ID, SECOND_STEP_ID),
      makeDependency("60000000-0000-4000-8000-000000000002", SECOND_STEP_ID, THIRD_STEP_ID),
    ];
    const { onConnectSteps, result } = renderReasoningFlow({ stepDependencies: dependencies });
    const selfConnection = connection(stepNodeId(FIRST_STEP_ID), stepNodeId(FIRST_STEP_ID));
    const nonStepConnection = connection(strategyNodeId(STRATEGY_ID), stepNodeId(SECOND_STEP_ID));
    const duplicateConnection = connection(stepNodeId(FIRST_STEP_ID), stepNodeId(SECOND_STEP_ID));
    const cycleConnection = connection(stepNodeId(THIRD_STEP_ID), stepNodeId(FIRST_STEP_ID));

    expect(result.current.isValidConnection(selfConnection)).toBe(false);
    expect(result.current.isValidConnection(nonStepConnection)).toBe(false);
    expect(result.current.isValidConnection(duplicateConnection)).toBe(false);
    expect(result.current.isValidConnection(cycleConnection)).toBe(false);

    act(() => {
      result.current.onConnect(selfConnection);
      result.current.onConnect(nonStepConnection);
      result.current.onConnect(duplicateConnection);
      result.current.onConnect(cycleConnection);
    });

    expect(onConnectSteps).not.toHaveBeenCalled();
  });

  it("clears the active step from a pane click without selecting another graph element", () => {
    const { onSelectStep, result } = renderReasoningFlow({ selectedStepId: SECOND_STEP_ID });

    act(() => {
      result.current.onPaneClick();
    });

    expect(onSelectStep).toHaveBeenCalledWith(null);
  });

  it("opens an already-selected strategy only from an explicit node click", () => {
    const { onSelectStrategy, result } = renderReasoningFlow({ selectedStrategyId: STRATEGY_ID });
    const strategyNode = result.current.nodes.find((node) => node.id === strategyNodeId(STRATEGY_ID));
    if (!strategyNode) throw new Error("Missing strategy node");

    act(() => {
      result.current.onSelectionChange({ edges: [], nodes: [strategyNode] });
    });
    expect(onSelectStrategy).not.toHaveBeenCalled();

    act(() => {
      result.current.onNodeClick(
        { target: document.createElement("article") } as never,
        strategyNode,
      );
    });

    expect(onSelectStrategy).toHaveBeenCalledWith(STRATEGY_ID);
  });

  it("preserves a manually dragged node position when graph data refreshes", async () => {
    const flow = renderReasoningFlow();
    const draggedPosition = { x: 321, y: 654 };

    act(() => {
      flow.result.current.onNodesChange([{
        dragging: false,
        id: stepNodeId(FIRST_STEP_ID),
        position: draggedPosition,
        type: "position",
      }]);
    });

    const refreshedSteps = steps.map((currentStep) => (
      currentStep.id === THIRD_STEP_ID
        ? { ...currentStep, revision: currentStep.revision + 1, title: "Step 3 refreshed" }
        : currentStep
    ));
    flow.rerender({
      branches: [branch],
      onConnectSteps: flow.onConnectSteps,
      onSelectBranch: flow.onSelectBranch,
      onSelectStep: flow.onSelectStep,
      onSelectStrategy: flow.onSelectStrategy,
      selectedBranchId: null,
      selectedStepId: null,
      selectedStrategyId: null,
      stepDependencies: [],
      steps: refreshedSteps,
      strategies: [strategy],
    });

    await waitFor(() => {
      expect(findStepNode(flow.result.current.nodes, FIRST_STEP_ID).position).toEqual(draggedPosition);
    });
  });

  it("reflects externally selected steps and reports a React Flow selection back to the workspace", async () => {
    const { onSelectStep, rerender, result } = renderReasoningFlow();
    const firstNode = findStepNode(result.current.nodes, FIRST_STEP_ID);

    act(() => {
      result.current.onSelectionChange({ edges: [], nodes: [firstNode] });
    });

    expect(onSelectStep).toHaveBeenCalledWith(FIRST_STEP_ID);

    rerender({
      branches: [branch],
      onConnectSteps: vi.fn(),
      onSelectBranch: vi.fn(),
      onSelectStep,
      onSelectStrategy: vi.fn(),
      selectedBranchId: null,
      selectedStepId: THIRD_STEP_ID,
      selectedStrategyId: null,
      stepDependencies: [],
      steps,
      strategies: [strategy],
    });

    await waitFor(() => {
      expect(findStepNode(result.current.nodes, FIRST_STEP_ID).selected).toBe(false);
      expect(findStepNode(result.current.nodes, THIRD_STEP_ID).selected).toBe(true);
    });
  });
});
