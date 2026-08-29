import { useCallback, useMemo } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";

export const DASHBOARD_PATH = "/";
export const WORKSPACE_ROUTE_PATH = "/workspaces/:workspaceId";
export const OBJECTIVE_ROUTE_PATH = "/workspaces/:workspaceId/objectives/:objectiveId";

export function workspacePath(workspaceId: string): string {
  return `/workspaces/${workspaceId}`;
}

export function objectivePath(workspaceId: string, objectiveId: string): string {
  return `${workspacePath(workspaceId)}/objectives/${objectiveId}`;
}

interface AppLocation {
  page: "dashboard" | "workspace";
  objectiveId: string | null;
  workspaceId: string | null;
}

export function matchAppLocation(pathname: string): AppLocation {
  const objectiveMatch = matchPath(OBJECTIVE_ROUTE_PATH, pathname);
  if (objectiveMatch?.params.workspaceId && objectiveMatch.params.objectiveId) {
    return {
      objectiveId: objectiveMatch.params.objectiveId,
      page: "workspace",
      workspaceId: objectiveMatch.params.workspaceId,
    };
  }

  const workspaceMatch = matchPath(WORKSPACE_ROUTE_PATH, pathname);
  if (workspaceMatch?.params.workspaceId) {
    return {
      objectiveId: null,
      page: "workspace",
      workspaceId: workspaceMatch.params.workspaceId,
    };
  }

  return { objectiveId: null, page: "dashboard", workspaceId: null };
}

export interface NavigationController extends AppLocation {
  goHome: () => void;
  openObjective: (workspaceId: string, objectiveId: string) => void;
  openWorkspace: (workspaceId: string) => void;
  replaceObjective: (workspaceId: string, objectiveId: string) => void;
}

export function useAppNavigation(): NavigationController {
  const { pathname } = useLocation();
  const routerNavigate = useNavigate();
  const location = useMemo(() => matchAppLocation(pathname), [pathname]);

  const navigate = useCallback((path: string, replace = false) => {
    void routerNavigate(path, { replace });
  }, [routerNavigate]);

  return useMemo(
    () => ({
      ...location,
      goHome: () => navigate(DASHBOARD_PATH),
      openObjective: (workspaceId: string, objectiveId: string) =>
        navigate(objectivePath(workspaceId, objectiveId)),
      openWorkspace: (workspaceId: string) => navigate(workspacePath(workspaceId)),
      replaceObjective: (workspaceId: string, objectiveId: string) =>
        navigate(objectivePath(workspaceId, objectiveId), true),
    }),
    [location, navigate],
  );
}
