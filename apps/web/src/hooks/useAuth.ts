import type { Session, User } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthDraft, AuthMode } from "../pages/auth/AuthPage";
import { supabase } from "../lib/supabase";

const EMPTY_DRAFT: AuthDraft = { email: "", password: "" };

function readableAuthError(error: unknown): string {
  if (!(error instanceof Error)) return "Authentication failed. Please try again.";
  const normalized = error.message.toLowerCase();
  if (normalized.includes("invalid login")) return "The email or password is incorrect.";
  if (normalized.includes("email not confirmed")) return "Confirm your email before signing in.";
  if (normalized.includes("already registered")) return "An account already exists for this email.";
  if (normalized.includes("password")) return error.message;
  return "Authentication failed. Please try again.";
}

export interface AuthController {
  busy: boolean;
  draft: AuthDraft;
  error: string | null;
  initialized: boolean;
  mode: AuthMode;
  notice: string | null;
  onChange: (field: keyof AuthDraft, value: string) => void;
  onModeChange: (mode: AuthMode) => void;
  onSubmit: () => void;
  onTogglePassword: () => void;
  passwordVisible: boolean;
  session: Session | null;
  signOut: () => Promise<void>;
  user: User | null;
}

export function useAuth(): AuthController {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");
  const [draft, setDraft] = useState<AuthDraft>(EMPTY_DRAFT);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession()
      .then(({ data }) => {
        if (active) setSession(data.session);
      })
      .catch(() => {
        if (active) {
          setError("We could not restore your session. Check your connection and try again.");
        }
      })
      .finally(() => {
        if (active) setInitialized(true);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setInitialized(true);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const onChange = useCallback((field: keyof AuthDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(null);
    setNotice(null);
  }, []);

  const onModeChange = useCallback((nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);
    setNotice(null);
  }, []);

  const onSubmit = useCallback(() => {
    setBusy(true);
    setError(null);
    setNotice(null);

    const operation = mode === "login"
      ? supabase.auth.signInWithPassword({ email: draft.email.trim(), password: draft.password })
      : supabase.auth.signUp({
          email: draft.email.trim(),
          password: draft.password,
          options: { emailRedirectTo: window.location.origin },
        });

    void operation
      .then(({ data, error: authError }) => {
        if (authError) throw authError;
        if (mode === "register" && !data.session) {
          setNotice("Check your inbox to confirm your email, then sign in.");
          setMode("login");
          setDraft((current) => ({ ...current, password: "" }));
        }
      })
      .catch((authError: unknown) => setError(readableAuthError(authError)))
      .finally(() => setBusy(false));
  }, [draft.email, draft.password, mode]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  return useMemo(
    () => ({
      busy,
      draft,
      error,
      initialized,
      mode,
      notice,
      onChange,
      onModeChange,
      onSubmit,
      onTogglePassword: () => setPasswordVisible((visible) => !visible),
      passwordVisible,
      session,
      signOut,
      user: session?.user ?? null,
    }),
    [busy, draft, error, initialized, mode, notice, onChange, onModeChange, onSubmit, passwordVisible, session, signOut],
  );
}
