import type { Branch, Step, Strategy } from "@lemma/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReasoningCanvas } from "./ReasoningCanvas";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const TIMESTAMP = "2026-08-31T10:00:00.000Z";

function makeStrategy(overrides: Partial<Strategy> = {}): Strategy {
  return {
    author_agent_name: null,
    author_type: "human",
    author_user_id: USER_ID,
    created_at: TIMESTAMP,
    description_markdown: "A deliberate proof route.",
    id: "30000000-0000-4000-8000-000000000001",
    objective_id: "25000000-0000-4000-8000-000000000001",
    revision: 1,
    status: "active",
    title: "Direct construction",
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
    ...overrides,
  };
}

function makeBranch(
  strategyId: string,
  overrides: Partial<Branch> = {},
): Branch {
  return {
    author_agent_name: null,
    author_type: "human",
    author_user_id: USER_ID,
    created_at: TIMESTAMP,
    forked_from_step_id: null,
    id: "40000000-0000-4000-8000-000000000001",
    name: "Main line",
    parent_branch_id: null,
    revision: 1,
    status: "active",
    strategy_id: strategyId,
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
    ...overrides,
  };
}

function makeStep(
  strategyId: string,
  branchId: string,
  overrides: Partial<Step> = {},
): Step {
  return {
    author_agent_name: "Lemma Agent",
    author_type: "agent",
    author_user_id: null,
    body_markdown: "Let $x^2 = 1$.",
    branch_id: branchId,
    concepts: [],
    created_at: TIMESTAMP,
    id: "50000000-0000-4000-8000-000000000001",
    ordinal: 1,
    revision: 1,
    status: "active",
    strategy_id: strategyId,
    summary: null,
    supersedes_step_id: null,
    theorem_tags: [],
    title: "Establish the base case",
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
    ...overrides,
  };
}

function renderCanvas({
  branches,
  steps,
  strategies,
}: {
  branches: Branch[];
  steps: Step[];
  strategies: Strategy[];
}) {
  return render(
    <ReasoningCanvas
      branches={branches}
      onAddStep={vi.fn()}
      onBranchFromStep={vi.fn()}
      onEditStep={vi.fn()}
      onSelectBranch={vi.fn()}
      onSelectStep={vi.fn()}
      selectedBranchId={null}
      selectedStepId={null}
      steps={steps}
      strategies={strategies}
    />,
  );
}

describe("ReasoningCanvas workspace component", () => {
  it("creates a distinctive strategy origin for every visible strategy", () => {
    const primary = makeStrategy();
    const alternative = makeStrategy({
      id: "30000000-0000-4000-8000-000000000002",
      title: "Pigeonhole argument",
    });
    const primaryBranch = makeBranch(primary.id);
    const alternativeBranch = makeBranch(alternative.id, {
      id: "40000000-0000-4000-8000-000000000002",
      name: "Counting line",
    });

    const { container } = renderCanvas({
      branches: [primaryBranch, alternativeBranch],
      steps: [],
      strategies: [primary, alternative],
    });

    expect(container.querySelectorAll("[data-strategy-origin='true']")).toHaveLength(2);
    expect(screen.getByText("Direct construction")).toBeInTheDocument();
    expect(screen.getByText("Pigeonhole argument")).toBeInTheDocument();
  });

  it("orders each branch's steps from top to bottom by ordinal", () => {
    const strategy = makeStrategy();
    const branch = makeBranch(strategy.id);
    const first = makeStep(strategy.id, branch.id, {
      id: "50000000-0000-4000-8000-000000000011",
      ordinal: 1,
      title: "First move",
    });
    const second = makeStep(strategy.id, branch.id, {
      id: "50000000-0000-4000-8000-000000000012",
      ordinal: 2,
      title: "Second move",
    });

    const { container } = renderCanvas({
      branches: [branch],
      steps: [second, first],
      strategies: [strategy],
    });
    const branchSteps = container.querySelector(`.proof-branch[data-branch-id='${branch.id}'] > .proof-branch__steps`);
    const orderedStepIds = [...(branchSteps?.querySelectorAll("[data-proof-step='true']") ?? [])]
      .map((element) => element.getAttribute("data-source-step-id"));

    expect(orderedStepIds).toEqual([first.id, second.id]);
  });

  it("attaches each fork at its exact step without duplicating any branch", () => {
    const strategy = makeStrategy();
    const root = makeBranch(strategy.id);
    const firstRootStep = makeStep(strategy.id, root.id, {
      id: "50000000-0000-4000-8000-000000000021",
      ordinal: 1,
      title: "Shared start",
    });
    const secondRootStep = makeStep(strategy.id, root.id, {
      id: "50000000-0000-4000-8000-000000000022",
      ordinal: 2,
      title: "Original continuation",
    });
    const alternative = makeBranch(strategy.id, {
      forked_from_step_id: firstRootStep.id,
      id: "40000000-0000-4000-8000-000000000021",
      name: "Alternative line",
      parent_branch_id: root.id,
    });
    const alternativeStep = makeStep(strategy.id, alternative.id, {
      id: "50000000-0000-4000-8000-000000000023",
      title: "Alternative continuation",
    });
    const nestedAlternative = makeBranch(strategy.id, {
      forked_from_step_id: alternativeStep.id,
      id: "40000000-0000-4000-8000-000000000022",
      name: "Nested alternative",
      parent_branch_id: alternative.id,
    });
    const nestedStep = makeStep(strategy.id, nestedAlternative.id, {
      id: "50000000-0000-4000-8000-000000000024",
      title: "Nested continuation",
    });

    const { container } = renderCanvas({
      branches: [nestedAlternative, alternative, root],
      steps: [nestedStep, secondRootStep, alternativeStep, firstRootStep],
      strategies: [strategy],
    });
    const rootFork = container.querySelector(`.proof-junction[data-source-step-id='${firstRootStep.id}']`);
    const nestedFork = container.querySelector(`.proof-junction[data-source-step-id='${alternativeStep.id}']`);
    const secondRootStepNode = container.querySelector(`[data-proof-step='true'][data-source-step-id='${secondRootStep.id}']`);

    expect(rootFork?.querySelector(`[data-step-card='true'][data-step-id='${alternativeStep.id}']`)).not.toBeNull();
    expect(nestedFork?.querySelector(`[data-step-card='true'][data-step-id='${nestedStep.id}']`)).not.toBeNull();
    expect(rootFork?.querySelector(`.proof-junction__path--continuation [data-step-card='true'][data-step-id='${secondRootStep.id}']`)).not.toBeNull();
    expect(rootFork?.querySelector(`.proof-junction__path--fork [data-step-card='true'][data-step-id='${alternativeStep.id}']`)).not.toBeNull();
    expect(secondRootStepNode?.querySelector(".proof-junction")).toBeNull();
    expect(container.querySelectorAll(`[data-step-card='true'][data-step-id='${alternativeStep.id}']`)).toHaveLength(1);
    expect(container.querySelectorAll(`[data-step-card='true'][data-step-id='${nestedStep.id}']`)).toHaveLength(1);
    expect(container.querySelectorAll("[data-step-id]")).toHaveLength(4);
  });

  it("renders each step's complete Markdown and KaTeX outside its selection button", () => {
    const strategy = makeStrategy();
    const branch = makeBranch(strategy.id);
    const step = makeStep(strategy.id, branch.id, {
      body_markdown: "The full proof is $x^2 + y^2 = z^2$.",
      title: "Display the actual reasoning",
    });

    const { container } = renderCanvas({
      branches: [branch],
      steps: [step],
      strategies: [strategy],
    });
    const card = container.querySelector(`[data-step-card='true'][data-step-id='${step.id}']`);

    expect(screen.getByText("The full proof is", { exact: false })).toBeInTheDocument();
    expect(card?.querySelector(".step-card__body .katex")).not.toBeNull();
    expect(card?.querySelector("button .markdown")).toBeNull();
  });

  it("renders TeX in compact strategy, branch, step, summary, and tag labels", () => {
    const strategy = makeStrategy({ title: "Strategy for $x^2$" });
    const branch = makeBranch(strategy.id, { name: "Branch $B_1$" });
    const step = makeStep(strategy.id, branch.id, {
      concepts: ["root $x$"],
      summary: "Reduce to $x=1$.",
      theorem_tags: ["Lemma $L_1$"],
      title: "Solve $x^2=1$",
    });

    const { container } = renderCanvas({
      branches: [branch],
      steps: [step],
      strategies: [strategy],
    });
    const card = container.querySelector(`[data-step-card='true'][data-step-id='${step.id}']`);

    expect(container.querySelector("[data-strategy-origin='true'] h4 .katex")).not.toBeNull();
    expect(container.querySelector(".proof-branch__lead b .katex")).not.toBeNull();
    expect(card?.querySelector("h4 .katex")).not.toBeNull();
    expect(card?.querySelector(".step-card__summary .katex")).not.toBeNull();
    expect(card?.querySelectorAll(".step-card__tags .katex")).toHaveLength(2);
  });

  it("renders a selected single strategy title in the canvas heading through MathText", () => {
    const strategy = makeStrategy({ title: "Strategy heading $x^2 + y^2$" });
    const branch = makeBranch(strategy.id);

    const { container } = renderCanvas({
      branches: [branch],
      steps: [],
      strategies: [strategy],
    });

    expect(container.querySelector(".canvas-header h2 .katex")).not.toBeNull();
  });

  it("renders strategy copy with the same card hierarchy as a reasoning step", () => {
    const strategy = makeStrategy({
      description_markdown: "First note.\n\nSecond note with $x^2 + y^2$.\n\nThird note.",
    });
    const branch = makeBranch(strategy.id);

    const { container } = renderCanvas({
      branches: [branch],
      steps: [],
      strategies: [strategy],
    });
    const strategyCard = container.querySelector("[data-strategy-origin='true']");
    const description = strategyCard?.querySelector(".strategy-origin__description");

    expect(strategyCard).toHaveClass("step-card");
    expect(strategyCard?.querySelector(".step-card__header .step-card__topline")).not.toBeNull();
    expect(strategyCard?.querySelector(".strategy-origin__marker")).toHaveTextContent("Strategy");
    expect(strategyCard?.querySelector("h4")).toHaveTextContent(strategy.title);
    expect(description).toHaveClass("step-card__body");
    expect(description).toHaveTextContent("First note.");
    expect(description).toHaveTextContent("Third note.");
    expect(description?.querySelector(".katex")).not.toBeNull();
    expect(description?.querySelector(".markdown--compact")).toBeNull();
    expect(strategyCard?.querySelector(".step-card__footer")).toHaveTextContent("You");
    expect(strategyCard?.querySelector(".strategy-origin__copy")).toBeNull();
  });

  it("keeps editing and branching as separate step-card actions", () => {
    const strategy = makeStrategy();
    const branch = makeBranch(strategy.id);
    const step = makeStep(strategy.id, branch.id);
    const onBranchFromStep = vi.fn();
    const onEditStep = vi.fn();
    const onSelectStep = vi.fn();

    render(
      <ReasoningCanvas
        branches={[branch]}
        onAddStep={vi.fn()}
        onBranchFromStep={onBranchFromStep}
        onEditStep={onEditStep}
        onSelectBranch={vi.fn()}
        onSelectStep={onSelectStep}
        selectedBranchId={null}
        selectedStepId={null}
        steps={[step]}
        strategies={[strategy]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: `Edit ${step.title}` }));

    expect(onEditStep).toHaveBeenCalledWith(step.id);
    expect(onSelectStep).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: `Branch from ${step.title}` }));

    expect(onBranchFromStep).toHaveBeenCalledWith(step.id);
  });

  it("keeps a human checkpoint and dead-end action scoped to its step", () => {
    const strategy = makeStrategy();
    const branch = makeBranch(strategy.id);
    const step = makeStep(strategy.id, branch.id);
    const onMarkDeadEnd = vi.fn();
    const onOpenPendingDecision = vi.fn();
    const onSelectStep = vi.fn();

    render(
      <ReasoningCanvas
        branches={[branch]}
        onAddStep={vi.fn()}
        onBranchFromStep={vi.fn()}
        onEditStep={vi.fn()}
        onMarkDeadEnd={onMarkDeadEnd}
        onOpenPendingDecision={onOpenPendingDecision}
        onSelectBranch={vi.fn()}
        onSelectStep={onSelectStep}
        pendingDecisionCountsByStepId={{ [step.id]: 1 }}
        selectedBranchId={null}
        selectedStepId={null}
        steps={[step]}
        strategies={[strategy]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /review 1 pending human decision/i }));
    expect(onOpenPendingDecision).toHaveBeenCalledWith(step.id);
    expect(onSelectStep).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Mark step as dead end" }));
    expect(onMarkDeadEnd).toHaveBeenCalledWith(step.id);
    expect(onSelectStep).not.toHaveBeenCalled();
  });

  it("selects a strategy from anywhere on its enlarged node and with a keyboard", async () => {
    const strategy = makeStrategy({
      description_markdown: "Use [the source](https://example.com) before continuing.",
      title: "Open strategy $x^2$",
    });
    const onSelectStrategy = vi.fn();
    const user = userEvent.setup();

    const { container } = render(
      <ReasoningCanvas
        branches={[]}
        onAddStep={vi.fn()}
        onBranchFromStep={vi.fn()}
        onEditStep={vi.fn()}
        onSelectBranch={vi.fn()}
        onSelectStep={vi.fn()}
        onSelectStrategy={onSelectStrategy}
        selectedBranchId={null}
        selectedStepId={null}
        selectedStrategyId={null}
        steps={[]}
        strategies={[strategy]}
      />,
    );

    const strategyNode = container.querySelector("[data-strategy-origin='true']") as HTMLElement | null;
    const strategyDescription = strategyNode?.querySelector(".strategy-origin__description") as HTMLElement | null;
    const strategyButton = strategyNode?.querySelector(".strategy-origin__hit-area") as HTMLButtonElement | null;
    expect(strategyNode).not.toBeNull();
    expect(strategyButton).toHaveAccessibleName("Strategy Open strategy x^2. active");
    if (!strategyNode || !strategyDescription || !strategyButton) throw new Error("Expected a selectable strategy node.");

    fireEvent.click(strategyDescription);
    expect(onSelectStrategy).toHaveBeenCalledTimes(1);

    strategyButton.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(onSelectStrategy).toHaveBeenCalledTimes(3);
    expect(onSelectStrategy).toHaveBeenLastCalledWith(strategy.id);

    const sourceLink = screen.getByRole("link", { name: "the source" });
    sourceLink.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(sourceLink);
    expect(onSelectStrategy).toHaveBeenCalledTimes(3);
  });
});
