import {
  ArrowRight,
  Bot,
  Check,
  Eye,
  EyeOff,
  GitBranch,
  LockKeyhole,
  Mail,
  UserRound,
} from "lucide-react";
import { Brand } from "../../components/Brand";
import { MarkdownMath } from "../../components/MarkdownMath";
import { Button } from "../../components/Primitives";

export type AuthMode = "login" | "register";

export interface AuthDraft {
  email: string;
  password: string;
}

interface AuthPageProps {
  busy: boolean;
  draft: AuthDraft;
  error: string | null;
  mode: AuthMode;
  notice: string | null;
  onChange: (field: keyof AuthDraft, value: string) => void;
  onModeChange: (mode: AuthMode) => void;
  onSubmit: () => void;
  onTogglePassword: () => void;
  passwordVisible: boolean;
}

export function AuthPage({
  busy,
  draft,
  error,
  mode,
  notice,
  onChange,
  onModeChange,
  onSubmit,
  onTogglePassword,
  passwordVisible,
}: AuthPageProps) {
  const isLogin = mode === "login";

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Brand />

        <div className="auth-panel__content">
          <div className="eyebrow">A shared space for rigorous thought</div>
          <h1>{isLogin ? "Welcome back." : "Make reasoning inspectable."}</h1>
          <p className="auth-panel__lede">
            {isLogin
              ? "Return to your strategies, branches, and unfinished ideas."
              : "Build proofs and solutions with an agent that can see the same structure you do."}
          </p>

          <div className="auth-switch" role="tablist" aria-label="Authentication mode">
            <button
              aria-selected={isLogin}
              className={isLogin ? "is-active" : undefined}
              onClick={() => onModeChange("login")}
              role="tab"
              type="button"
            >
              Sign in
            </button>
            <button
              aria-selected={!isLogin}
              className={!isLogin ? "is-active" : undefined}
              onClick={() => onModeChange("register")}
              role="tab"
              type="button"
            >
              Create account
            </button>
          </div>

          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <label>
              <span>Email address</span>
              <div className="field-shell">
                <Mail aria-hidden="true" />
                <input
                  autoComplete="email"
                  onChange={(event) => onChange("email", event.target.value)}
                  placeholder="you@example.com"
                  required
                  type="email"
                  value={draft.email}
                />
              </div>
            </label>
            <label>
              <span>Password</span>
              <div className="field-shell">
                <LockKeyhole aria-hidden="true" />
                <input
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  minLength={8}
                  onChange={(event) => onChange("password", event.target.value)}
                  placeholder={isLogin ? "Enter your password" : "At least 8 characters"}
                  required
                  type={passwordVisible ? "text" : "password"}
                  value={draft.password}
                />
                <button
                  aria-label={passwordVisible ? "Hide password" : "Show password"}
                  className="field-shell__action"
                  onClick={onTogglePassword}
                  type="button"
                >
                  {passwordVisible ? <EyeOff /> : <Eye />}
                </button>
              </div>
            </label>

            {error && <div className="form-message form-message--error">{error}</div>}
            {notice && (
              <div className="form-message form-message--success">
                <Check />
                {notice}
              </div>
            )}

            <Button busy={busy} className="auth-form__submit" type="submit">
              {isLogin ? "Enter Lemma" : "Create my workspace"}
              {!busy && <ArrowRight />}
            </Button>
          </form>

          <p className="auth-panel__terms">
            By continuing, you agree to keep mathematical disagreements constructive.
          </p>
        </div>
      </section>

      <section className="auth-story" aria-label="A preview of visual branching in Lemma">
        <div className="auth-story__glow auth-story__glow--one" />
        <div className="auth-story__glow auth-story__glow--two" />
        <div className="auth-story__header">
          <span>Proof workspace / Compactness</span>
          <span className="live-pill"><span /> Agent connected</span>
        </div>

        <div className="auth-story__copy">
          <span className="eyebrow eyebrow--light">Reasoning is not a straight line</span>
          <h2>Interrupt. Branch. Continue.</h2>
          <p>
            Every idea keeps its place—even when you decide to try something better.
          </p>
        </div>

        <div className="preview-graph">
          <div className="preview-node preview-node--human">
            <span className="preview-node__author"><UserRound /> You</span>
            <b>Assume the cover has no finite subcover.</b>
            <span className="preview-node__meta">Step 04 · active</span>
          </div>
          <div className="preview-connector preview-connector--straight" />
          <div className="preview-node preview-node--agent">
            <span className="preview-node__author"><Bot /> Agent</span>
            <b>Construct a nested sequence of closed sets.</b>
            <div className="preview-node__formula"><MarkdownMath compact markdown="$F_1 \supset F_2 \supset \cdots$" /></div>
          </div>
          <div className="preview-fork"><GitBranch /></div>
          <div className="preview-connector preview-connector--branch" />
          <div className="preview-node preview-node--intervention">
            <span className="preview-node__author"><UserRound /> Your intervention</span>
            <b>Can we avoid the finite intersection property?</b>
            <span className="preview-node__meta">New branch · just now</span>
          </div>
          <div className="preview-connector preview-connector--continue" />
          <div className="preview-node preview-node--continuation">
            <span className="preview-node__author"><Bot /> Agent</span>
            <b>Yes—switch to a contradiction via limit points.</b>
            <span className="preview-node__meta">Continuing from your idea…</span>
          </div>
        </div>

        <div className="auth-story__foot">
          <span><GitBranch /> Original path preserved</span>
          <span>WebMCP-ready</span>
        </div>
      </section>
    </main>
  );
}
