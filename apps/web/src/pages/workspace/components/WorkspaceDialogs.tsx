import type {
  Branch,
  BranchComparison,
  CleanSolution,
  ContextItem,
  ReasoningResult,
  Step,
  Strategy,
} from "@lemma/contracts";
import {
  ArrowRight,
  BookOpenText,
  Check,
  Clipboard,
  Download,
  ExternalLink,
  FileUp,
  Flag,
  GitCompareArrows,
  GitFork,
  Link2,
  Plus,
  Sparkles,
  Target,
  Type,
} from "lucide-react";
import { MarkdownMath, MathText } from "../../../components/MarkdownMath";
import { Button, Modal } from "../../../components/Primitives";
import { markdownToPlainText } from "../../../lib/markdownToPlainText";
import { cx } from "../../../lib/ui";

export interface StrategyDraft {
  description_markdown: string;
  root_branch_name: string;
  title: string;
}

export interface StepDraft {
  body_markdown: string;
  concepts: string;
  status: "active" | "draft";
  summary: string;
  theorem_tags: string;
  title: string;
}

export interface BranchDraft {
  name: string;
}

export interface AssumptionDraft {
  label: string;
  note_markdown: string;
  statement_markdown: string;
  status: "proposed" | "accepted" | "challenged";
  usage_kind: "introduced" | "used" | "challenged";
}

export interface ContextDraft {
  body_markdown: string;
  file: File | null;
  mode: "text" | "link" | "file";
  objective_id: string | null;
  objective_title: string;
  scope: "workspace" | "objective";
  source_url: string;
  title: string;
}

export interface ObjectiveDraft {
  constraints_markdown: string;
  objective_markdown: string;
  title: string;
}

export interface ResultDraft {
  outcome_status: "successful" | "unsuccessful" | "inconclusive";
  result_markdown: string;
  target_id: string;
  target_type: "strategy" | "branch";
}

interface ObjectiveDialogProps {
  busy: boolean;
  draft: ObjectiveDraft;
  editing: boolean;
  onChange: (field: keyof ObjectiveDraft, value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  open: boolean;
}

export function ObjectiveDialog({ busy, draft, editing, onChange, onClose, onSubmit, open }: ObjectiveDialogProps) {
  return (
    <Modal
      description={editing
        ? "Revise this objective without affecting the other boards in the workspace."
        : "Each objective gets its own strategies, branches, steps, and specific context."}
      onClose={onClose}
      open={open}
      title={editing ? "Edit objective" : "Add objective"}
      wide
    >
      <form className="stack-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <label>
          <span>Objective title</span>
          <input autoFocus data-autofocus maxLength={240} onChange={(event) => onChange("title", event.target.value)} placeholder="e.g. Classify primitive Pythagorean triples" required value={draft.title} />
        </label>
        <label>
          <span>Objective in Markdown + TeX</span>
          <textarea
            className="math-editor"
            maxLength={100_000}
            onChange={(event) => onChange("objective_markdown", event.target.value)}
            placeholder="State the mathematical problem or outcome to establish."
            required
            rows={8}
            value={draft.objective_markdown}
          />
        </label>
        <label>
          <span>Constraints & preferences <em>optional</em></span>
          <textarea maxLength={50_000} onChange={(event) => onChange("constraints_markdown", event.target.value)} placeholder="Methods to prefer or avoid, assumptions, presentation constraints…" rows={4} value={draft.constraints_markdown} />
        </label>
        <div className="modal__actions">
          <Button onClick={onClose} tone="ghost">Cancel</Button>
          <Button busy={busy} icon={<Target />} type="submit">{editing ? "Save objective" : "Create objective"}</Button>
        </div>
      </form>
    </Modal>
  );
}

interface StrategyDialogProps {
  busy: boolean;
  draft: StrategyDraft;
  onChange: (field: keyof StrategyDraft, value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  open: boolean;
}

export function StrategyDialog({ busy, draft, onChange, onClose, onSubmit, open }: StrategyDialogProps) {
  return (
    <Modal description="A strategy is an approach. Lemma creates its root branch atomically." onClose={onClose} open={open} title="Add a strategy">
      <form className="stack-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <label>
          <span>Strategy title</span>
          <input autoFocus data-autofocus maxLength={240} onChange={(event) => onChange("title", event.target.value)} placeholder="e.g. Use the extremal principle" required value={draft.title} />
        </label>
        <label>
          <span>Why this approach?</span>
          <textarea maxLength={100_000} onChange={(event) => onChange("description_markdown", event.target.value)} placeholder="Capture the intuition, advantages, or tradeoffs of this route." rows={5} value={draft.description_markdown} />
        </label>
        <label>
          <span>Root branch name</span>
          <input maxLength={160} onChange={(event) => onChange("root_branch_name", event.target.value)} placeholder="Main line" required value={draft.root_branch_name} />
        </label>
        <div className="modal__actions">
          <Button onClick={onClose} tone="ghost">Cancel</Button>
          <Button busy={busy} icon={<Plus />} type="submit">Create strategy</Button>
        </div>
      </form>
    </Modal>
  );
}

interface StepDialogProps {
  branchName: string;
  busy: boolean;
  draft: StepDraft;
  editing: boolean;
  onChange: (field: keyof StepDraft, value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  open: boolean;
}

export function StepDialog({ branchName, busy, draft, editing, onChange, onClose, onSubmit, open }: StepDialogProps) {
  return (
    <Modal
      description={editing
        ? "The previous revision remains inspectable."
        : <>Continue the “<MathText markdown={branchName} />” branch with a justified move.</>}
      onClose={onClose}
      open={open}
      title={editing ? "Revise step" : "Add a reasoning step"}
      wide
    >
      <form className="step-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <div className="form-grid form-grid--step-head">
          <label>
            <span>Step title</span>
            <input autoFocus data-autofocus maxLength={240} onChange={(event) => onChange("title", event.target.value)} placeholder="Name the mathematical move" required value={draft.title} />
          </label>
          <label>
            <span>Status</span>
            <select onChange={(event) => onChange("status", event.target.value)} value={draft.status}>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
            </select>
          </label>
        </div>
        <label>
          <span>Reasoning in Markdown + TeX</span>
          <textarea
            className="math-editor"
            maxLength={200_000}
            onChange={(event) => onChange("body_markdown", event.target.value)}
            placeholder={"Explain why this step follows. Use $x^2$ inline or $$\\int_a^b f(x)\\,dx$$ for display math."}
            required
            rows={9}
            value={draft.body_markdown}
          />
        </label>
        <div className="form-grid form-grid--two">
          <label>
            <span>Compact summary <em>optional</em></span>
            <input maxLength={2_000} onChange={(event) => onChange("summary", event.target.value)} placeholder="One sentence for the graph card" value={draft.summary} />
          </label>
          <label>
            <span>Concepts <em>comma-separated</em></span>
            <input onChange={(event) => onChange("concepts", event.target.value)} placeholder="compactness, contradiction" value={draft.concepts} />
          </label>
        </div>
        <label>
          <span>Theorems <em>comma-separated</em></span>
          <input onChange={(event) => onChange("theorem_tags", event.target.value)} placeholder="Bolzano–Weierstrass" value={draft.theorem_tags} />
        </label>
        <div className="modal__actions">
          <span className="form-hint"><Check /> Markdown is stored; HTML is never accepted.</span>
          <Button onClick={onClose} tone="ghost">Cancel</Button>
          <Button busy={busy} icon={editing ? <Clipboard /> : <ArrowRight />} type="submit">{editing ? "Save revision" : "Add step"}</Button>
        </div>
      </form>
    </Modal>
  );
}

interface BranchDialogProps {
  busy: boolean;
  draft: BranchDraft;
  forkStep: Step | null;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  open: boolean;
}

export function BranchDialog({ busy, draft, forkStep, onChange, onClose, onSubmit, open }: BranchDialogProps) {
  return (
    <Modal description="The original branch and all of its history remain untouched." onClose={onClose} open={open} title="Branch from this step">
      <form className="stack-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        {forkStep && (
          <div className="fork-preview">
            <GitFork />
            <div><span>Fork point · step {forkStep.ordinal}</span><b><MathText markdown={forkStep.title} /></b></div>
          </div>
        )}
        <label>
          <span>New branch name</span>
          <input autoFocus data-autofocus maxLength={160} onChange={(event) => onChange(event.target.value)} placeholder="Alternative via contradiction" required value={draft.name} />
        </label>
        <div className="modal__actions">
          <Button onClick={onClose} tone="ghost">Cancel</Button>
          <Button busy={busy} icon={<GitFork />} type="submit">Create branch</Button>
        </div>
      </form>
    </Modal>
  );
}

interface AssumptionDialogProps {
  busy: boolean;
  draft: AssumptionDraft;
  onChange: (field: keyof AssumptionDraft, value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  open: boolean;
}

export function AssumptionDialog({ busy, draft, onChange, onClose, onSubmit, open }: AssumptionDialogProps) {
  return (
    <Modal description="First-class assumptions make dependent conclusions queryable." onClose={onClose} open={open} title="Mark an assumption">
      <form className="stack-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <label><span>Short label</span><input autoFocus data-autofocus maxLength={160} onChange={(event) => onChange("label", event.target.value)} placeholder="Continuity on the closed interval" required value={draft.label} /></label>
        <label><span>Statement</span><textarea maxLength={100_000} onChange={(event) => onChange("statement_markdown", event.target.value)} placeholder="State the assumption precisely in Markdown + TeX." required rows={5} value={draft.statement_markdown} /></label>
        <div className="form-grid form-grid--two">
          <label><span>How this step uses it</span><select onChange={(event) => onChange("usage_kind", event.target.value)} value={draft.usage_kind}><option value="introduced">Introduced</option><option value="used">Used</option><option value="challenged">Challenged</option></select></label>
          <label><span>Status</span><select onChange={(event) => onChange("status", event.target.value)} value={draft.status}><option value="proposed">Proposed</option><option value="accepted">Accepted</option><option value="challenged">Challenged</option></select></label>
        </div>
        <label><span>Note <em>optional</em></span><textarea onChange={(event) => onChange("note_markdown", event.target.value)} rows={3} value={draft.note_markdown} /></label>
        <div className="modal__actions"><Button onClick={onClose} tone="ghost">Cancel</Button><Button busy={busy} icon={<Sparkles />} type="submit">Attach assumption</Button></div>
      </form>
    </Modal>
  );
}

interface ContextDialogProps {
  busy: boolean;
  draft: ContextDraft;
  onChange: (field: keyof ContextDraft, value: File | null | string) => void;
  onClose: () => void;
  onSubmit: () => void;
  open: boolean;
}

export function ContextDialog({ busy, draft, onChange, onClose, onSubmit, open }: ContextDialogProps) {
  return (
    <Modal description="Choose whether this material is shared by every objective or only the objective selected when this draft was opened." onClose={onClose} open={open} title="Add context" wide>
      <form className="stack-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <fieldset className="context-scope-picker">
          <legend>Context scope</legend>
          <label>
            <input checked={draft.scope === "workspace"} name="context-scope" onChange={() => onChange("scope", "workspace")} type="radio" />
            <span><b>General workspace</b><small>Available to every objective in this workspace.</small></span>
          </label>
          <label>
            <input checked={draft.scope === "objective"} disabled={!draft.objective_id} name="context-scope" onChange={() => onChange("scope", "objective")} type="radio" />
            <span>
              <b>Specific objective</b>
              <small>{draft.objective_title ? <>Only “<MathText markdown={draft.objective_title} />” can use it.</> : "Select an objective before adding specific context."}</small>
            </span>
          </label>
        </fieldset>
        <div className="context-mode-tabs" role="tablist" aria-label="Context type">
          {([['text', Type, 'Text or note'], ['link', Link2, 'Link'], ['file', FileUp, 'File upload']] as const).map(([mode, Icon, label]) => (
            <button aria-selected={draft.mode === mode} className={cx(draft.mode === mode && "is-active")} key={mode} onClick={() => onChange("mode", mode)} role="tab" type="button"><Icon />{label}</button>
          ))}
        </div>
        <label><span>Title</span><input autoFocus data-autofocus maxLength={240} onChange={(event) => onChange("title", event.target.value)} placeholder="A useful, specific label" required value={draft.title} /></label>
        {draft.mode === "text" && <label><span>Text or Markdown</span><textarea maxLength={200_000} onChange={(event) => onChange("body_markdown", event.target.value)} placeholder="Paste definitions, notes, a problem statement, or a relevant excerpt." required rows={9} value={draft.body_markdown} /></label>}
        {draft.mode === "link" && <label><span>URL</span><input onChange={(event) => onChange("source_url", event.target.value)} placeholder="https://…" required type="url" value={draft.source_url} /></label>}
        {draft.mode === "file" && (
          <label className="file-drop">
            <FileUp />
            <b>{draft.file?.name ?? "Choose a PDF or image"}</b>
            <span>PDF, PNG, JPEG, or WebP · max 50 MB</span>
            <input accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => onChange("file", event.target.files?.[0] ?? null)} required type="file" />
          </label>
        )}
        <div className="modal__actions"><Button onClick={onClose} tone="ghost">Cancel</Button><Button busy={busy} icon={<Plus />} type="submit">Add context</Button></div>
      </form>
    </Modal>
  );
}

interface ContextItemDialogProps {
  item: ContextItem | null;
  onClose: () => void;
  onDownload: (contextItemId: string) => void;
  onOpenLink: (contextItemId: string) => void;
  open: boolean;
}

export function ContextItemDialog({
  item,
  onClose,
  onDownload,
  onOpenLink,
  open,
}: ContextItemDialogProps) {
  return (
    <Modal
      description={item ? `${item.kind} context · ${item.processing_status}` : "Workspace context"}
      onClose={onClose}
      open={open}
      title={item ? <MathText markdown={item.title} /> : "Context item"}
      wide
    >
      {item && (
        <div className="context-viewer">
          {item.body_markdown ? (
            <MarkdownMath markdown={item.body_markdown} />
          ) : (
            <div className="context-viewer__empty">
              <FileUp />
              <p>This item has no extracted text. Open the original source to inspect it.</p>
            </div>
          )}
          <dl>
            <div><dt>Type</dt><dd>{item.kind}</dd></div>
            {item.mime_type && <div><dt>Format</dt><dd>{item.mime_type}</dd></div>}
            {item.size_bytes !== null && <div><dt>Size</dt><dd>{new Intl.NumberFormat("en", { style: "unit", unit: "byte", unitDisplay: "narrow" }).format(item.size_bytes)}</dd></div>}
            <div><dt>Revision</dt><dd>{item.revision}</dd></div>
          </dl>
          {(item.storage_path || item.source_url) && (
            <div className="modal__actions">
              {item.source_url && <Button icon={<ExternalLink />} onClick={() => onOpenLink(item.id)} tone="secondary">Open source</Button>}
              {item.storage_path && <Button icon={<Download />} onClick={() => onDownload(item.id)}>Open file</Button>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

interface CompareDialogProps {
  branches: Branch[];
  busy: boolean;
  comparison: BranchComparison | null;
  onBranchAChange: (branchId: string) => void;
  onBranchBChange: (branchId: string) => void;
  onClose: () => void;
  onCompare: () => void;
  open: boolean;
  selectedA: string;
  selectedB: string;
}

export function CompareDialog({ branches, busy, comparison, onBranchAChange, onBranchBChange, onClose, onCompare, open, selectedA, selectedB }: CompareDialogProps) {
  return (
    <Modal description="See shared history and the exact point where two paths diverge." onClose={onClose} open={open} title="Compare branches" wide>
      <div className="compare-controls">
        <label><span>Branch A</span><select onChange={(event) => onBranchAChange(event.target.value)} value={selectedA}><option value="">Choose a branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{markdownToPlainText(branch.name)}</option>)}</select></label>
        <GitCompareArrows />
        <label><span>Branch B</span><select onChange={(event) => onBranchBChange(event.target.value)} value={selectedB}><option value="">Choose a branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{markdownToPlainText(branch.name)}</option>)}</select></label>
        <Button busy={busy} onClick={onCompare}>Compare</Button>
      </div>
      {comparison ? (
        <div className="comparison-grid">
          <ComparisonColumn items={comparison.only_branch_a} label="Only in branch A" />
          <ComparisonColumn items={comparison.common_steps} label="Shared path" shared />
          <ComparisonColumn items={comparison.only_branch_b} label="Only in branch B" />
        </div>
      ) : <div className="comparison-placeholder"><GitCompareArrows /><p>Select two branches to inspect their structural difference.</p></div>}
    </Modal>
  );
}

function ComparisonColumn({ items, label, shared = false }: { items: Array<{ status: string; step_id: string; title: string }>; label: string; shared?: boolean }) {
  return <section className={cx("comparison-column", shared && "is-shared")}><h3>{label}<span>{items.length}</span></h3>{items.length === 0 ? <p>No steps</p> : items.map((item, index) => <div className="comparison-step" key={item.step_id}><span>{index + 1}</span><div><b><MathText markdown={item.title} /></b><small>{item.status}</small></div></div>)}</section>;
}

interface CleanSolutionDialogProps {
  busy: boolean;
  onClose: () => void;
  onCopy: () => void;
  onGenerate: () => void;
  onSave: () => void;
  open: boolean;
  solution: CleanSolution | null;
}

export function CleanSolutionDialog({ busy, onClose, onCopy, onGenerate, onSave, open, solution }: CleanSolutionDialogProps) {
  return (
    <Modal description="A clean projection of one branch. The reasoning graph remains untouched." onClose={onClose} open={open} title="Clean solution" wide>
      {!solution ? <div className="clean-placeholder"><BookOpenText /><h3>Project the selected branch</h3><p>Draft and dead-end steps are omitted. Branch history is never deleted.</p><Button busy={busy} icon={<Sparkles />} onClick={onGenerate}>Generate solution</Button></div> : <div className="clean-solution"><div className="clean-solution__toolbar"><span>{solution.step_count} active steps · branch revision {solution.branch_revision}</span><div><Button icon={<Clipboard />} onClick={onCopy} tone="ghost">Copy Markdown</Button><Button busy={busy} icon={<Sparkles />} onClick={onSave}>Save snapshot</Button></div></div><MarkdownMath markdown={solution.body_markdown} /></div>}
    </Modal>
  );
}

interface ResultDialogProps {
  branches: Branch[];
  busy: boolean;
  draft: ResultDraft;
  existingResult: ReasoningResult | null;
  onChange: (field: keyof ResultDraft, value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  open: boolean;
  strategies: Strategy[];
}

export function ResultDialog({
  branches,
  busy,
  draft,
  existingResult,
  onChange,
  onClose,
  onSubmit,
  open,
  strategies,
}: ResultDialogProps) {
  const targets = draft.target_type === "branch" ? branches : strategies;
  const target = targets.find((item) => item.id === draft.target_id) ?? null;
  const editing = existingResult !== null;

  return (
    <Modal
      description="Record the outcome of one branch or a strategy summary. It does not complete, delete, or hide any reasoning path."
      onClose={onClose}
      open={open}
      title={editing ? "Edit outcome" : "Record outcome"}
      wide
    >
      <form className="stack-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <div className="form-grid form-grid--two">
          <label>
            <span>Attach outcome to</span>
            <select onChange={(event) => onChange("target_type", event.target.value)} value={draft.target_type}>
              <option value="branch">One branch</option>
              <option value="strategy">Whole strategy</option>
            </select>
          </label>
          <label>
            <span>{draft.target_type === "branch" ? "Branch" : "Strategy"}</span>
            <select onChange={(event) => onChange("target_id", event.target.value)} required value={draft.target_id}>
              <option value="">Choose {draft.target_type === "branch" ? "a branch" : "a strategy"}</option>
              {targets.map((item) => <option key={item.id} value={item.id}>{markdownToPlainText("name" in item ? item.name : item.title)}</option>)}
            </select>
          </label>
        </div>
        {target && (
          <div className="fork-preview">
            <Flag />
            <div>
              <span>{draft.target_type} · revision {target.revision}</span>
              <b><MathText markdown={"name" in target ? target.name : target.title} /></b>
            </div>
          </div>
        )}
        <label>
          <span>Outcome</span>
          <select onChange={(event) => onChange("outcome_status", event.target.value)} value={draft.outcome_status}>
            <option value="successful">Successful</option>
            <option value="unsuccessful">Unsuccessful</option>
            <option value="inconclusive">Inconclusive</option>
          </select>
        </label>
        <label>
          <span>Outcome in Markdown + TeX</span>
          <textarea
            autoFocus
            data-autofocus
            className="math-editor"
            maxLength={100_000}
            onChange={(event) => onChange("result_markdown", event.target.value)}
            placeholder="State what this route established, failed to establish, or leaves unresolved."
            required
            rows={8}
            value={draft.result_markdown}
          />
        </label>
        <div className="result-note">
          <Check />
          <span>
            <b>Inspectable, revision-checked outcome</b>
            A failed or inconclusive path can still retain its result without being marked complete.
          </span>
        </div>
        <div className="modal__actions">
          <Button onClick={onClose} tone="ghost">Cancel</Button>
          <Button busy={busy} icon={<Check />} type="submit">
            {editing ? "Save outcome revision" : "Record outcome"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
