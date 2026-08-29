import type { ReactNode } from "react";
import { useEffect } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import {
  DASHBOARD_PATH,
  OBJECTIVE_ROUTE_PATH,
  WORKSPACE_ROUTE_PATH,
} from "./useAppNavigation";

interface AppRoutesProps {
  dashboard: ReactNode;
  workspace: ReactNode;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === "POP") return;
    window.scrollTo({ top: 0 });
  }, [navigationType, pathname]);

  return null;
}

export function AppRoutes({ dashboard, workspace }: AppRoutesProps) {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={dashboard} path={DASHBOARD_PATH} />
        <Route element={workspace} path={WORKSPACE_ROUTE_PATH} />
        <Route element={workspace} path={OBJECTIVE_ROUTE_PATH} />
        <Route element={<Navigate replace to={DASHBOARD_PATH} />} path="*" />
      </Routes>
    </>
  );
}
