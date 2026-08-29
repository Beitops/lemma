import type { WorkspaceSummary } from "@lemma/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage";

const summary: WorkspaceSummary = {
  active_objective_count: 1,
  objective_count: 2,
  workspace: {
    created_at: "2026-08-31T00:00:00.000Z",
    id: "11111111-1111-4111-8111-111111111111",
    owner_id: "22222222-2222-4222-8222-222222222222",
    revision: 1,
    status: "active",
    title: "Pythagorean triples $x^2+y^2=z^2$",
    updated_at: "2026-08-31T00:00:00.000Z",
  },
};

function WorkspaceCreationHarness() {
  const [createOpen, setCreateOpen] = useState(true);
  const [draft, setDraft] = useState({ title: "" });

  return (
    <DashboardPage
      busy={false}
      createOpen={createOpen}
      draft={draft}
      email="mathematician@example.com"
      loading={false}
      onCreate={() => undefined}
      onCreateOpenChange={setCreateOpen}
      onDraftChange={(_field, value) => setDraft({ title: value })}
      onOpenWorkspace={() => undefined}
      onSearchChange={() => undefined}
      onSignOut={() => undefined}
      search=""
      webMcpAvailable={false}
      workspaces={[]}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe("DashboardPage", () => {
  it("renders a workspace summary instead of a workspace-level objective", () => {
    render(
      <DashboardPage
        busy={false}
        createOpen={false}
        draft={{ title: "" }}
        email="mathematician@example.com"
        loading={false}
        onCreate={vi.fn()}
        onCreateOpenChange={vi.fn()}
        onDraftChange={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onSearchChange={vi.fn()}
        onSignOut={vi.fn()}
        search=""
        webMcpAvailable
        workspaces={[summary]}
      />,
    );

    const workspaceCard = screen.getByRole("button", { name: /open workspace pythagorean triples/i });
    expect(workspaceCard).toHaveAccessibleName("Open workspace Pythagorean triples x^2+y^2=z^2");
    expect(workspaceCard).toHaveTextContent("2 objectives");
    expect(workspaceCard).toHaveTextContent("1 active");
    expect(workspaceCard.querySelector("h3 .katex")).not.toBeNull();
    expect(workspaceCard.querySelector("a")).toBeNull();
    expect(screen.queryByText("Built for interruption")).not.toBeInTheDocument();
  });

  it("creates an empty workspace without asking for an objective or strategy", () => {
    const onCreateOpenChange = vi.fn();
    render(
      <DashboardPage
        busy={false}
        createOpen
        draft={{ title: "" }}
        email="mathematician@example.com"
        loading={false}
        onCreate={vi.fn()}
        onCreateOpenChange={onCreateOpenChange}
        onDraftChange={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onSearchChange={vi.fn()}
        onSignOut={vi.fn()}
        search=""
        webMcpAvailable={false}
        workspaces={[]}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Create a reasoning workspace" });
    expect(dialog).toHaveTextContent("add objectives, context, and strategies from inside it");
    expect(within(dialog).getAllByRole("textbox")).toHaveLength(1);
    expect(within(dialog).getByRole("textbox", { name: /^Workspace name/ })).toBeInTheDocument();
  });

  it("keeps the workspace name field focused during continuous typing", async () => {
    const user = userEvent.setup();
    render(<WorkspaceCreationHarness />);

    const name = screen.getByRole("textbox", { name: /^Workspace name/ });
    await user.click(name);
    await user.type(name, "Analysis of $x^2 + y^2$");

    expect(name).toHaveValue("Analysis of $x^2 + y^2$");
    expect(name).toHaveFocus();
    expect(screen.getByRole("button", { name: "Close dialog" })).not.toHaveFocus();
  });
});
