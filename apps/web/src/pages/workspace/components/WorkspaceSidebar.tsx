import type {
  Branch,
  ContextItem,
  ObjectiveSummary,
  Strategy,
  Workspace,
} from "@lemma/contracts";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  File,
  FileImage,
  FileText,
  FolderTree,
  GitBranch,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  ScrollText,
  Target,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { markdownToPlainText } from "../../../lib/markdownToPlainText";
import { cx } from "../../../lib/ui";
import { MarkdownMath, MathText } from "../../../components/MarkdownMath";
import { IconButton, StatusBadge } from "../../../components/Primitives";

export interface ObjectiveStrategyGroup {
  branches: Branch[];
  strategies: Strategy[];
}

export interface WorkspaceSidebarProps {
  activeObjectiveId: string | null;
  collapsed: boolean;
  expandedObjectiveIds: string[];
  generalContextItems: ContextItem[];
  loadingObjectiveIds: string[];
  objectiveContextItems: ContextItem[];
  objectivePendingDecisionCounts?: Readonly<Record<string, number>>;
  objectiveStrategies: Record<string, ObjectiveStrategyGroup | undefined>;
  objectives: ObjectiveSummary[];
  onAddContext: () => void;
  onAddObjective: () => void;
  onAddStrategy: (objectiveId: string) => void;
  onEditObjective: (objectiveId: string) => void;
  onOpenContextItem: (contextItemId: string) => void;
  onOpenPendingDecisionForObjective?: (objectiveId: string) => void;
  onOpenPendingDecisionForStrategy?: (strategyId: string) => void;
  onSelectObjective: (objectiveId: string) => void;
  onSelectStrategy: (strategyId: string) => void;
  onToggleCollapsed: () => void;
  onToggleObjective: (objectiveId: string) => void;
  selectedStrategyId: string | null;
  strategyPendingDecisionCounts?: Readonly<Record<string, number>>;
  workspace: Workspace;
}

const PREVIEW_OPEN_DELAY_MS = 450;
const PREVIEW_CLOSE_DELAY_MS = 160;
const PREVIEW_GUTTER_PX = 12;
const PREVIEW_MAX_HEIGHT_PX = 480;
const PREVIEW_WIDTH_PX = 420;

type SidebarPreviewKind = "objective" | "strategy";

interface SidebarPreviewContent {
  constraintsMarkdown?: string;
  id: string;
  kind: SidebarPreviewKind;
  markdown: string;
  status: string;
  title: string;
}

interface SidebarPreviewPosition {
  left: number;
  top: number;
}

interface SidebarPreview {
  anchor: HTMLElement;
  content: SidebarPreviewContent;
  position: SidebarPreviewPosition;
}

function getPreviewPosition(anchor: HTMLElement): SidebarPreviewPosition {
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxLeft = Math.max(PREVIEW_GUTTER_PX, viewportWidth - PREVIEW_WIDTH_PX - PREVIEW_GUTTER_PX);
  const previewMaxHeight = Math.min(
    PREVIEW_MAX_HEIGHT_PX,
    Math.max(0, viewportHeight - PREVIEW_GUTTER_PX * 2),
  );
  const maxTop = Math.max(
    PREVIEW_GUTTER_PX,
    viewportHeight - previewMaxHeight - PREVIEW_GUTTER_PX,
  );
  const shouldOpenToRight = viewportWidth - rect.right >= PREVIEW_WIDTH_PX + PREVIEW_GUTTER_PX || rect.left < viewportWidth / 2;
  const desiredLeft = shouldOpenToRight
    ? rect.right + PREVIEW_GUTTER_PX
    : rect.left - PREVIEW_WIDTH_PX - PREVIEW_GUTTER_PX;

  return {
    left: Math.min(Math.max(PREVIEW_GUTTER_PX, desiredLeft), maxLeft),
    top: Math.min(
      Math.max(PREVIEW_GUTTER_PX, rect.top),
      maxTop,
    ),
  };
}

function previewContentForObjective(objective: ObjectiveSummary): SidebarPreviewContent {
  const constraintsMarkdown = objective.constraints_markdown.trim();

  return {
    ...(constraintsMarkdown ? { constraintsMarkdown } : {}),
    id: `objective:${objective.id}`,
    kind: "objective",
    markdown: objective.objective_markdown.trim() || "No objective description yet.",
    status: objective.status,
    title: objective.title,
  };
}

function previewContentForStrategy(strategy: Strategy): SidebarPreviewContent {
  return {
    id: `strategy:${strategy.id}`,
    kind: "strategy",
    markdown: strategy.description_markdown.trim() || "No strategy note yet.",
    status: strategy.status,
    title: strategy.title,
  };
}

function SidebarStatus({ status }: { status: string }) {
  if (status !== "completed") return <StatusBadge status={status} />;

  return (
    <span aria-label="Completed" className="sidebar-completion-mark" role="img">
      <Check aria-hidden="true" />
    </span>
  );
}

function contextIcon(kind: string) {
  if (kind === "link" || kind === "paper") return <Link2 />;
  if (kind === "image") return <FileImage />;
  if (kind === "pdf") return <FileText />;
  if (kind === "text" || kind === "note") return <ScrollText />;
  return <File />;
}

function ContextList({
  emptyCopy,
  items,
  onOpenContextItem,
}: {
  emptyCopy: string;
  items: ContextItem[];
  onOpenContextItem: (contextItemId: string) => void;
}) {
  if (items.length === 0) return <p className="sidebar-context-empty">{emptyCopy}</p>;

  return (
    <div className="context-list">
      {items.map((item) => (
        <button
          aria-label={`Open context ${markdownToPlainText(item.title)}`}
          className="context-item"
          key={item.id}
          onClick={() => onOpenContextItem(item.id)}
          type="button"
        >
          <span className={`context-item__icon context-item__icon--${item.kind}`}>{contextIcon(item.kind)}</span>
          <span>
            <b><MathText markdown={item.title} /></b>
            <small>{item.kind} · {item.processing_status}</small>
          </span>
          <ArrowUpRight />
        </button>
      ))}
    </div>
  );
}

export function WorkspaceSidebar({
  activeObjectiveId,
  collapsed,
  expandedObjectiveIds,
  generalContextItems,
  loadingObjectiveIds,
  objectiveContextItems,
  objectivePendingDecisionCounts = {},
  objectiveStrategies,
  objectives,
  onAddContext,
  onAddObjective,
  onAddStrategy,
  onEditObjective,
  onOpenContextItem,
  onOpenPendingDecisionForObjective,
  onOpenPendingDecisionForStrategy,
  onSelectObjective,
  onSelectStrategy,
  onToggleCollapsed,
  onToggleObjective,
  selectedStrategyId,
  strategyPendingDecisionCounts = {},
  workspace,
}: WorkspaceSidebarProps) {
  const contextCount = generalContextItems.length + objectiveContextItems.length;
  const [preview, setPreview] = useState<SidebarPreview | null>(null);
  const previewRef = useRef<SidebarPreview | null>(null);
  const previewPanelRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const focusToggleAfterChangeRef = useRef(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const setCurrentPreview = useCallback((nextPreview: SidebarPreview | null) => {
    previewRef.current = nextPreview;
    setPreview(nextPreview);
  }, []);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current === null) return;
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const closePreview = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    setCurrentPreview(null);
  }, [clearCloseTimer, clearOpenTimer, setCurrentPreview]);

  const scheduleHoverPreview = useCallback((anchor: HTMLElement, content: SidebarPreviewContent) => {
    clearCloseTimer();
    const currentPreview = previewRef.current;
    if (currentPreview?.content.id === content.id) return;

    clearOpenTimer();
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      setCurrentPreview({
        anchor,
        content,
        position: getPreviewPosition(anchor),
      });
    }, PREVIEW_OPEN_DELAY_MS);
  }, [clearCloseTimer, clearOpenTimer, setCurrentPreview]);

  const schedulePreviewClose = useCallback(() => {
    const currentPreview = previewRef.current;
    if (!currentPreview) return;

    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      closePreview();
    }, PREVIEW_CLOSE_DELAY_MS);
  }, [clearCloseTimer, closePreview]);

  const onPreviewTriggerLeave = useCallback((contentId: string) => {
    clearOpenTimer();
    if (previewRef.current?.content.id === contentId) schedulePreviewClose();
  }, [clearOpenTimer, schedulePreviewClose]);

  useEffect(() => {
    if (collapsed) closePreview();
  }, [closePreview, collapsed]);

  useEffect(() => {
    if (!focusToggleAfterChangeRef.current) return;
    focusToggleAfterChangeRef.current = false;
    const selector = collapsed
      ? ".workspace-sidebar__rail [data-sidebar-toggle]"
      : ".workspace-sidebar__panel [data-sidebar-toggle]";
    sidebarRef.current?.querySelector<HTMLButtonElement>(selector)?.focus();
  }, [collapsed]);

  const toggleCollapsed = () => {
    focusToggleAfterChangeRef.current = true;
    onToggleCollapsed();
  };

  useEffect(() => {
    const updatePreviewPosition = () => {
      const currentPreview = previewRef.current;
      if (!currentPreview) return;
      const nextPosition = getPreviewPosition(currentPreview.anchor);
      if (
        nextPosition.left === currentPreview.position.left
        && nextPosition.top === currentPreview.position.top
      ) return;
      setCurrentPreview({ ...currentPreview, position: nextPosition });
    };

    const onPointerDown = (event: PointerEvent) => {
      const currentPreview = previewRef.current;
      const target = event.target;
      if (!currentPreview || !(target instanceof Node)) return;
      if (currentPreview.anchor.contains(target) || previewPanelRef.current?.contains(target)) return;
      closePreview();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !previewRef.current) return;
      event.preventDefault();
      closePreview();
    };

    window.addEventListener("resize", updatePreviewPosition);
    window.addEventListener("scroll", updatePreviewPosition, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearOpenTimer();
      clearCloseTimer();
      window.removeEventListener("resize", updatePreviewPosition);
      window.removeEventListener("scroll", updatePreviewPosition, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [clearCloseTimer, clearOpenTimer, closePreview, setCurrentPreview]);

  return (
    <>
      <aside
        aria-label={`${markdownToPlainText(workspace.title)} navigation`}
        className={cx("workspace-sidebar", collapsed && "is-collapsed")}
        ref={sidebarRef}
      >
        <div aria-hidden={collapsed} className="workspace-sidebar__panel" inert={collapsed}>
          <section className="sidebar-section sidebar-section--objectives">
          <div className="sidebar-section__heading">
            <span><FolderTree /> Objectives <b>{objectives.length}</b></span>
            <div className="sidebar-section__actions">
              <IconButton data-sidebar-toggle label="Hide workspace sidebar" onClick={toggleCollapsed}><PanelLeftClose /></IconButton>
              <IconButton label="Add objective" onClick={onAddObjective}><Plus /></IconButton>
            </div>
          </div>
          {objectives.length === 0 ? (
            <button className="sidebar-empty-action" onClick={onAddObjective} type="button">
              <Target />
              <span><b>Create the first objective</b><small>Objectives hold their own strategies and boards.</small></span>
            </button>
          ) : (
            <div className="objective-tree" role="tree">
              {objectives.map((objective) => {
                const expanded = expandedObjectiveIds.includes(objective.id);
                const loading = loadingObjectiveIds.includes(objective.id);
                const group = objectiveStrategies[objective.id];
                const strategyPanelId = `objective-strategies-${objective.id}`;
                const active = objective.id === activeObjectiveId;
                const objectivePreview = previewContentForObjective(objective);
                const pendingDecisionCount = objectivePendingDecisionCounts[objective.id] ?? 0;

                return (
                  <div className={cx("objective-tree__item", active && "is-active")} key={objective.id} role="treeitem">
                    <div className="objective-tree__row">
                      <button
                        aria-controls={strategyPanelId}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Collapse" : "Expand"} objective ${markdownToPlainText(objective.title)}`}
                        className="objective-tree__toggle"
                        onClick={() => onToggleObjective(objective.id)}
                        type="button"
                      >
                        <ChevronRight />
                      </button>
                      <button
                        aria-current={active ? "page" : undefined}
                        className="objective-tree__select"
                        onClick={() => onSelectObjective(objective.id)}
                        onMouseEnter={(event) => scheduleHoverPreview(event.currentTarget, objectivePreview)}
                        onMouseLeave={() => onPreviewTriggerLeave(objectivePreview.id)}
                        type="button"
                      >
                        <span className="objective-tree__icon"><Target /></span>
                        <span className="objective-tree__copy">
                          <b><MathText markdown={objective.title} /></b>
                          <small>{objective.strategy_count} {objective.strategy_count === 1 ? "strategy" : "strategies"} · {objective.step_count} {objective.step_count === 1 ? "step" : "steps"}</small>
                        </span>
                        <SidebarStatus status={objective.status} />
                      </button>
                      <IconButton
                        className="objective-tree__add-strategy"
                        label={`Add strategy to ${markdownToPlainText(objective.title)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onAddStrategy(objective.id);
                        }}
                      >
                        <Plus />
                      </IconButton>
                      {pendingDecisionCount > 0 && (
                        <button
                          aria-label={`Review ${pendingDecisionCount} pending human decision${pendingDecisionCount === 1 ? "" : "s"} for ${markdownToPlainText(objective.title)}`}
                          className="human-checkpoint-badge human-checkpoint-badge--sidebar"
                          disabled={!onOpenPendingDecisionForObjective}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenPendingDecisionForObjective?.(objective.id);
                          }}
                          type="button"
                        >
                          Your call · {pendingDecisionCount}
                        </button>
                      )}
                      {active && (
                        <IconButton label={`Edit objective ${markdownToPlainText(objective.title)}`} onClick={() => onEditObjective(objective.id)}>
                          <Pencil />
                        </IconButton>
                      )}
                    </div>
                    {expanded && (
                      <div className="objective-tree__strategies" id={strategyPanelId} role="group">
                        {loading ? (
                          <p className="objective-tree__loading">Loading strategies…</p>
                        ) : group && group.strategies.length > 0 ? (
                          group.strategies.map((strategy, index) => {
                            const strategyPreview = previewContentForStrategy(strategy);
                            const strategyPendingDecisionCount = strategyPendingDecisionCounts[strategy.id] ?? 0;
                            return (
                              <div className="strategy-item-row" key={strategy.id}>
                                <button
                                  aria-current={strategy.id === selectedStrategyId ? "true" : undefined}
                                  className={cx("strategy-item", strategy.id === selectedStrategyId && "is-selected")}
                                  onClick={() => onSelectStrategy(strategy.id)}
                                  onMouseEnter={(event) => scheduleHoverPreview(event.currentTarget, strategyPreview)}
                                  onMouseLeave={() => onPreviewTriggerLeave(strategyPreview.id)}
                                  type="button"
                                >
                                  <span className="strategy-item__index">{String(index + 1).padStart(2, "0")}</span>
                                  <span className="strategy-item__copy">
                                    <b><MathText markdown={strategy.title} /></b>
                                    <MathText className="strategy-item__preview" markdown={strategy.description_markdown.trim() || "No strategy note yet"} />
                                  </span>
                                  <SidebarStatus status={strategy.status} />
                                </button>
                                {strategyPendingDecisionCount > 0 && (
                                  <button
                                    aria-label={`Review ${strategyPendingDecisionCount} pending human decision${strategyPendingDecisionCount === 1 ? "" : "s"} for ${markdownToPlainText(strategy.title)}`}
                                    className="human-checkpoint-badge human-checkpoint-badge--inline"
                                    disabled={!onOpenPendingDecisionForStrategy}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onOpenPendingDecisionForStrategy?.(strategy.id);
                                    }}
                                    type="button"
                                  >
                                    Your call · {strategyPendingDecisionCount}
                                  </button>
                                )}
                              </div>
                            );
                          })
                        ) : active ? (
                          <button className="sidebar-empty-action sidebar-empty-action--compact" onClick={() => onAddStrategy(objective.id)} type="button">
                            <GitBranch />
                            <span><b>Add a strategy</b><small>Choose an approach to begin this objective.</small></span>
                          </button>
                        ) : (
                          <p className="objective-tree__loading">Use the + button to add this objective&apos;s first strategy.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          </section>

          <section className="sidebar-section sidebar-section--context">
          <div className="sidebar-section__heading">
            <span>Context <b>{contextCount}</b></span>
            <IconButton label="Add context" onClick={onAddContext}><Plus /></IconButton>
          </div>
          <div className="context-scope-list">
            <section aria-label="General workspace context">
              <h3>General workspace <span>{generalContextItems.length}</span></h3>
              <ContextList emptyCopy="No general context yet." items={generalContextItems} onOpenContextItem={onOpenContextItem} />
            </section>
            <section aria-label="Selected objective context">
              <h3>Specific objective <span>{objectiveContextItems.length}</span></h3>
              <ContextList
                emptyCopy={activeObjectiveId ? "No context specific to this objective yet." : "Select an objective to view its specific context."}
                items={objectiveContextItems}
                onOpenContextItem={onOpenContextItem}
              />
            </section>
          </div>
          </section>
        </div>

        <div aria-hidden={!collapsed} className="workspace-sidebar__rail" inert={!collapsed}>
          <IconButton data-sidebar-toggle label="Show workspace sidebar" onClick={toggleCollapsed}>
            <PanelLeftOpen />
          </IconButton>
        </div>
      </aside>

      {preview && typeof document !== "undefined" && createPortal(
        <section
          aria-label={`${preview.content.kind === "objective" ? "Objective" : "Strategy"} preview: ${markdownToPlainText(preview.content.title)}`}
          className="sidebar-preview"
          onMouseEnter={clearCloseTimer}
          onMouseLeave={schedulePreviewClose}
          ref={previewPanelRef}
          role="dialog"
          style={{
            "--sidebar-preview-left": `${preview.position.left}px`,
            "--sidebar-preview-top": `${preview.position.top}px`,
          } as CSSProperties}
        >
          <header className="sidebar-preview__header">
            <div>
              <span>{preview.content.kind}</span>
              <h2><MathText markdown={preview.content.title} /></h2>
            </div>
            <IconButton label="Close preview" onClick={closePreview}><X /></IconButton>
          </header>
          <div className="sidebar-preview__meta">
            <SidebarStatus status={preview.content.status} />
          </div>
          <div className="sidebar-preview__body">
            <MarkdownMath markdown={preview.content.markdown} />
            {preview.content.constraintsMarkdown && (
              <section className="sidebar-preview__constraints">
                <h3>Constraints</h3>
                <MarkdownMath markdown={preview.content.constraintsMarkdown} />
              </section>
            )}
          </div>
        </section>,
        document.body,
      )}
    </>
  );
}
