import type { DecisionInboxItem, ResolutionOutcome } from "@lemma/contracts";
import { Check, CornerDownRight, GitBranch, Route, Target } from "lucide-react";
import type { ReactNode } from "react";
import { MarkdownMath, MathText } from "../../../components/MarkdownMath";
import { Button, Modal } from "../../../components/Primitives";

export interface DecisionTargetBreadcrumb {
  branchName: string | null;
  objectiveTitle: string | null;
  stepTitle: string | null;
  strategyTitle: string | null;
}

interface DecisionCheckpointDialogProps {
  busy: boolean;
  decision: DecisionInboxItem | null;
  onClose: () => void;
  onOutcomeChange: (outcome: ResolutionOutcome) => void;
  onResolutionMarkdownChange: (value: string) => void;
  onResolve: () => void;
  open: boolean;
  outcome: ResolutionOutcome;
  resolutionMarkdown: string;
  target: DecisionTargetBreadcrumb | null;
}

function Breadcrumb({ target }: { target: DecisionTargetBreadcrumb | null }) {
  const segments: Array<{ icon: ReactNode; label: string }> = [];
  if (target?.objectiveTitle) segments.push({ icon: <Target />, label: target.objectiveTitle });
  if (target?.strategyTitle) segments.push({ icon: <Route />, label: target.strategyTitle });
  if (target?.branchName) segments.push({ icon: <GitBranch />, label: target.branchName });
  if (target?.stepTitle) segments.push({ icon: <CornerDownRight />, label: target.stepTitle });

  return (
    <nav aria-label="Decision target" className="decision-checkpoint__breadcrumb">
      {segments.length > 0 ? segments.map((segment, index) => (
        <span key={`${segment.label}:${index}`}>
          {index > 0 && <b aria-hidden="true">/</b>}
          {segment.icon}<MathText markdown={segment.label} />
        </span>
      )) : <span>Workspace checkpoint</span>}
    </nav>
  );
}

export function DecisionCheckpointDialog({
  busy,
  decision,
  onClose,
  onOutcomeChange,
  onResolutionMarkdownChange,
  onResolve,
  open,
  outcome,
  resolutionMarkdown,
  target,
}: DecisionCheckpointDialogProps) {
  const redirecting = outcome === "redirected";
  const canResolve = !redirecting || resolutionMarkdown.trim().length > 0;

  return (
    <Modal
      description="The agent is waiting for your research judgment. Saving records it in the shared graph; it does not automatically resume the agent."
      onClose={onClose}
      open={open && decision !== null}
      title="Your call"
    >
      {decision && (
        <form
          className="stack-form decision-checkpoint"
          onSubmit={(event) => {
            event.preventDefault();
            if (canResolve) onResolve();
          }}
        >
          <Breadcrumb target={target} />

          <section aria-label="Agent question" className="decision-checkpoint__question">
            <span>Agent checkpoint</span>
            <MarkdownMath markdown={decision.decision.question_markdown} />
          </section>

          <fieldset className="decision-checkpoint__outcomes">
            <legend>How should this line continue?</legend>
            <label className={outcome === "accepted" ? "is-selected" : undefined}>
              <input
                checked={outcome === "accepted"}
                name="decision-outcome"
                onChange={() => onOutcomeChange("accepted")}
                type="radio"
                value="accepted"
              />
              <span><Check aria-hidden="true" /><b>Continue as proposed</b><small>Accept the agent&apos;s current direction.</small></span>
            </label>
            <label className={outcome === "redirected" ? "is-selected" : undefined}>
              <input
                checked={outcome === "redirected"}
                name="decision-outcome"
                onChange={() => onOutcomeChange("redirected")}
                type="radio"
                value="redirected"
              />
              <span><CornerDownRight aria-hidden="true" /><b>Redirect agent</b><small>Give a new direction, constraint, or question.</small></span>
            </label>
          </fieldset>

          <label className="decision-checkpoint__guidance">
            <span>{redirecting ? "Guidance for the agent" : "Optional note for the agent"}{redirecting && <em>required</em>}</span>
            <textarea
              autoFocus
              data-autofocus
              maxLength={100_000}
              onChange={(event) => onResolutionMarkdownChange(event.target.value)}
              placeholder={redirecting
                ? "Explain what to investigate or change next…"
                : "Add any caveat or acceptance criterion…"}
              required={redirecting}
              rows={5}
              value={resolutionMarkdown}
            />
          </label>

          <div className="modal__actions">
            <Button onClick={onClose} tone="ghost">Close without resolving</Button>
            <Button busy={busy} disabled={!canResolve} icon={redirecting ? <CornerDownRight /> : <Check />} type="submit">
              {redirecting ? "Save redirection" : "Continue as proposed"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
