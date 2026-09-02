import { ArrowLeft, RefreshCw } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Brand } from "./components/Brand";
import { Button, LoadingScreen, ToastRegion } from "./components/Primitives";
import { useAuth } from "./hooks/useAuth";
import { useToasts } from "./hooks/useToasts";
import { useWebMcp } from "./hooks/useWebMcp";
import { LemmaApi } from "./lib/api";
import { resolveCurrentTabWebMcpAgentName } from "./lib/webmcpAgentName";
import type { WebMcpHighlight } from "./lib/webmcp";
import { AuthPage } from "./pages/auth/AuthPage";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { useWorkspaces } from "./pages/dashboard/useWorkspaces";
import { WorkspacePage } from "./pages/workspace/WorkspacePage";
import {
  type ExternalMutationNotice,
  useWorkspace,
} from "./pages/workspace/hooks/useWorkspace";
import { AppRoutes } from "./router/AppRoutes";
import { useAppNavigation } from "./router/useAppNavigation";

export function mutationNotice(target: WebMcpHighlight): ExternalMutationNotice | undefined {
  const { objectiveId } = target;
  switch (target.type) {
    case "objective":
      return { objectiveId: objectiveId ?? target.id, type: "objective" };
    case "strategy":
      return objectiveId
        ? { objectiveId, strategyId: target.id, type: "strategy" }
        : { strategyId: target.id, type: "strategy" };
    case "branch":
      return objectiveId
        ? { branchId: target.id, objectiveId, type: "branch" }
        : { branchId: target.id, type: "branch" };
    case "step":
      return objectiveId
        ? { objectiveId, stepId: target.id, type: "step" }
        : { stepId: target.id, type: "step" };
    case "assumption":
      return objectiveId
        ? { objectiveId, stepId: target.stepId, type: "assumption" }
        : { stepId: target.stepId, type: "assumption" };
    case "context":
      return objectiveId
        ? { contextItemId: target.id, objectiveId, type: "context" }
        : { contextItemId: target.id, type: "context" };
    case "decision": {
      const targetObjectiveId = objectiveId ?? target.ancestry.objectiveId;
      if (target.ancestry.stepId) {
        return targetObjectiveId
          ? { objectiveId: targetObjectiveId, stepId: target.ancestry.stepId, type: "step" }
          : { stepId: target.ancestry.stepId, type: "step" };
      }
      if (target.ancestry.branchId) {
        return targetObjectiveId
          ? { branchId: target.ancestry.branchId, objectiveId: targetObjectiveId, type: "branch" }
          : { branchId: target.ancestry.branchId, type: "branch" };
      }
      if (target.ancestry.strategyId) {
        return targetObjectiveId
          ? { objectiveId: targetObjectiveId, strategyId: target.ancestry.strategyId, type: "strategy" }
          : { strategyId: target.ancestry.strategyId, type: "strategy" };
      }
      return targetObjectiveId ? { objectiveId: targetObjectiveId, type: "objective" } : {};
    }
  }
  return undefined;
}

export default function App() {
  const auth = useAuth();
  const navigation = useAppNavigation();
  const toasts = useToasts();
  // Resolve once per mounted tab so React route changes retain its demo alias.
  const [agentName] = useState(() => resolveCurrentTabWebMcpAgentName());
  const accessToken = auth.session?.access_token ?? null;
  const api = useMemo(() => new LemmaApi(() => accessToken), [accessToken]);
  const activeWorkspaceId = auth.session && navigation.page === "workspace"
    ? navigation.workspaceId
    : null;

  const workspace = useWorkspace({
    api,
    objectiveId: navigation.objectiveId,
    onOpenObjective: navigation.openObjective,
    onReplaceObjective: navigation.replaceObjective,
    pushToast: toasts.push,
    workspaceId: activeWorkspaceId,
  });
  const workspaces = useWorkspaces({
    api,
    enabled: Boolean(auth.session && navigation.page === "dashboard"),
    onOpenWorkspace: navigation.openWorkspace,
    pushToast: toasts.push,
  });
  const webMcpAvailable = useWebMcp({
    agentName,
    api,
    highlight: (target) => workspace.highlightExternalMutation(mutationNotice(target)),
    refreshCurrentWorkspace: workspace.refreshFromAgent,
  });

  let content;
  if (!auth.initialized) {
    content = <LoadingScreen />;
  } else if (!auth.session || !auth.user) {
    content = (
      <AuthPage
        busy={auth.busy}
        draft={auth.draft}
        error={auth.error}
        mode={auth.mode}
        notice={auth.notice}
        onChange={auth.onChange}
        onModeChange={auth.onModeChange}
        onSubmit={auth.onSubmit}
        onTogglePassword={auth.onTogglePassword}
        passwordVisible={auth.passwordVisible}
      />
    );
  } else {
    const dashboardRoute = (
      <DashboardPage
        busy={workspaces.busy}
        createOpen={workspaces.createOpen}
        draft={workspaces.draft}
        email={auth.user.email ?? "Signed-in user"}
        loading={workspaces.loading}
        onCreate={workspaces.onCreate}
        onCreateOpenChange={workspaces.onCreateOpenChange}
        onDraftChange={workspaces.onDraftChange}
        onOpenWorkspace={navigation.openWorkspace}
        onSearchChange={workspaces.onSearchChange}
        onSignOut={() => void auth.signOut()}
        search={workspaces.search}
        webMcpAvailable={webMcpAvailable}
        workspaces={workspaces.workspaces}
      />
    );

    let workspaceRoute: ReactNode;
    if (workspace.loading && !workspace.overview) {
      workspaceRoute = <LoadingScreen />;
    } else if (workspace.error || !workspace.overview) {
      workspaceRoute = (
        <main className="app-error">
          <Brand />
          <div className="app-error__card">
            <span>Workspace unavailable</span>
            <h1>We could not open this reasoning graph.</h1>
            <p>{workspace.error ?? "The workspace may have been removed or you may not have access."}</p>
            <div>
              <Button icon={<ArrowLeft />} onClick={navigation.goHome} tone="secondary">
                Back to workspaces
              </Button>
              <Button icon={<RefreshCw />} onClick={workspace.actions.refresh}>
                Try again
              </Button>
            </div>
          </div>
        </main>
      );
    } else {
      workspaceRoute = (
        <WorkspacePage
          actions={{ ...workspace.actions, goBack: navigation.goHome }}
          draftConflict={workspace.draftConflict}
          expandedObjectiveIds={workspace.expandedObjectiveIds}
          graph={workspace.graph}
          loadingObjectiveIds={workspace.loadingObjectiveIds}
          objectiveStrategies={workspace.objectiveStrategies}
          overview={workspace.overview}
          pendingDecisions={workspace.pendingDecisions}
          realtimeStatus={workspace.realtimeStatus}
          state={workspace.state}
          webMcpAvailable={webMcpAvailable}
        />
      );
    }

    content = (
      <AppRoutes
        dashboard={dashboardRoute}
        workspace={workspaceRoute}
      />
    );
  }

  return (
    <>
      {content}
      <ToastRegion messages={toasts.messages} onDismiss={toasts.dismiss} />
    </>
  );
}
