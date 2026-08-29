import type { Strategy } from "@lemma/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrategyInspector } from "./StrategyInspector";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const TIMESTAMP = "2026-08-31T10:00:00.000Z";

function makeStrategy(overrides: Partial<Strategy> = {}): Strategy {
  return {
    author_agent_name: "Lemma Agent",
    author_type: "agent",
    author_user_id: null,
    created_at: TIMESTAMP,
    description_markdown: "Use the invariant $x^2 + y^2 = z^2$ before splitting the cases.",
    id: "30000000-0000-4000-8000-000000000001",
    objective_id: "25000000-0000-4000-8000-000000000001",
    revision: 3,
    status: "active",
    title: "Invariant route for $x^2$",
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
    ...overrides,
  };
}

afterEach(cleanup);

describe("StrategyInspector workspace component", () => {
  it("renders the complete strategy with Markdown, TeX, status, and provenance", () => {
    const strategy = makeStrategy();
    const { container } = render(
      <StrategyInspector onClose={vi.fn()} strategy={strategy} />,
    );

    const inspector = screen.getByLabelText("Inspect strategy Invariant route for x^2");

    expect(inspector).toHaveAttribute("data-inspector-presentation", "column");
    expect(screen.getByText("Strategy")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("rev 3")).toBeInTheDocument();
    expect(screen.getByText("Lemma Agent")).toBeInTheDocument();
    expect(screen.getByText("Use the invariant", { exact: false })).toBeInTheDocument();
    expect(container.querySelector(".strategy-inspector__header h2 .katex")).not.toBeNull();
    expect(container.querySelector(".strategy-inspector__description .katex")).not.toBeNull();
  });

  it("uses the focus presentation and closes from its close button", () => {
    const onClose = vi.fn();

    const { container } = render(
      <StrategyInspector onClose={onClose} presentation="focus" strategy={makeStrategy()} />,
    );

    expect(container.querySelector(".strategy-inspector--focus")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close strategy inspector" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render without a selected strategy", () => {
    const { container } = render(
      <StrategyInspector onClose={vi.fn()} strategy={null} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
