import type {
  ContextItem,
  ObjectiveSummary,
  Strategy,
  Workspace,
} from "@lemma/contracts";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSidebar, type WorkspaceSidebarProps } from "./WorkspaceSidebar";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const OBJECTIVE_A_ID = "33333333-3333-4333-8333-333333333333";
const OBJECTIVE_B_ID = "44444444-4444-4444-8444-444444444444";
const STRATEGY_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const TIMESTAMP = "2026-08-31T00:00:00.000Z";

const workspace: Workspace = {
  created_at: TIMESTAMP,
  id: WORKSPACE_ID,
  owner_id: USER_ID,
  revision: 1,
  status: "active",
  title: "Multi-objective workspace",
  updated_at: TIMESTAMP,
};

function objective(id: string, title: string): ObjectiveSummary {
  return {
    author_agent_name: null,
    author_type: "human",
    author_user_id: USER_ID,
    branch_count: 1,
    constraints_markdown: "",
    created_at: TIMESTAMP,
    id,
    objective_markdown: `Prove ${title}.`,
    revision: 1,
    status: "active",
    step_count: 2,
    strategy_count: 1,
    title,
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
  };
}

const strategy: Strategy = {
  author_agent_name: null,
  author_type: "human",
  author_user_id: USER_ID,
  created_at: TIMESTAMP,
  description_markdown: "Use the invariant $x^2$.",
  id: STRATEGY_ID,
  objective_id: OBJECTIVE_A_ID,
  revision: 1,
  status: "active",
  title: "Invariant route $x^2$",
  updated_at: TIMESTAMP,
  workspace_id: WORKSPACE_ID,
};

function context(id: string, title: string, objectiveId: string | null): ContextItem {
  return {
    author_agent_name: null,
    author_type: "human",
    author_user_id: USER_ID,
    body_markdown: null,
    created_at: TIMESTAMP,
    id,
    kind: "text",
    metadata: {},
    mime_type: null,
    objective_id: objectiveId,
    processing_status: "ready",
    revision: 1,
    size_bytes: null,
    source_url: null,
    storage_bucket: null,
    storage_path: null,
    title,
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
  };
}

function renderSidebar(overrides: Partial<WorkspaceSidebarProps> = {}) {
  const props: WorkspaceSidebarProps = {
    activeObjectiveId: OBJECTIVE_A_ID,
    collapsed: false,
    expandedObjectiveIds: [],
    generalContextItems: [],
    loadingObjectiveIds: [],
    objectiveContextItems: [],
    objectiveStrategies: {},
    objectives: [objective(OBJECTIVE_A_ID, "First objective"), objective(OBJECTIVE_B_ID, "Second objective")],
    onAddContext: vi.fn(),
    onAddObjective: vi.fn(),
    onAddStrategy: vi.fn(),
    onEditObjective: vi.fn(),
    onOpenContextItem: vi.fn(),
    onSelectObjective: vi.fn(),
    onSelectStrategy: vi.fn(),
    onToggleCollapsed: vi.fn(),
    onToggleObjective: vi.fn(),
    selectedStrategyId: null,
    workspace,
    ...overrides,
  };
  return { ...render(<WorkspaceSidebar {...props} />), props };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("WorkspaceSidebar workspace component", () => {
  it("keeps expanding an objective separate from selecting its board", async () => {
    const user = userEvent.setup();
    const { props } = renderSidebar();

    await user.click(screen.getByRole("button", { name: "Expand objective First objective" }));
    expect(props.onToggleObjective).toHaveBeenCalledWith(OBJECTIVE_A_ID);
    expect(props.onSelectObjective).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^First objective/ }));
    expect(props.onSelectObjective).toHaveBeenCalledWith(OBJECTIVE_A_ID);
  });

  it("collapses into an accessible rail and restores from that rail", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderSidebar();

    await user.click(screen.getByRole("button", { name: "Hide workspace sidebar" }));
    expect(props.onToggleCollapsed).toHaveBeenCalledOnce();

    rerender(<WorkspaceSidebar {...props} collapsed />);

    const panel = document.querySelector(".workspace-sidebar__panel");
    expect(panel).toHaveAttribute("aria-hidden", "true");
    expect(panel).toHaveAttribute("inert");
    const showSidebar = screen.getByRole("button", { name: "Show workspace sidebar" });
    expect(showSidebar).toBeInTheDocument();
    expect(showSidebar).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Hide workspace sidebar" })).not.toBeInTheDocument();

    await user.click(showSidebar);
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(2);

    rerender(<WorkspaceSidebar {...props} collapsed={false} />);
    expect(screen.getByRole("button", { name: "Hide workspace sidebar" })).toHaveFocus();
  });

  it("adds a strategy to the requested objective without selecting it", async () => {
    const user = userEvent.setup();
    const { props } = renderSidebar({ activeObjectiveId: null });

    await user.click(screen.getByRole("button", { name: "Add strategy to Second objective" }));

    expect(props.onAddStrategy).toHaveBeenCalledWith(OBJECTIVE_B_ID);
    expect(props.onSelectObjective).not.toHaveBeenCalled();
  });

  it("shows strategies under their expanded objective and opens a strategy through its objective", async () => {
    const user = userEvent.setup();
    const { props } = renderSidebar({
      expandedObjectiveIds: [OBJECTIVE_A_ID],
      objectiveStrategies: {
        [OBJECTIVE_A_ID]: { branches: [], strategies: [strategy] },
      },
    });

    const strategyButton = document.querySelector(".strategy-item") as HTMLButtonElement | null;
    expect(strategyButton).not.toBeNull();
    if (!strategyButton) throw new Error("Expected rendered strategy button");
    expect(strategyButton.querySelector(".katex")).not.toBeNull();
    await user.click(strategyButton);
    expect(props.onSelectStrategy).toHaveBeenCalledWith(STRATEGY_ID);
    expect(screen.queryByRole("dialog", { name: /strategy preview/i })).not.toBeInTheDocument();
  });

  it("keeps checkpoint badges separate from objective and strategy selection", async () => {
    const user = userEvent.setup();
    const onOpenPendingDecisionForObjective = vi.fn();
    const onOpenPendingDecisionForStrategy = vi.fn();
    const { props } = renderSidebar({
      expandedObjectiveIds: [OBJECTIVE_A_ID],
      objectivePendingDecisionCounts: { [OBJECTIVE_A_ID]: 2 },
      objectiveStrategies: {
        [OBJECTIVE_A_ID]: { branches: [], strategies: [strategy] },
      },
      onOpenPendingDecisionForObjective,
      onOpenPendingDecisionForStrategy,
      strategyPendingDecisionCounts: { [STRATEGY_ID]: 1 },
    });

    const strategyButton = document.querySelector(".strategy-item") as HTMLButtonElement | null;
    if (!strategyButton) throw new Error("Expected rendered strategy button");
    await user.click(strategyButton);
    expect(props.onSelectStrategy).toHaveBeenCalledWith(STRATEGY_ID);
    expect(onOpenPendingDecisionForStrategy).not.toHaveBeenCalled();

    const checkpointButtons = [...document.querySelectorAll<HTMLButtonElement>(".human-checkpoint-badge")];
    const strategyCheckpoint = checkpointButtons.find((button) => button.textContent?.includes("Your call · 1"));
    const objectiveCheckpoint = checkpointButtons.find((button) => button.textContent?.includes("Your call · 2"));
    if (!strategyCheckpoint || !objectiveCheckpoint) throw new Error("Expected checkpoint badges");

    await user.click(strategyCheckpoint);
    expect(onOpenPendingDecisionForStrategy).toHaveBeenCalledWith(STRATEGY_ID);
    expect(props.onSelectStrategy).toHaveBeenCalledTimes(1);

    await user.click(objectiveCheckpoint);
    expect(onOpenPendingDecisionForObjective).toHaveBeenCalledWith(OBJECTIVE_A_ID);
    expect(props.onSelectObjective).not.toHaveBeenCalled();
  });

  it("opens a complete TeX-rendered preview after a deliberate objective hover", () => {
    vi.useFakeTimers();
    const mathObjective = {
      ...objective(OBJECTIVE_A_ID, "First objective $x^2$"),
      constraints_markdown: "Assume $x > 0$.",
      objective_markdown: "Prove the complete statement $x^2 + y^2 = z^2$.",
    };
    renderSidebar({ objectives: [mathObjective, objective(OBJECTIVE_B_ID, "Second objective")] });
    const objectiveButton = document.querySelector(".objective-tree__select") as HTMLButtonElement | null;
    if (!objectiveButton) throw new Error("Expected rendered objective button");

    fireEvent.mouseEnter(objectiveButton);
    act(() => {
      vi.advanceTimersByTime(450);
    });

    const preview = document.querySelector(".sidebar-preview") as HTMLElement | null;
    if (!preview) throw new Error("Expected rendered sidebar preview");
    expect(preview).toHaveTextContent("Prove the complete statement");
    expect(preview).toHaveTextContent("Constraints");
    expect(preview.querySelector(".katex")).not.toBeNull();
  });

  it("uses a green completion mark rather than completed text in sidebar rows and previews", () => {
    vi.useFakeTimers();
    const completedObjective = { ...objective(OBJECTIVE_A_ID, "First objective"), status: "completed" as const };
    const completedStrategy = { ...strategy, status: "completed" as const };
    renderSidebar({
      expandedObjectiveIds: [OBJECTIVE_A_ID],
      objectiveStrategies: {
        [OBJECTIVE_A_ID]: { branches: [], strategies: [completedStrategy] },
      },
      objectives: [completedObjective],
    });

    const objectiveButton = document.querySelector(".objective-tree__select") as HTMLButtonElement | null;
    const strategyButton = document.querySelector(".strategy-item") as HTMLButtonElement | null;
    if (!objectiveButton || !strategyButton) throw new Error("Expected rendered objective and strategy buttons");

    const objectiveMark = objectiveButton.querySelector(".sidebar-completion-mark");
    const strategyMark = strategyButton.querySelector(".sidebar-completion-mark");
    expect(objectiveMark).toHaveAttribute("aria-label", "Completed");
    expect(objectiveMark).toHaveAttribute("role", "img");
    expect(strategyMark).toHaveAttribute("aria-label", "Completed");
    expect(strategyMark).toHaveAttribute("role", "img");
    expect(screen.queryByText("completed")).not.toBeInTheDocument();

    fireEvent.mouseEnter(objectiveButton);
    act(() => {
      vi.advanceTimersByTime(450);
    });

    const preview = document.querySelector(".sidebar-preview");
    const previewMark = preview?.querySelector(".sidebar-completion-mark");
    expect(previewMark).toHaveAttribute("aria-label", "Completed");
    expect(previewMark).toHaveAttribute("role", "img");
  });

  it("keeps a hover preview open while moving to its panel, but never pins it on click", () => {
    vi.useFakeTimers();
    const { props } = renderSidebar();
    const objectiveButton = screen.getByRole("button", { name: /^First objective/ });

    fireEvent.mouseEnter(objectiveButton);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    const hoverPreview = screen.getByRole("dialog", { name: /objective preview/i });

    fireEvent.mouseLeave(objectiveButton);
    fireEvent.mouseEnter(hoverPreview);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole("dialog", { name: /objective preview/i })).toBeInTheDocument();

    fireEvent.click(objectiveButton);
    expect(props.onSelectObjective).toHaveBeenCalledWith(OBJECTIVE_A_ID);
    fireEvent.mouseLeave(hoverPreview);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole("dialog", { name: /objective preview/i })).not.toBeInTheDocument();
  });

  it("keeps a full-height preview within the viewport gutter when its trigger is low", () => {
    vi.useFakeTimers();
    const originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });

    try {
      renderSidebar();
      const objectiveButton = screen.getByRole("button", { name: /^First objective/ });
      const getBoundingClientRect = vi.spyOn(objectiveButton, "getBoundingClientRect").mockReturnValue({
        bottom: 500,
        height: 20,
        left: 20,
        right: 240,
        toJSON: () => ({}),
        top: 480,
        width: 220,
        x: 20,
        y: 480,
      });

      fireEvent.mouseEnter(objectiveButton);
      act(() => {
        vi.advanceTimersByTime(450);
      });

      const preview = screen.getByRole("dialog", { name: /objective preview/i });
      expect(preview.style.getPropertyValue("--sidebar-preview-top")).toBe("108px");
      getBoundingClientRect.mockRestore();
    } finally {
      if (originalInnerHeight) Object.defineProperty(window, "innerHeight", originalInnerHeight);
    }
  });

  it("dismisses a hover preview when Escape is pressed or the user clicks outside", () => {
    vi.useFakeTimers();
    renderSidebar();
    const objectiveButton = screen.getByRole("button", { name: /^First objective/ });

    fireEvent.mouseEnter(objectiveButton);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(screen.getByRole("dialog", { name: /objective preview/i })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /objective preview/i })).not.toBeInTheDocument();

    fireEvent.mouseLeave(objectiveButton);
    fireEvent.mouseEnter(objectiveButton);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(screen.getByRole("dialog", { name: /objective preview/i })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: /objective preview/i })).not.toBeInTheDocument();
  });

  it("closes an open preview when the sidebar becomes collapsed", () => {
    vi.useFakeTimers();
    const { props, rerender } = renderSidebar();
    const objectiveButton = screen.getByRole("button", { name: /^First objective/ });

    fireEvent.mouseEnter(objectiveButton);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(screen.getByRole("dialog", { name: /objective preview/i })).toBeInTheDocument();

    rerender(<WorkspaceSidebar {...props} collapsed />);
    expect(screen.queryByRole("dialog", { name: /objective preview/i })).not.toBeInTheDocument();
  });

  it("renders general and specific context as separate inherited groups", () => {
    renderSidebar({
      generalContextItems: [context("66666666-6666-4666-8666-666666666666", "Shared definitions", null)],
      objectiveContextItems: [context("77777777-7777-4777-8777-777777777777", "Only first objective", OBJECTIVE_A_ID)],
    });

    const general = screen.getByRole("region", { name: "General workspace context" });
    const specific = screen.getByRole("region", { name: "Selected objective context" });
    expect(general).toHaveTextContent("Shared definitions");
    expect(general).not.toHaveTextContent("Only first objective");
    expect(specific).toHaveTextContent("Only first objective");
    expect(specific).not.toHaveTextContent("Shared definitions");
  });

  it("offers a first-objective CTA for an empty workspace", async () => {
    const user = userEvent.setup();
    const { props } = renderSidebar({ activeObjectiveId: null, objectives: [] });

    await user.click(screen.getByRole("button", { name: /create the first objective/i }));
    expect(props.onAddObjective).toHaveBeenCalledOnce();
  });
});
