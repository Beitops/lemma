import type { WorkspaceSummary } from "@lemma/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspaceDraft } from "./DashboardPage";
import { ApiClientError, type LemmaApi } from "../../lib/api";
import type { ToastTone } from "../../components/Primitives";

const EMPTY_DRAFT: WorkspaceDraft = {
  title: "",
};

function readableError(error: unknown): string {
  if (error instanceof ApiClientError && error.code === "REVISION_CONFLICT") {
    return "This workspace changed in another session. Refresh and try again.";
  }
  if (error instanceof Error) return error.message;
  return "The workspace could not be created.";
}

interface UseWorkspacesOptions {
  api: LemmaApi;
  enabled: boolean;
  onOpenWorkspace: (workspaceId: string) => void;
  pushToast: (message: string, tone?: ToastTone) => void;
}

export interface WorkspacesController {
  busy: boolean;
  createOpen: boolean;
  draft: WorkspaceDraft;
  loading: boolean;
  onCreate: () => void;
  onCreateOpenChange: (open: boolean) => void;
  onDraftChange: (field: keyof WorkspaceDraft, value: string) => void;
  onSearchChange: (value: string) => void;
  refresh: () => void;
  search: string;
  workspaces: WorkspaceSummary[];
}

export function useWorkspaces({
  api,
  enabled,
  onOpenWorkspace,
  pushToast,
}: UseWorkspacesOptions): WorkspacesController {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<WorkspaceDraft>(EMPTY_DRAFT);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const result = await api.listWorkspaces(signal);
      setWorkspaces(result.workspaces);
    },
    [api],
  );

  useEffect(() => {
    if (!enabled) {
      setWorkspaces([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) pushToast(readableError(error), "error");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [enabled, load, pushToast]);

  const onCreate = useCallback(() => {
    if (busy) return;

    setBusy(true);
    void (async () => {
      const result = await api.createWorkspace({
        author_type: "human",
        idempotency_key: crypto.randomUUID(),
        title: draft.title.trim(),
      });

      setCreateOpen(false);
      setDraft(EMPTY_DRAFT);
      pushToast("Empty workspace created. Add an objective when you are ready.", "success");
      onOpenWorkspace(result.workspace_id);
    })()
      .catch((error: unknown) => pushToast(readableError(error), "error"))
      .finally(() => setBusy(false));
  }, [api, busy, draft, onOpenWorkspace, pushToast]);

  const filteredWorkspaces = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return workspaces;
    return workspaces.filter((summary) =>
      `${summary.workspace.title}\n${summary.objective_count}\n${summary.active_objective_count}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [search, workspaces]);

  return useMemo(
    () => ({
      busy,
      createOpen,
      draft,
      loading,
      onCreate,
      onCreateOpenChange: setCreateOpen,
      onDraftChange: (field: keyof WorkspaceDraft, value: string) =>
        setDraft((current) => ({ ...current, [field]: value })),
      onSearchChange: setSearch,
      refresh: () => {
        setLoading(true);
        void load()
          .catch((error: unknown) => pushToast(readableError(error), "error"))
          .finally(() => setLoading(false));
      },
      search,
      workspaces: filteredWorkspaces,
    }),
    [busy, createOpen, draft, filteredWorkspaces, load, loading, onCreate, pushToast, search],
  );
}
