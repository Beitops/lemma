import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoardFocusControls } from "./BoardFocusControls";

describe("BoardFocusControls workspace component", () => {
  it("keeps only selection-mode exit and global actions", () => {
    render(
      <BoardFocusControls
        onExit={vi.fn()}
        onOpenCleanSolution={vi.fn()}
        onOpenResult={vi.fn()}
        onRefresh={vi.fn()}
        refreshing={false}
        selectedBranch={null}
        selectedResult={null}
        webMcpAvailable
      />,
    );

    expect(screen.getByRole("button", { name: "Exit full screen" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Full screen board actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clean solution" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compare" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Steer reasoning" })).toBeNull();
    expect(screen.queryByLabelText("Selected objective")).toBeNull();
    expect(screen.queryByLabelText("Objective strategies")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add strategy" })).toBeNull();
    expect(screen.queryByText("Add context")).toBeNull();
  });
});
