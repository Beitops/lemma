import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const workspaceHarness = vi.hoisted(() => ({
  controller: {} as Record<string, unknown>,
}));

vi.mock("./hooks/useAuth", () => ({
  useAuth: () => ({
    initialized: true,
    session: { access_token: "test-access-token" },
    signOut: vi.fn(),
    user: { email: "test@example.com" },
  }),
}));

vi.mock("./hooks/useToasts", () => ({
  useToasts: () => ({
    dismiss: vi.fn(),
    messages: [],
    push: vi.fn(),
  }),
}));

vi.mock("./hooks/useWebMcp", () => ({
  useWebMcp: () => false,
}));

vi.mock("./pages/dashboard/useWorkspaces", () => ({
  useWorkspaces: () => ({
    workspaces: [],
  }),
}));

vi.mock("./pages/workspace/hooks/useWorkspace", () => ({
  useWorkspace: () => workspaceHarness.controller,
}));

vi.mock("./pages/workspace/WorkspacePage", () => ({
  WorkspacePage: () => <div>Workspace ready</div>,
}));

vi.mock("./router/AppRoutes", () => ({
  AppRoutes: ({ workspace }: { workspace: React.ReactNode }) => workspace,
}));

vi.mock("./router/useAppNavigation", () => ({
  useAppNavigation: () => ({
    goHome: vi.fn(),
    objectiveId: "20000000-0000-4000-8000-000000000001",
    openObjective: vi.fn(),
    openWorkspace: vi.fn(),
    page: "workspace",
    replaceObjective: vi.fn(),
    workspaceId: "10000000-0000-4000-8000-000000000001",
  }),
}));

function workspaceController(overrides: Record<string, unknown> = {}) {
  return {
    actions: { refresh: vi.fn() },
    error: null,
    highlightExternalMutation: vi.fn(),
    loading: false,
    overview: null,
    refreshFromAgent: vi.fn(),
    ...overrides,
  };
}

describe("workspace route loading state", () => {
  beforeEach(() => {
    workspaceHarness.controller = workspaceController();
  });

  it("does not render a workspace error before the initial request starts", () => {
    const { rerender } = render(<App />);

    expect(screen.getByText("Opening your reasoning workspace…")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "We could not open this reasoning graph." }))
      .not.toBeInTheDocument();

    workspaceHarness.controller = workspaceController({
      overview: { workspace: { id: "10000000-0000-4000-8000-000000000001" } },
    });
    rerender(<App />);

    expect(screen.getByText("Workspace ready")).toBeInTheDocument();
  });

  it("still renders the error screen after an explicit load failure", () => {
    workspaceHarness.controller = workspaceController({
      error: "The workspace request failed.",
    });

    render(<App />);

    expect(screen.getByRole("heading", { name: "We could not open this reasoning graph." }))
      .toBeInTheDocument();
    expect(screen.getByText("The workspace request failed.")).toBeInTheDocument();
  });
});
