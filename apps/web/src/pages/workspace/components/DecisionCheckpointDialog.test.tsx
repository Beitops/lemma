import type { DecisionInboxItem } from "@lemma/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionCheckpointDialog } from "./DecisionCheckpointDialog";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const OBJECTIVE_ID = "20000000-0000-4000-8000-000000000001";
const STRATEGY_ID = "30000000-0000-4000-8000-000000000001";
const BRANCH_ID = "40000000-0000-4000-8000-000000000001";
const STEP_ID = "50000000-0000-4000-8000-000000000001";
const TIMESTAMP = "2026-09-02T10:00:00.000Z";

const decision: DecisionInboxItem = {
  ancestry: {
    branch_id: BRANCH_ID,
    objective_id: OBJECTIVE_ID,
    step_id: STEP_ID,
    strategy_id: STRATEGY_ID,
  },
  decision: {
    branch_id: null,
    created_at: TIMESTAMP,
    id: "60000000-0000-4000-8000-000000000001",
    kind: "human_decision",
    objective_id: null,
    question_markdown: "Should we continue with $x^2 = 1$?",
    requested_by_agent_name: "Lemma Agent",
    requested_by_type: "agent",
    requested_by_user_id: null,
    resolution_markdown: null,
    resolution_outcome: null,
    resolved_at: null,
    resolved_by_user_id: null,
    revision: 1,
    status: "pending",
    step_id: STEP_ID,
    strategy_id: null,
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
  },
};

function renderDialog(overrides: Partial<Parameters<typeof DecisionCheckpointDialog>[0]> = {}) {
  const props = {
    busy: false,
    decision,
    onClose: vi.fn(),
    onOutcomeChange: vi.fn(),
    onResolutionMarkdownChange: vi.fn(),
    onResolve: vi.fn(),
    open: true,
    outcome: "accepted" as const,
    resolutionMarkdown: "",
    target: {
      branchName: "Main $B$",
      objectiveTitle: "Prove $x^2$",
      stepTitle: "Base case $x=1$",
      strategyTitle: "Direct route",
    },
    ...overrides,
  };
  return { ...render(<DecisionCheckpointDialog {...props} />), props };
}

afterEach(() => cleanup());

describe("DecisionCheckpointDialog", () => {
  it("renders an accessible, math-aware checkpoint without resuming the agent", async () => {
    const user = userEvent.setup();
    const { props, container } = renderDialog();

    expect(screen.getByRole("dialog", { name: "Your call" })).toBeInTheDocument();
    expect(screen.getByText(/does not automatically resume the agent\./)).toBeInTheDocument();
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(3);

    await user.click(screen.getByRole("button", { name: "Close without resolving" }));
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onResolve).not.toHaveBeenCalled();
  });

  it("requires guidance before a redirection can be saved", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderDialog({ outcome: "redirected" });

    expect(screen.getByRole("textbox")).toBeRequired();
    expect(screen.getByRole("button", { name: "Save redirection" })).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: /continue as proposed/i }));
    expect(props.onOutcomeChange).toHaveBeenCalledWith("accepted");

    rerender(
      <DecisionCheckpointDialog
        {...props}
        outcome="redirected"
        resolutionMarkdown="Try the symmetry argument instead."
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save redirection" }));
    expect(props.onResolve).toHaveBeenCalledOnce();
  });
});
