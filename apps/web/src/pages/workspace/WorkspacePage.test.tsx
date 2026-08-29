import type {
  Branch,
  Objective,
  ObjectiveGraph,
  ReasoningResult,
  Workspace,
  WorkspaceOverview,
} from "@lemma/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkspacePage,
  type WorkspacePageActions,
  type WorkspacePageState,
} from "./WorkspacePage";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const OBJECTIVE_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_OBJECTIVE_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "40000000-0000-4000-8000-000000000001";
const STRATEGY_ID = "50000000-0000-4000-8000-000000000001";
const BRANCH_ID = "60000000-0000-4000-8000-000000000001";
const STEP_ID = "70000000-0000-4000-8000-000000000001";
const TIMESTAMP = "2026-08-31T10:00:00.000Z";

const workspace: Workspace = {
  created_at: TIMESTAMP,
  id: WORKSPACE_ID,
  owner_id: USER_ID,
  revision: 1,
  status: "active",
  title: "Two objectives",
  updated_at: TIMESTAMP,
};

function objective(id: string, title: string): Objective {
  return {
    author_agent_name: null,
    author_type: "human",
    author_user_id: USER_ID,
    constraints_markdown: "",
    created_at: TIMESTAMP,
    id,
    objective_markdown: `Prove ${title}.`,
    revision: 1,
    status: "active",
    title,
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
  };
}

const activeObjective = objective(OBJECTIVE_ID, "the first result");
const secondObjective = objective(OTHER_OBJECTIVE_ID, "a separate result");

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

const graph: ObjectiveGraph = {
  activity_events: [],
  assumptions: [],
  branches: [branch],
  decisions: [],
  effective_context_items: [],
  general_context_items: [],
  objective: activeObjective,
  objective_context_items: [],
  reasoning_results: [],
  sources: [],
  step_assumptions: [],
  step_dependencies: [],
  step_sources: [],
  steps: [{
    author_agent_name: "Lemma Agent",
    author_type: "agent",
    author_user_id: null,
    body_markdown: "This proof belongs only to the first objective.",
    branch_id: BRANCH_ID,
    concepts: [],
    created_at: TIMESTAMP,
    id: STEP_ID,
    ordinal: 1,
    revision: 1,
    status: "active",
    strategy_id: STRATEGY_ID,
    summary: null,
    supersedes_step_id: null,
    theorem_tags: [],
    title: "First objective step",
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
  }],
  strategies: [{
    author_agent_name: null,
    author_type: "human",
    author_user_id: USER_ID,
    created_at: TIMESTAMP,
    description_markdown: "Only this objective's approach.",
    id: STRATEGY_ID,
    objective_id: OBJECTIVE_ID,
    revision: 1,
    status: "active",
    title: "First objective strategy",
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
  }],
  workspace,
};

const branchResult: ReasoningResult = {
  author_agent_name: "Lemma Agent",
  author_type: "agent",
  author_user_id: null,
  branch_id: BRANCH_ID,
  created_at: TIMESTAMP,
  id: "80000000-0000-4000-8000-000000000001",
  objective_id: OBJECTIVE_ID,
  outcome_status: "successful",
  result_markdown: "The selected branch establishes the claim.",
  revision: 1,
  strategy_id: STRATEGY_ID,
  target_id: BRANCH_ID,
  target_revision: 1,
  target_type: "branch",
  updated_at: TIMESTAMP,
  workspace_id: WORKSPACE_ID,
};

const overview: WorkspaceOverview = {
  general_context_items: [],
  objectives: [
    { ...activeObjective, branch_count: 1, step_count: 1, strategy_count: 1 },
    { ...secondObjective, branch_count: 0, step_count: 0, strategy_count: 0 },
  ],
  workspace,
};

const state: WorkspacePageState = {
  activeDialog: null,
  assumptionDraft: { label: "", note_markdown: "", statement_markdown: "", status: "proposed", usage_kind: "used" },
  branchDraft: { name: "" },
  busy: false,
  cleanSolution: null,
  compareBranchA: "",
  compareBranchB: "",
  comparison: null,
  contextDraft: { body_markdown: "", file: null, mode: "text", objective_id: OBJECTIVE_ID, objective_title: activeObjective.title, scope: "objective", source_url: "", title: "" },
  decisionResolutionMarkdown: "",
  decisionResolutionOutcome: "accepted",
  editingObjectiveId: null,
  editingStepId: null,
  objectiveDraft: { constraints_markdown: "", objective_markdown: "", title: "" },
  refreshing: false,
  resultDraft: { outcome_status: "inconclusive", result_markdown: "", target_id: BRANCH_ID, target_type: "branch" },
  selectedBranchId: BRANCH_ID,
  selectedContextItemId: null,
  selectedDecisionId: null,
  selectedStepId: null,
  selectedStrategyId: STRATEGY_ID,
  stepDraft: { body_markdown: "", concepts: "", status: "active", summary: "", theorem_tags: "", title: "" },
  strategyDraft: { description_markdown: "", root_branch_name: "Main", title: "" },
  targetBranchId: null,
  targetStepId: null,
};

function actionController(): WorkspacePageActions {
  const handlers = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
  return new Proxy({} as WorkspacePageActions, {
    get: (_target, property) => {
      const existing = handlers.get(property);
      if (existing) return existing;
      const handler = vi.fn();
      handlers.set(property, handler);
      return handler;
    },
  });
}

function renderPage(overrides: Partial<ComponentProps<typeof WorkspacePage>> = {}) {
  const actions = overrides.actions ?? actionController();
  return {
    actions,
    ...render(
      <WorkspacePage
        actions={actions}
        expandedObjectiveIds={[OBJECTIVE_ID]}
        graph={graph}
        loadingObjectiveIds={[]}
        objectiveStrategies={{ [OBJECTIVE_ID]: { branches: [branch], strategies: graph.strategies } }}
        overview={overview}
        state={state}
        webMcpAvailable
        {...overrides}
      />,
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkspacePage", () => {
  it("renders only the active objective graph while the sidebar still lists the other objectives", () => {
    renderPage();

    expect(screen.getAllByText("First objective strategy").length).toBeGreaterThan(0);
    expect(screen.getByText("First objective step")).toBeInTheDocument();
    expect(screen.getByText("a separate result")).toBeInTheDocument();
    expect(screen.queryByText("Other objective private step")).not.toBeInTheDocument();
  });

  it("opens an outcome dialog without requiring the selected branch to be completed", async () => {
    const user = userEvent.setup();
    const { actions } = renderPage();

    await user.click(screen.getByRole("button", { name: "Record outcome" }));
    expect(actions.openResult).toHaveBeenCalledWith(BRANCH_ID);
  });

  it("labels an existing outcome from the selected graph target even when the draft is empty", () => {
    renderPage({
      graph: { ...graph, reasoning_results: [branchResult] },
      state: {
        ...state,
        resultDraft: { outcome_status: "inconclusive", result_markdown: "", target_id: "", target_type: "branch" },
      },
    });

    expect(screen.getByRole("button", { name: "Edit outcome" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record outcome" })).not.toBeInTheDocument();
  });

  it("opens a math-aware strategy inspector from any part of the normal strategy node and closes it with Escape", async () => {
    const mathStrategy = {
      ...graph.strategies[0]!,
      description_markdown: "Apply the invariant $x^2+y^2$ without losing branch history.",
      title: "Invariant route $x^2$",
    };
    const { actions, container } = renderPage({
      graph: { ...graph, strategies: [mathStrategy] },
      objectiveStrategies: {
        [OBJECTIVE_ID]: { branches: [branch], strategies: [mathStrategy] },
      },
    });

    const strategyNode = container.querySelector("[data-strategy-origin='true']") as HTMLElement | null;
    const strategyDescription = strategyNode?.querySelector(".strategy-origin__description") as HTMLElement | null;
    if (!strategyNode || !strategyDescription) throw new Error("Expected a selectable strategy node");
    fireEvent.click(strategyDescription);

    expect(actions.selectStrategy).toHaveBeenCalledWith(STRATEGY_ID);
    const inspector = container.querySelector(".strategy-inspector") as HTMLElement | null;
    if (!inspector) throw new Error("Expected the strategy inspector");
    expect(inspector).toHaveTextContent("Approach");
    expect(inspector.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector(".workspace-layout:has(.strategy-inspector)")).not.toBeNull();
    const layout = container.querySelector(".workspace-layout");
    const stage = container.querySelector(".workspace-stage");
    expect(layout && stage ? [...layout.children].indexOf(inspector) > [...layout.children].indexOf(stage) : false).toBe(true);

    fireEvent.click(inspector);
    expect(container.querySelector(".strategy-inspector")).not.toBeNull();

    if (!stage) throw new Error("Expected the workspace stage");
    fireEvent.click(stage);
    expect(container.querySelector(".strategy-inspector")).toBeNull();

    fireEvent.click(strategyDescription);
    expect(container.querySelector(".strategy-inspector")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector(".strategy-inspector")).toBeNull();
  });

  it("closes a step inspector when clicking outside it", () => {
    const { actions, container } = renderPage({
      state: { ...state, selectedStepId: STEP_ID },
    });
    const inspector = container.querySelector("[data-workspace-inspector='true']");
    const stage = container.querySelector(".workspace-stage");
    if (!inspector || !stage) throw new Error("Expected the step inspector and workspace stage");

    fireEvent.click(inspector);
    expect(actions.selectStep).not.toHaveBeenCalled();

    fireEvent.click(stage);
    expect(actions.selectStep).toHaveBeenCalledWith(null);
  });

  it("uses the fullscreen button as the sole board-entry control and omits retired actions", () => {
    const { container } = renderPage();

    expect(screen.getByRole("button", { name: "Enter fullscreen board" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compare" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Steer reasoning" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Steer agent" })).toBeNull();
    expect(screen.queryByText("Select a step to inspect its proof, assumptions, and history")).toBeNull();

    const canvas = container.querySelector("[data-reasoning-canvas='true']") as HTMLElement | null;
    if (!canvas) throw new Error("Expected the normal reasoning canvas");
    fireEvent.click(canvas);
    expect(container.querySelector("[data-workspace-mode='default']")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen board" }));

    expect(container.querySelector("[data-workspace-mode='selection']")).not.toBeNull();
  });

  it("uses sidebar strategy clicks only for navigation", () => {
    const { actions, container } = renderPage();
    const sidebarStrategy = container.querySelector(".workspace-sidebar .strategy-item") as HTMLButtonElement | null;
    if (!sidebarStrategy) throw new Error("Expected a sidebar strategy button");

    fireEvent.click(sidebarStrategy);

    expect(actions.selectStrategy).toHaveBeenCalledWith(STRATEGY_ID);
    expect(document.querySelector(".sidebar-preview")).toBeNull();
    expect(container.querySelector(".strategy-inspector")).toBeNull();
  });

  it("keeps the shell and first-objective CTA visible for an empty workspace", () => {
    const actions = actionController();
    render(
      <WorkspacePage
        actions={actions}
        expandedObjectiveIds={[]}
        graph={null}
        loadingObjectiveIds={[]}
        objectiveStrategies={{}}
        overview={{ ...overview, objectives: [] }}
        state={state}
        webMcpAvailable={false}
      />,
    );

    expect(screen.getByText("This workspace is ready for its first objective")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create first objective" })).toBeInTheDocument();
  });
});
