import type { Branch, Step, Strategy } from "@lemma/contracts";
import {
  Bot,
  Compass,
  Flag,
  GitBranch,
  Lightbulb,
  Pencil,
  Plus,
  Split,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import { markdownToPlainText } from "../../../lib/markdownToPlainText";
import { MarkdownMath, MathText } from "../../../components/MarkdownMath";
import { IconButton, StatusBadge } from "../../../components/Primitives";
import { cx, formatRelativeTime } from "../../../lib/ui";

export interface ReasoningCanvasProps {
  branches: Branch[];
  focusMode?: boolean;
  onAddStep: (branchId: string) => void;
  onBranchFromStep: (stepId: string) => void;
  onEditStep: (stepId: string) => void;
  onMarkDeadEnd?: ((stepId: string) => void) | undefined;
  onOpenPendingDecision?: ((stepId: string) => void) | undefined;
  onSelectBranch: (branchId: string) => void;
  onSelectStep: (stepId: string) => void;
  onSelectStrategy?: (strategyId: string) => void;
  selectedBranchId: string | null;
  selectedStepId: string | null;
  selectedStrategyId?: string | null;
  pendingDecisionCountsByStepId?: Readonly<Record<string, number>>;
  steps: Step[];
  strategy?: Strategy | null;
  strategies?: Strategy[];
}

interface StepCardProps {
  onBranch: () => void;
  onEdit: () => void;
  onMarkDeadEnd?: (() => void) | undefined;
  onOpenPendingDecision?: (() => void) | undefined;
  onSelect: () => void;
  pendingDecisionCount: number;
  selected: boolean;
  step: Step;
}

interface BranchIndex {
  branchSteps: Map<string, Step[]>;
  childrenByForkStepId: Map<string, Branch[]>;
  roots: Branch[];
}

const compareByCreatedAt = <T extends { created_at: string; id: string }>(left: T, right: T) => (
  left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
);

function sortSteps(steps: Step[]) {
  return [...steps].sort((left, right) => (
    left.ordinal - right.ordinal
    || left.created_at.localeCompare(right.created_at)
    || left.id.localeCompare(right.id)
  ));
}

function groupStrategyBranches(
  branches: Branch[],
  stepsByBranchId: ReadonlyMap<string, Step[]>,
): BranchIndex {
  const strategyBranches = [...branches].sort(compareByCreatedAt);
  const branchById = new Map(strategyBranches.map((branch) => [branch.id, branch]));
  const branchSteps = new Map<string, Step[]>();

  for (const branch of strategyBranches) {
    branchSteps.set(
      branch.id,
      sortSteps((stepsByBranchId.get(branch.id) ?? []).filter((step) => step.strategy_id === branch.strategy_id)),
    );
  }

  const childrenByForkStepId = new Map<string, Branch[]>();
  const roots: Branch[] = [];

  for (const branch of strategyBranches) {
    const parent = branch.parent_branch_id ? branchById.get(branch.parent_branch_id) : undefined;
    const parentSteps = parent ? branchSteps.get(parent.id) ?? [] : [];
    const canAttachToFork = Boolean(
      parent
      && branch.forked_from_step_id
      && parentSteps.some((step) => step.id === branch.forked_from_step_id),
    );

    if (!canAttachToFork || !branch.forked_from_step_id) {
      roots.push(branch);
      continue;
    }

    const forkChildren = childrenByForkStepId.get(branch.forked_from_step_id) ?? [];
    forkChildren.push(branch);
    childrenByForkStepId.set(branch.forked_from_step_id, forkChildren);
  }

  for (const forkChildren of childrenByForkStepId.values()) {
    forkChildren.sort(compareByCreatedAt);
  }

  const reachableBranchIds = new Set<string>();
  const visitBranch = (branch: Branch) => {
    if (reachableBranchIds.has(branch.id)) return;
    reachableBranchIds.add(branch.id);
    for (const step of branchSteps.get(branch.id) ?? []) {
      for (const child of childrenByForkStepId.get(step.id) ?? []) visitBranch(child);
    }
  };

  for (const root of roots) visitBranch(root);
  for (const branch of strategyBranches) {
    if (!reachableBranchIds.has(branch.id)) {
      roots.push(branch);
      visitBranch(branch);
    }
  }

  return {
    branchSteps,
    childrenByForkStepId,
    roots: roots.sort(compareByCreatedAt),
  };
}

function StepCard({
  onBranch,
  onEdit,
  onMarkDeadEnd,
  onOpenPendingDecision,
  onSelect,
  pendingDecisionCount,
  selected,
  step,
}: StepCardProps) {
  const isAgent = step.author_type === "agent";

  const selectStepFromBody = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest("a, button, input, select, textarea")) return;
    onSelect();
  };

  return (
    <article
      className={cx("step-card", selected && "is-selected", `step-card--${step.status}`)}
      data-board-interactive="true"
      data-step-card="true"
      data-step-id={step.id}
      data-step-status={step.status}
    >
      <header className="step-card__header">
        <button
          aria-label={`Step ${step.ordinal}: ${markdownToPlainText(step.title)}${step.summary ? `. ${markdownToPlainText(step.summary)}` : ""}. ${step.status}`}
          aria-pressed={selected}
          className="step-card__select"
          onClick={onSelect}
          type="button"
        >
          <span className="step-card__topline">
            <span className="step-number">Step {String(step.ordinal).padStart(2, "0")}</span>
            <StatusBadge status={step.status} />
          </span>
          <h4><MathText markdown={step.title} /></h4>
          {step.summary && <MathText className="step-card__summary" markdown={step.summary} />}
        </button>
        <IconButton
          className="step-card__edit"
          label={`Edit ${markdownToPlainText(step.title)}`}
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
        >
          <Pencil />
        </IconButton>
      </header>

      <div className="step-card__body" data-step-body="true" onClick={selectStepFromBody}>
        <MarkdownMath markdown={step.body_markdown} />
      </div>

      {(step.concepts.length > 0 || step.theorem_tags.length > 0) && (
        <div className="step-card__tags" aria-label="Mathematical tags">
          {step.concepts.slice(0, 3).map((concept) => <span key={concept}><MathText markdown={concept} /></span>)}
          {step.theorem_tags.slice(0, 2).map((theorem) => <span className="is-theorem" key={theorem}><MathText markdown={theorem} /></span>)}
        </div>
      )}

      <footer className="step-card__footer">
        <span className={cx("author-chip", isAgent && "author-chip--agent")}>
          {isAgent ? <Bot /> : <UserRound />}
          {isAgent ? (step.author_agent_name ?? "Agent") : "You"}
        </span>
        <span>{formatRelativeTime(step.updated_at)}</span>
        {pendingDecisionCount > 0 && onOpenPendingDecision && (
          <button
            aria-label={`Review ${pendingDecisionCount} pending human decision${pendingDecisionCount === 1 ? "" : "s"} for ${markdownToPlainText(step.title)}`}
            className="human-checkpoint-chip"
            onClick={(event) => {
              event.stopPropagation();
              onOpenPendingDecision();
            }}
            type="button"
          >
            Your call · {pendingDecisionCount}
          </button>
        )}
        {step.status !== "dead_end" && onMarkDeadEnd && (
          <IconButton
            label="Mark step as dead end"
            onClick={(event) => {
              event.stopPropagation();
              onMarkDeadEnd();
            }}
          >
            <Flag />
          </IconButton>
        )}
        <IconButton label={`Branch from ${markdownToPlainText(step.title)}`} onClick={onBranch}>
          <Split />
        </IconButton>
      </footer>
    </article>
  );
}

function StrategyOrigin({
  onSelectStrategy,
  selected,
  strategy,
}: {
  onSelectStrategy: ((strategyId: string) => void) | undefined;
  selected: boolean;
  strategy: Strategy;
}) {
  const isAgent = strategy.author_type === "agent";
  const isSelectable = Boolean(onSelectStrategy);
  const selectStrategy = () => onSelectStrategy?.(strategy.id);
  const onClick = (event: MouseEvent<HTMLElement>) => {
    const nestedControl = event.target instanceof Element
      ? event.target.closest("a, button, input, select, textarea")
      : null;
    if (nestedControl && !nestedControl.classList.contains("strategy-origin__hit-area")) return;
    selectStrategy();
  };
  const header = (
    <>
      <span className="step-card__topline">
        <span className="strategy-origin__marker step-number">
          <Compass aria-hidden="true" /> Strategy
        </span>
        <StatusBadge status={strategy.status} />
      </span>
      <h4><MathText markdown={strategy.title} /></h4>
    </>
  );

  return (
    <div className="strategy-origin-frame">
      <article
        className="strategy-origin step-card"
        data-board-interactive="true"
        data-strategy-id={strategy.id}
        data-strategy-origin="true"
        onClick={isSelectable ? onClick : undefined}
      >
        {isSelectable && (
          <button
            aria-label={`Strategy ${markdownToPlainText(strategy.title)}. ${strategy.status}`}
            aria-pressed={selected}
            className="strategy-origin__hit-area"
            type="button"
          />
        )}
        <header className="step-card__header">
          <div className="strategy-origin__select step-card__select">{header}</div>
        </header>
        {strategy.description_markdown && (
          <div
            aria-label="Full strategy description"
            className="strategy-origin__description step-card__body"
            data-board-interactive="true"
          >
            <MarkdownMath markdown={strategy.description_markdown} />
          </div>
        )}
        <footer className="step-card__footer">
          <span className={cx("author-chip", isAgent && "author-chip--agent")}>
            {isAgent ? <Bot /> : <UserRound />}
            {isAgent ? (strategy.author_agent_name ?? "Agent") : "You"}
          </span>
          <span>{formatRelativeTime(strategy.updated_at)}</span>
        </footer>
      </article>
    </div>
  );
}

function BranchLead({
  branch,
  forkStep,
  onSelect,
  root,
  selected,
}: {
  branch: Branch;
  forkStep: Step | null;
  onSelect: () => void;
  root: boolean;
  selected: boolean;
}) {
  return (
    <button
      aria-label={`${root ? "Root" : "Alternative"} branch ${markdownToPlainText(branch.name)}. ${branch.status}`}
      aria-pressed={selected}
      className="proof-branch__lead"
      data-board-interactive="true"
      onClick={onSelect}
      type="button"
    >
      <GitBranch aria-hidden="true" />
      <span>
        <b><MathText markdown={branch.name} /></b>
        <small>{root ? "Starting line" : `Alternative after ${forkStep ? `Step ${forkStep.ordinal}` : "this step"}`}</small>
      </span>
      <StatusBadge status={branch.status} />
    </button>
  );
}

interface BranchTrailProps {
  ancestors: ReadonlySet<string>;
  branch: Branch;
  branchIndex: BranchIndex;
  onAddStep: (branchId: string) => void;
  onBranchFromStep: (stepId: string) => void;
  onEditStep: (stepId: string) => void;
  onMarkDeadEnd?: ((stepId: string) => void) | undefined;
  onOpenPendingDecision?: ((stepId: string) => void) | undefined;
  onSelectBranch: (branchId: string) => void;
  onSelectStep: (stepId: string) => void;
  pendingDecisionCountsByStepId: Readonly<Record<string, number>>;
  selectedBranchId: string | null;
  selectedStepId: string | null;
  stepsById: ReadonlyMap<string, Step>;
  root: boolean;
}

interface BranchFlowProps extends Omit<BranchTrailProps, "root"> {
  startIndex: number;
}

function ContinueButton({
  branchId,
  onAddStep,
}: {
  branchId: string;
  onAddStep: (branchId: string) => void;
}) {
  return (
    <button
      className="proof-continue"
      data-board-interactive="true"
      onClick={() => onAddStep(branchId)}
      type="button"
    >
      <Plus aria-hidden="true" /> Continue this line
    </button>
  );
}

function BranchFlow({
  ancestors,
  branch,
  branchIndex,
  onAddStep,
  onBranchFromStep,
  onEditStep,
  onMarkDeadEnd,
  onOpenPendingDecision,
  onSelectBranch,
  onSelectStep,
  pendingDecisionCountsByStepId,
  selectedBranchId,
  selectedStepId,
  startIndex,
  stepsById,
}: BranchFlowProps) {
  const branchSteps = branchIndex.branchSteps.get(branch.id) ?? [];
  const step = branchSteps[startIndex];

  if (!step) {
    return branch.status === "active" ? <ContinueButton branchId={branch.id} onAddStep={onAddStep} /> : null;
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(branch.id);
  const forkChildren = branchIndex.childrenByForkStepId.get(step.id) ?? [];
  const attachedBranches = forkChildren.filter((child) => !nextAncestors.has(child.id));
  const cycleBranches = forkChildren.filter((child) => nextAncestors.has(child.id));
  const hasContinuation = startIndex + 1 < branchSteps.length || branch.status === "active";

  const continuation = (
    <BranchFlow
      ancestors={nextAncestors}
      branch={branch}
      branchIndex={branchIndex}
      onAddStep={onAddStep}
      onBranchFromStep={onBranchFromStep}
      onEditStep={onEditStep}
      onMarkDeadEnd={onMarkDeadEnd}
      onOpenPendingDecision={onOpenPendingDecision}
      onSelectBranch={onSelectBranch}
      onSelectStep={onSelectStep}
      pendingDecisionCountsByStepId={pendingDecisionCountsByStepId}
      selectedBranchId={selectedBranchId}
      selectedStepId={selectedStepId}
      startIndex={startIndex + 1}
      stepsById={stepsById}
    />
  );

  return (
    <div
      className="proof-step"
      data-branch-id={branch.id}
      data-proof-step="true"
      data-source-step-id={step.id}
    >
      {startIndex > 0 && <span className="proof-step__connector" aria-hidden="true" />}
      <StepCard
        onBranch={() => onBranchFromStep(step.id)}
        onEdit={() => onEditStep(step.id)}
        onMarkDeadEnd={onMarkDeadEnd ? () => onMarkDeadEnd(step.id) : undefined}
        onOpenPendingDecision={onOpenPendingDecision ? () => onOpenPendingDecision(step.id) : undefined}
        onSelect={() => onSelectStep(step.id)}
        pendingDecisionCount={pendingDecisionCountsByStepId[step.id] ?? 0}
        selected={selectedStepId === step.id}
        step={step}
      />

      {attachedBranches.length > 0 ? (
        <div className="proof-junction" data-source-step-id={step.id}>
          <span className="proof-junction__connector" aria-hidden="true" />
          <div className="proof-junction__paths">
            {hasContinuation && (
              <div className="proof-junction__path proof-junction__path--continuation" data-branch-id={branch.id}>
                {continuation}
              </div>
            )}
            {attachedBranches.map((child) => (
              <div className="proof-junction__path proof-junction__path--fork" data-branch-id={child.id} key={child.id}>
                <BranchTrail
                  ancestors={nextAncestors}
                  branch={child}
                  branchIndex={branchIndex}
                  onAddStep={onAddStep}
                  onBranchFromStep={onBranchFromStep}
                  onEditStep={onEditStep}
                  onMarkDeadEnd={onMarkDeadEnd}
                  onOpenPendingDecision={onOpenPendingDecision}
                  onSelectBranch={onSelectBranch}
                  onSelectStep={onSelectStep}
                  pendingDecisionCountsByStepId={pendingDecisionCountsByStepId}
                  root={false}
                  selectedBranchId={selectedBranchId}
                  selectedStepId={selectedStepId}
                  stepsById={stepsById}
                />
              </div>
            ))}
          </div>
        </div>
      ) : continuation}

      {cycleBranches.length > 0 && (
        <p className="proof-cycle-notice" role="note">
          This branch points back to an earlier line and is shown at its original fork.
        </p>
      )}
    </div>
  );
}

function BranchTrail({
  ancestors,
  branch,
  branchIndex,
  onAddStep,
  onBranchFromStep,
  onEditStep,
  onMarkDeadEnd,
  onOpenPendingDecision,
  onSelectBranch,
  onSelectStep,
  pendingDecisionCountsByStepId,
  selectedBranchId,
  selectedStepId,
  stepsById,
  root,
}: BranchTrailProps) {
  const branchSteps = branchIndex.branchSteps.get(branch.id) ?? [];
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(branch.id);
  const forkStep = branch.forked_from_step_id ? stepsById.get(branch.forked_from_step_id) ?? null : null;

  return (
    <section
      className={cx("proof-branch", root ? "proof-branch--root" : "proof-branch--fork", selectedBranchId === branch.id && "is-selected")}
      data-branch-id={branch.id}
      data-branch-status={branch.status}
      data-forked-from-step-id={branch.forked_from_step_id ?? undefined}
    >
      <BranchLead
        branch={branch}
        forkStep={forkStep}
        onSelect={() => onSelectBranch(branch.id)}
        root={root}
        selected={selectedBranchId === branch.id}
      />

      <div className="proof-branch__steps">
        {branchSteps.length === 0 ? (
          <button
            className="proof-empty-branch"
            data-board-interactive="true"
            onClick={() => onAddStep(branch.id)}
            type="button"
          >
            <Lightbulb aria-hidden="true" />
            <span><b>Begin this line</b><small>Add the first justified step.</small></span>
            <Plus aria-hidden="true" />
          </button>
        ) : (
          <BranchFlow
            ancestors={nextAncestors}
            branch={branch}
            branchIndex={branchIndex}
            onAddStep={onAddStep}
            onBranchFromStep={onBranchFromStep}
            onEditStep={onEditStep}
            onMarkDeadEnd={onMarkDeadEnd}
            onOpenPendingDecision={onOpenPendingDecision}
            onSelectBranch={onSelectBranch}
            onSelectStep={onSelectStep}
            pendingDecisionCountsByStepId={pendingDecisionCountsByStepId}
            selectedBranchId={selectedBranchId}
            selectedStepId={selectedStepId}
            startIndex={0}
            stepsById={stepsById}
          />
        )}
      </div>
    </section>
  );
}

function StrategyForest({
  branchIndex,
  onAddStep,
  onBranchFromStep,
  onEditStep,
  onMarkDeadEnd,
  onOpenPendingDecision,
  onSelectBranch,
  onSelectStep,
  pendingDecisionCountsByStepId,
  onSelectStrategy,
  selectedBranchId,
  selectedStepId,
  selectedStrategyId,
  strategyRef,
  stepsById,
  strategy,
}: {
  branchIndex: BranchIndex;
  onAddStep: (branchId: string) => void;
  onBranchFromStep: (stepId: string) => void;
  onEditStep: (stepId: string) => void;
  onMarkDeadEnd?: ((stepId: string) => void) | undefined;
  onOpenPendingDecision?: ((stepId: string) => void) | undefined;
  onSelectBranch: (branchId: string) => void;
  onSelectStep: (stepId: string) => void;
  pendingDecisionCountsByStepId: Readonly<Record<string, number>>;
  onSelectStrategy: ((strategyId: string) => void) | undefined;
  selectedBranchId: string | null;
  selectedStepId: string | null;
  selectedStrategyId?: string | null;
  strategyRef: (element: HTMLElement | null) => void;
  stepsById: ReadonlyMap<string, Step>;
  strategy: Strategy;
}) {
  const selected = selectedStrategyId === strategy.id;

  return (
    <section
      className={cx("strategy-forest", selected && "is-selected")}
      data-strategy-id={strategy.id}
      data-strategy-selected={selected ? "true" : "false"}
      ref={strategyRef}
    >
      <StrategyOrigin onSelectStrategy={onSelectStrategy} selected={selected} strategy={strategy} />
      <div className="strategy-roots">
        {branchIndex.roots.map((branch) => (
          <BranchTrail
            ancestors={new Set()}
            branch={branch}
            branchIndex={branchIndex}
            key={branch.id}
            onAddStep={onAddStep}
            onBranchFromStep={onBranchFromStep}
            onEditStep={onEditStep}
            onMarkDeadEnd={onMarkDeadEnd}
            onOpenPendingDecision={onOpenPendingDecision}
            onSelectBranch={onSelectBranch}
            onSelectStep={onSelectStep}
            pendingDecisionCountsByStepId={pendingDecisionCountsByStepId}
            root
            selectedBranchId={selectedBranchId}
            selectedStepId={selectedStepId}
            stepsById={stepsById}
          />
        ))}
        {branchIndex.roots.length === 0 && (
          <p className="strategy-forest__empty">This strategy has no line of reasoning yet.</p>
        )}
      </div>
    </section>
  );
}

export function ReasoningCanvas({
  branches,
  focusMode = false,
  onAddStep,
  onBranchFromStep,
  onEditStep,
  onMarkDeadEnd,
  onOpenPendingDecision,
  onSelectBranch,
  onSelectStep,
  onSelectStrategy,
  selectedBranchId,
  selectedStepId,
  selectedStrategyId = null,
  pendingDecisionCountsByStepId = {},
  steps,
  strategy = null,
  strategies,
}: ReasoningCanvasProps) {
  const visibleStrategies = useMemo(
    () => strategies ?? (strategy ? [strategy] : []),
    [strategies, strategy],
  );
  const strategyElements = useRef(new Map<string, HTMLElement>());
  const { branchIndexesByStrategyId, stepsById } = useMemo(() => {
    const branchesByStrategyId = new Map<string, Branch[]>();
    const indexedStepsByBranchId = new Map<string, Step[]>();
    const indexedStepsById = new Map<string, Step>();

    for (const branch of branches) {
      const strategyBranches = branchesByStrategyId.get(branch.strategy_id) ?? [];
      strategyBranches.push(branch);
      branchesByStrategyId.set(branch.strategy_id, strategyBranches);
    }

    for (const step of steps) {
      const branchSteps = indexedStepsByBranchId.get(step.branch_id) ?? [];
      branchSteps.push(step);
      indexedStepsByBranchId.set(step.branch_id, branchSteps);
      indexedStepsById.set(step.id, step);
    }

    return {
      branchIndexesByStrategyId: new Map(
        visibleStrategies.map((currentStrategy) => [
          currentStrategy.id,
          groupStrategyBranches(
            branchesByStrategyId.get(currentStrategy.id) ?? [],
            indexedStepsByBranchId,
          ),
        ]),
      ),
      stepsById: indexedStepsById,
    };
  }, [branches, steps, visibleStrategies]);
  const addTargetBranchId = selectedBranchId ?? branches[0]?.id ?? null;

  useEffect(() => {
    if (!selectedStrategyId) return;
    strategyElements.current.get(selectedStrategyId)?.scrollIntoView?.({
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    });
  }, [selectedStrategyId]);

  const setStrategyRef = (strategyId: string) => (element: HTMLElement | null) => {
    if (element) {
      strategyElements.current.set(strategyId, element);
    } else {
      strategyElements.current.delete(strategyId);
    }
  };

  if (visibleStrategies.length === 0) {
    return (
      <div
        className={cx("reasoning-canvas", focusMode && "reasoning-canvas--focus")}
        data-focus-mode={focusMode ? "true" : "false"}
        data-reasoning-canvas="true"
      >
        <div className="canvas-empty">
          <span><GitBranch /></span>
          <h2>A strategy gives reasoning a direction.</h2>
          <p>Create one from the sidebar, then develop it step by step.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cx("reasoning-canvas", focusMode && "reasoning-canvas--focus")}
      data-focus-mode={focusMode ? "true" : "false"}
      data-reasoning-canvas="true"
    >
      <header className="canvas-header" data-board-interactive="true">
        <div>
          <span className="canvas-header__kicker">Reasoning board</span>
          <h2>
            {visibleStrategies.length === 1 && visibleStrategies[0]
              ? <MathText markdown={visibleStrategies[0].title} />
              : "Proof forest"}
          </h2>
          <p>Read each line from top to bottom. Alternatives begin at the exact step where the reasoning diverges.</p>
        </div>
        <div className="canvas-header__actions" data-board-interactive="true">
          <span>{visibleStrategies.length} {visibleStrategies.length === 1 ? "strategy" : "strategies"}</span>
          {addTargetBranchId && (
            <button className="proof-continue" onClick={() => onAddStep(addTargetBranchId)} type="button">
              <Plus aria-hidden="true" /> Add step
            </button>
          )}
        </div>
      </header>

      <div className="proof-forest" role="region" aria-label="Reasoning proof forest">
        {visibleStrategies.map((currentStrategy) => (
          <StrategyForest
            branchIndex={branchIndexesByStrategyId.get(currentStrategy.id) ?? {
              branchSteps: new Map(),
              childrenByForkStepId: new Map(),
              roots: [],
            }}
            key={currentStrategy.id}
            onAddStep={onAddStep}
            onBranchFromStep={onBranchFromStep}
            onEditStep={onEditStep}
            onMarkDeadEnd={onMarkDeadEnd}
            onOpenPendingDecision={onOpenPendingDecision}
            onSelectBranch={onSelectBranch}
            onSelectStep={onSelectStep}
            onSelectStrategy={onSelectStrategy}
            pendingDecisionCountsByStepId={pendingDecisionCountsByStepId}
            selectedBranchId={selectedBranchId}
            selectedStepId={selectedStepId}
            selectedStrategyId={selectedStrategyId}
            strategyRef={setStrategyRef(currentStrategy.id)}
            stepsById={stepsById}
            strategy={currentStrategy}
          />
        ))}
      </div>
    </div>
  );
}
