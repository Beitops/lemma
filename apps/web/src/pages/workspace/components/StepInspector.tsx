import type {
  ActivityEvent,
  Assumption,
  Source,
  Step,
  StepDependency,
  StepSource,
} from "@lemma/contracts";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BookMarked,
  Bot,
  Clock3,
  Flag,
  PanelRightClose,
  Plus,
  ShieldCheck,
  Workflow,
  UserRound,
} from "lucide-react";
import { markdownToPlainText } from "../../../lib/markdownToPlainText";
import { MarkdownMath, MathText } from "../../../components/MarkdownMath";
import { IconButton, StatusBadge } from "../../../components/Primitives";
import { cx, formatRelativeTime } from "../../../lib/ui";

interface StepInspectorProps {
  activityEvents: ActivityEvent[];
  assumptions: Assumption[];
  dependencies: Array<{
    dependency: StepDependency;
    direction: "depends_on" | "used_by";
    relatedStep: Step;
  }>;
  onClose: () => void;
  onMarkAssumption: (stepId: string) => void;
  onMarkDeadEnd: (stepId: string) => void;
  presentation?: "column" | "focus";
  sources: Array<{ relation: StepSource; source: Source }>;
  step: Step | null;
}

export function StepInspector({
  activityEvents,
  assumptions,
  dependencies,
  onClose,
  onMarkAssumption,
  onMarkDeadEnd,
  presentation = "column",
  sources,
  step,
}: StepInspectorProps) {
  if (!step) return null;

  const isAgent = step.author_type === "agent";

  return (
    <aside
      aria-label={`Inspect ${markdownToPlainText(step.title)}`}
      className={cx("step-inspector", presentation === "focus" && "step-inspector--focus")}
      data-inspector-presentation={presentation}
      data-workspace-inspector="true"
    >
      <header className="inspector-header">
        <div>
          <span>Step {String(step.ordinal).padStart(2, "0")}</span>
          <h2><MathText markdown={step.title} /></h2>
        </div>
        <IconButton label="Close step inspector" onClick={onClose}><PanelRightClose /></IconButton>
      </header>

      <div className="inspector-scroll">
        <div className="inspector-meta-row">
          <StatusBadge status={step.status} />
          <span><Clock3 /> {formatRelativeTime(step.updated_at)}</span>
          <span>rev {step.revision}</span>
        </div>

        <section className="inspector-section inspector-section--body">
          <MarkdownMath markdown={step.body_markdown} />
        </section>

        <section className="provenance-card">
          <span className={`provenance-card__avatar ${isAgent ? "is-agent" : ""}`}>
            {isAgent ? <Bot /> : <UserRound />}
          </span>
          <div>
            <span>Contributed by</span>
            <b>{isAgent ? (step.author_agent_name ?? "Agent") : "You"}</b>
            <small>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(step.created_at))}</small>
          </div>
          <ShieldCheck aria-label="Provenance recorded" />
        </section>

        {(step.concepts.length > 0 || step.theorem_tags.length > 0) && (
          <section className="inspector-section">
            <h3>Semantic tags</h3>
            <div className="semantic-tags">
              {step.concepts.map((concept) => <span key={concept}><MathText markdown={concept} /></span>)}
              {step.theorem_tags.map((theorem) => <span className="is-theorem" key={theorem}><MathText markdown={theorem} /></span>)}
            </div>
          </section>
        )}

        <section className="inspector-section">
          <div className="inspector-section__heading">
            <h3>Graph dependencies</h3>
            <Workflow aria-hidden="true" />
          </div>
          {dependencies.length === 0 ? (
            <p className="inspector-muted">No explicit dependency edges touch this step.</p>
          ) : dependencies.map(({ dependency, direction, relatedStep }) => (
            <div className="dependency-row" key={dependency.id}>
              {direction === "depends_on" ? <ArrowDownLeft /> : <ArrowUpRight />}
              <div>
                <span>{direction === "depends_on" ? "Depends on" : "Used by"} · {dependency.relation_kind.replaceAll("_", " ")}</span>
                <b><MathText markdown={relatedStep.title} /></b>
                {dependency.rationale_markdown && <MarkdownMath compact markdown={dependency.rationale_markdown} />}
              </div>
            </div>
          ))}
        </section>

        <section className="inspector-section">
          <div className="inspector-section__heading">
            <h3>Sources & citations</h3>
            <BookMarked aria-hidden="true" />
          </div>
          {sources.length === 0 ? (
            <p className="inspector-muted">No explicit sources are attached to this step.</p>
          ) : sources.map(({ relation, source }) => (
            <div className="source-row" key={relation.id}>
              <BookMarked />
              <div>
                <b><MathText markdown={source.title} /></b>
                <span>{source.kind}{relation.locator ? ` · ${relation.locator}` : ""}</span>
                {source.citation_text && <MarkdownMath compact markdown={source.citation_text} />}
                {relation.note_markdown && <MarkdownMath compact markdown={relation.note_markdown} />}
              </div>
              {source.source_url && <a aria-label={`Open ${markdownToPlainText(source.title)}`} href={source.source_url} rel="noreferrer" target="_blank"><ArrowUpRight /></a>}
            </div>
          ))}
        </section>

        <section className="inspector-section">
          <div className="inspector-section__heading">
            <h3>Assumptions</h3>
            <button onClick={() => onMarkAssumption(step.id)} type="button"><Plus /> Add</button>
          </div>
          {assumptions.length === 0 ? (
            <p className="inspector-muted">No explicit assumptions are attached to this step.</p>
          ) : assumptions.map((assumption) => (
            <div className="assumption-row" key={assumption.id}>
              <MathText markdown={assumption.label} />
              <StatusBadge status={assumption.status} />
              <MarkdownMath compact markdown={assumption.statement_markdown} />
            </div>
          ))}
        </section>

        <section className="inspector-section">
          <h3>Recent activity</h3>
          {activityEvents.length === 0 ? (
            <p className="inspector-muted inspector-muted--spaced">No activity has been recorded for this step.</p>
          ) : activityEvents.map((event) => (
            <div className="activity-row" key={event.id}>
              <span />
              <div>
                <b>{event.event_type.replaceAll("_", " ")}</b>
                <small>{event.actor_type === "agent" ? (event.actor_agent_name ?? "Agent") : event.actor_type} · {formatRelativeTime(event.created_at)}</small>
              </div>
            </div>
          ))}
        </section>
      </div>

      <footer className="inspector-actions">
        {step.status !== "dead_end" && (
          <button className="danger-text-action" onClick={() => onMarkDeadEnd(step.id)} type="button">
            <Flag /> Mark as dead end
          </button>
        )}
        {step.status === "dead_end" && (
          <span className="dead-end-note"><AlertTriangle /> This path is preserved as a dead end.</span>
        )}
      </footer>
    </aside>
  );
}
