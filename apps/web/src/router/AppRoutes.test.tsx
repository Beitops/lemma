import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "./AppRoutes";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const OBJECTIVE_ID = "20000000-0000-4000-8000-000000000001";

function renderRoutes(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AppRoutes
        dashboard={<div>Dashboard route</div>}
        workspace={<div>Workspace route</div>}
      />
    </MemoryRouter>,
  );
}

describe("AppRoutes", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders the workspace for an objective deep link", () => {
    renderRoutes(`/workspaces/${WORKSPACE_ID}/objectives/${OBJECTIVE_ID}`);

    expect(screen.getByText("Workspace route")).toBeInTheDocument();
  });

  it("preserves scroll position for history navigation", () => {
    const scrollTo = vi.spyOn(window, "scrollTo");

    renderRoutes(`/workspaces/${WORKSPACE_ID}`);

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("redirects unknown URLs to the dashboard", async () => {
    renderRoutes("/missing");

    expect(await screen.findByText("Dashboard route")).toBeInTheDocument();
  });
});
