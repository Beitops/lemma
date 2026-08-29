import type { Strategy } from "@lemma/contracts";
import {
  Bot,
  Clock3,
  Compass,
  PanelRightClose,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { markdownToPlainText } from "../../../lib/markdownToPlainText";
import { MarkdownMath, MathText } from "../../../components/MarkdownMath";
import { IconButton, StatusBadge } from "../../../components/Primitives";
import { cx, formatRelativeTime } from "../../../lib/ui";

export interface StrategyInspectorProps {
  onClose: () => void;
  presentation?: "column" | "focus";
  strategy: Strategy | null;
}

/**
 * The strategy counterpart to StepInspector. It intentionally presents only
 * persisted strategy information: the route itself, its lifecycle, and its
 * provenance. Steps and branch outcomes remain inspectable from their own
 * graph nodes so the two panels do not duplicate graph state.
 */
export function StrategyInspector({
  onClose,
  presentation = "column",
  strategy,
}: StrategyInspectorProps) {
  if (!strategy) return null;

  const isAgent = strategy.author_type === "agent";

  return (
    <aside
      aria-label={`Inspect strategy ${markdownToPlainText(strategy.title)}`}
      className={cx(
        "strategy-inspector",
        // Keep the shared inspector layout contract while the two inspectors
        // use the same column/focus shell.
        "step-inspector",
        presentation === "focus" && "strategy-inspector--focus step-inspector--focus",
      )}
      data-inspector-presentation={presentation}
      data-workspace-inspector="true"
    >
      <header className="inspector-header strategy-inspector__header">
        <div>
          <span>Strategy</span>
          <h2><MathText markdown={strategy.title} /></h2>
        </div>
        <IconButton label="Close strategy inspector" onClick={onClose}><PanelRightClose /></IconButton>
      </header>

      <div className="inspector-scroll">
        <div className="inspector-meta-row">
          <StatusBadge status={strategy.status} />
          <span><Clock3 /> {formatRelativeTime(strategy.updated_at)}</span>
          <span>rev {strategy.revision}</span>
        </div>

        <section className="inspector-section inspector-section--body strategy-inspector__description">
          <div className="strategy-inspector__section-heading">
            <Compass aria-hidden="true" />
            <h3>Approach</h3>
          </div>
          {strategy.description_markdown ? (
            <MarkdownMath markdown={strategy.description_markdown} />
          ) : (
            <p className="inspector-muted">No strategy description has been recorded yet.</p>
          )}
        </section>

        <section className="provenance-card strategy-inspector__provenance">
          <span className={`provenance-card__avatar ${isAgent ? "is-agent" : ""}`}>
            {isAgent ? <Bot /> : <UserRound />}
          </span>
          <div>
            <span>Contributed by</span>
            <b>{isAgent ? (strategy.author_agent_name ?? "Agent") : "You"}</b>
            <small>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(strategy.created_at))}</small>
          </div>
          <ShieldCheck aria-label="Provenance recorded" />
        </section>
      </div>
    </aside>
  );
}
