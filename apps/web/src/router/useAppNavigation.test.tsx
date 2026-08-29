import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { matchAppLocation, useAppNavigation } from "./useAppNavigation";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const OBJECTIVE_ID = "20000000-0000-4000-8000-000000000001";

function routerWrapper(initialEntry: string) {
  return function RouterWrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>;
  };
}

function NavigationProbe() {
  const navigation = useAppNavigation();
  const routerNavigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <>
      <output>{pathname}</output>
      <button
        onClick={() => navigation.replaceObjective(WORKSPACE_ID, OBJECTIVE_ID)}
        type="button"
      >
        Select objective
      </button>
      <button onClick={() => void routerNavigate(-1)} type="button">
        Browser back
      </button>
    </>
  );
}

describe("application navigation", () => {
  it("matches a deep objective URL as workspace state", () => {
    expect(matchAppLocation(`/workspaces/${WORKSPACE_ID}/objectives/${OBJECTIVE_ID}`))
      .toEqual({
        objectiveId: OBJECTIVE_ID,
        page: "workspace",
        workspaceId: WORKSPACE_ID,
      });
  });

  it("treats non-workspace URLs as dashboard state", () => {
    expect(matchAppLocation("/not-a-route")).toEqual({
      objectiveId: null,
      page: "dashboard",
      workspaceId: null,
    });
  });

  it("opens a workspace through React Router", () => {
    const { result } = renderHook(() => useAppNavigation(), {
      wrapper: routerWrapper("/"),
    });

    act(() => result.current.openWorkspace(WORKSPACE_ID));

    expect(result.current).toMatchObject({
      objectiveId: null,
      page: "workspace",
      workspaceId: WORKSPACE_ID,
    });
  });

  it("replaces the history entry when a deterministic objective is selected", async () => {
    render(
      <MemoryRouter
        initialEntries={["/sentinel", `/workspaces/${WORKSPACE_ID}`]}
        initialIndex={1}
      >
        <NavigationProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select objective" }));
    expect(screen.getByText(`/workspaces/${WORKSPACE_ID}/objectives/${OBJECTIVE_ID}`))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Browser back" }));

    await waitFor(() => expect(screen.getByText("/sentinel")).toBeInTheDocument());
  });
});
