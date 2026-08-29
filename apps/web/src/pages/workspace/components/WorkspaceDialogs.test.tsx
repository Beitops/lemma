import type { Branch, ContextItem, Strategy } from "@lemma/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CompareDialog,
  ContextDialog,
  ContextItemDialog,
  ResultDialog,
  StepDialog,
} from "./WorkspaceDialogs";

const TIMESTAMP = "2026-08-31T10:00:00.000Z";
const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const OBJECTIVE_ID = "20000000-0000-4000-8000-000000000001";
const STRATEGY_ID = "30000000-0000-4000-8000-000000000001";
const BRANCH_ID = "40000000-0000-4000-8000-000000000001";
const USER_ID = "50000000-0000-4000-8000-000000000001";

const branch: Branch = {
  author_agent_name: null,
  author_type: "human",
  author_user_id: USER_ID,
  created_at: TIMESTAMP,
  forked_from_step_id: null,
  id: BRANCH_ID,
  name: "Root $x^2$ route",
  parent_branch_id: null,
  revision: 1,
  status: "active",
  strategy_id: STRATEGY_ID,
  updated_at: TIMESTAMP,
  workspace_id: WORKSPACE_ID,
};

const strategy: Strategy = {
  author_agent_name: null,
  author_type: "human",
  author_user_id: USER_ID,
  created_at: TIMESTAMP,
  description_markdown: "Use the equation $x^2 + y^2 = z^2$.",
  id: STRATEGY_ID,
  objective_id: OBJECTIVE_ID,
  revision: 1,
  status: "active",
  title: "Invariant $x^2$ strategy",
  updated_at: TIMESTAMP,
  workspace_id: WORKSPACE_ID,
};

const contextItem: ContextItem = {
  author_agent_name: null,
  author_type: "human",
  author_user_id: USER_ID,
  body_markdown: "The title has $x^2$.",
  created_at: TIMESTAMP,
  id: "60000000-0000-4000-8000-000000000001",
  kind: "text",
  metadata: {},
  mime_type: null,
  objective_id: OBJECTIVE_ID,
  processing_status: "ready",
  revision: 1,
  size_bytes: null,
  source_url: null,
  storage_bucket: null,
  storage_path: null,
  title: "Definition of $x^2$",
  updated_at: TIMESTAMP,
  workspace_id: WORKSPACE_ID,
};

afterEach(() => {
  cleanup();
});

describe("WorkspaceDialogs workspace component", () => {
  it("renders mathematical dynamic text with KaTeX", () => {
    const step = render(
      <StepDialog
        branchName={branch.name}
        busy={false}
        draft={{ body_markdown: "", concepts: "", status: "active", summary: "", theorem_tags: "", title: "" }}
        editing={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        open
      />,
    );
    expect(step.container.querySelector("#modal-description .katex")).not.toBeNull();
    cleanup();

    const context = render(
      <ContextDialog
        busy={false}
        draft={{ body_markdown: "", file: null, mode: "text", objective_id: OBJECTIVE_ID, objective_title: "Prove $x^2$", scope: "objective", source_url: "", title: "" }}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        open
      />,
    );
    expect(context.container.querySelector(".context-scope-picker .katex")).not.toBeNull();
    cleanup();

    const item = render(
      <ContextItemDialog
        item={contextItem}
        onClose={vi.fn()}
        onDownload={vi.fn()}
        onOpenLink={vi.fn()}
        open
      />,
    );
    expect(item.container.querySelector("h2 .katex")).not.toBeNull();
  });

  it("uses readable plain text for native branch and strategy options", () => {
    render(
      <CompareDialog
        branches={[branch]}
        busy={false}
        comparison={null}
        onBranchAChange={vi.fn()}
        onBranchBChange={vi.fn()}
        onClose={vi.fn()}
        onCompare={vi.fn()}
        open
        selectedA=""
        selectedB=""
      />,
    );

    const branchSelect = screen.getByRole("combobox", { name: "Branch A" });
    expect(branchSelect).toHaveTextContent("Root x^2 route");
    expect(branchSelect).not.toHaveTextContent("$");
    cleanup();

    render(
      <ResultDialog
        branches={[branch]}
        busy={false}
        draft={{ outcome_status: "inconclusive", result_markdown: "", target_id: STRATEGY_ID, target_type: "strategy" }}
        existingResult={null}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        open
        strategies={[strategy]}
      />,
    );

    const strategySelect = screen.getByRole("combobox", { name: "Strategy" });
    expect(strategySelect).toHaveTextContent("Invariant x^2 strategy");
    expect(strategySelect).not.toHaveTextContent("$");
  });
});
