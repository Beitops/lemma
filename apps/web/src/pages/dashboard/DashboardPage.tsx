import type { WorkspaceSummary } from "@lemma/contracts";
import { useEffect, useRef } from "react";
import {
  ArrowRight,
  BookOpenText,
  Bot,
  GitBranch,
  LogOut,
  Network,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { Brand } from "../../components/Brand";
import { MathText } from "../../components/MarkdownMath";
import { Button, EmptyState, IconButton, Modal } from "../../components/Primitives";
import { markdownToPlainText } from "../../lib/markdownToPlainText";
import { formatRelativeTime, initials } from "../../lib/ui";

export interface WorkspaceDraft {
  title: string;
}

interface DashboardPageProps {
  busy: boolean;
  createOpen: boolean;
  draft: WorkspaceDraft;
  email: string;
  loading: boolean;
  onCreate: () => void;
  onCreateOpenChange: (open: boolean) => void;
  onDraftChange: (field: keyof WorkspaceDraft, value: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onSearchChange: (value: string) => void;
  onSignOut: () => void;
  search: string;
  webMcpAvailable: boolean;
  workspaces: WorkspaceSummary[];
}

function WorkspaceMiniGraph({ index }: { index: number }) {
  const variants = ["violet", "coral", "teal"] as const;
  const variant = variants[index % variants.length] ?? "violet";

  return (
    <div className={`workspace-mini-graph workspace-mini-graph--${variant}`} aria-hidden="true">
      <span className="mini-node mini-node--one" />
      <span className="mini-edge mini-edge--one" />
      <span className="mini-node mini-node--two" />
      <span className="mini-edge mini-edge--two" />
      <span className="mini-node mini-node--three" />
      <span className="mini-edge mini-edge--fork" />
      <span className="mini-node mini-node--four" />
    </div>
  );
}

export function DashboardPage({
  busy,
  createOpen,
  draft,
  email,
  loading,
  onCreate,
  onCreateOpenChange,
  onDraftChange,
  onOpenWorkspace,
  onSearchChange,
  onSignOut,
  search,
  webMcpAvailable,
  workspaces,
}: DashboardPageProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <Brand />
        <div className="dashboard-header__tools">
          <div className="global-search">
            <Search aria-hidden="true" />
            <input
              aria-label="Search workspaces"
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search workspaces"
              ref={searchInputRef}
              value={search}
            />
            <kbd>⌘ K</kbd>
          </div>
          <span className={`agent-chip ${webMcpAvailable ? "is-live" : ""}`}>
            <span />
            <Bot />
            {webMcpAvailable ? "Agent tools live" : "Human mode"}
          </span>
          <div className="user-menu">
            <span className="avatar">{initials(email)}</span>
            <span className="user-menu__email">{email}</span>
            <IconButton label="Sign out" onClick={onSignOut}>
              <LogOut />
            </IconButton>
          </div>
        </div>
      </header>

      <main className="dashboard-main">
        <section className="dashboard-hero">
          <div>
            <div className="eyebrow"><Sparkles /> Your reasoning library</div>
            <h1>What are we<br /><em>thinking through?</em></h1>
            <p>
              Gather related problems in one place. Add objectives when each line of reasoning is ready to begin.
            </p>
          </div>
          <Button icon={<Plus />} onClick={() => onCreateOpenChange(true)}>
            New workspace
          </Button>
        </section>

        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <h2>Workspaces</h2>
              <span>{workspaces.length} active reasoning {workspaces.length === 1 ? "space" : "spaces"}</span>
            </div>
            <span className="text-action text-action--static">Recently updated</span>
          </div>

          {loading ? (
            <div className="workspace-grid workspace-grid--loading">
              {[0, 1, 2].map((item) => <div className="workspace-card-skeleton" key={item} />)}
            </div>
          ) : workspaces.length === 0 ? (
            <EmptyState
              action={(
                <Button icon={<Plus />} onClick={() => onCreateOpenChange(true)}>
                  Create your first workspace
                </Button>
              )}
              description="Create an empty reasoning space, then add one or more objectives when you are ready."
              icon={<Network />}
              title="Your first idea starts here"
            />
          ) : (
            <div className="workspace-grid">
              {workspaces.map((summary, index) => {
                const workspace = summary.workspace;
                const objectiveLabel = summary.objective_count === 0
                  ? "No objectives yet"
                  : `${summary.objective_count} ${summary.objective_count === 1 ? "objective" : "objectives"}`;
                const activeLabel = summary.active_objective_count === 0
                  ? "No active objectives"
                  : `${summary.active_objective_count} active`;

                return (
                <button
                  aria-label={`Open workspace ${markdownToPlainText(workspace.title)}`}
                  className="workspace-card"
                  key={workspace.id}
                  onClick={() => onOpenWorkspace(workspace.id)}
                  type="button"
                >
                  <WorkspaceMiniGraph index={index} />
                  <div className="workspace-card__body">
                    <div className="workspace-card__topline">
                      <span className="workspace-kind"><BookOpenText /> Workspace</span>
                      <span>{formatRelativeTime(workspace.updated_at)}</span>
                    </div>
                    <h3><MathText markdown={workspace.title} /></h3>
                    <div className="workspace-card__objective workspace-card__objective--summary">
                      <span>{objectiveLabel}</span>
                      <small>{activeLabel}</small>
                    </div>
                    <div className="workspace-card__footer">
                      <span><GitBranch /> Revision {workspace.revision}</span>
                      <span className="workspace-card__open">Open <ArrowRight /></span>
                    </div>
                  </div>
                </button>
                );
              })}
              <button className="workspace-card workspace-card--new" onClick={() => onCreateOpenChange(true)} type="button">
                <span className="workspace-card--new__icon"><Plus /></span>
                <b>New workspace</b>
                <span>Start an empty workspace</span>
              </button>
            </div>
          )}
        </section>

      </main>

      <Modal
        description="Create a shared space first. You can add objectives, context, and strategies from inside it."
        onClose={() => onCreateOpenChange(false)}
        open={createOpen}
        title="Create a reasoning workspace"
        wide
      >
        <form
          className="workspace-form"
          onSubmit={(event) => {
            event.preventDefault();
            onCreate();
          }}
        >
          <label>
            <span>Workspace name</span>
            <input
              autoFocus
              data-autofocus
              maxLength={120}
              onChange={(event) => onDraftChange("title", event.target.value)}
              placeholder="e.g. Functional analysis notes"
              required
              value={draft.title}
            />
            <small>You can organize several independent mathematical objectives inside this workspace.</small>
          </label>
          <div className="modal__actions">
            <Button onClick={() => onCreateOpenChange(false)} tone="ghost">Cancel</Button>
            <Button busy={busy} icon={<Sparkles />} type="submit">Create workspace</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
