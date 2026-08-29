import { AlertCircle, Check, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "../lib/ui";
import { Brand } from "./Brand";

type ButtonTone = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  busy?: boolean;
  icon?: ReactNode;
  tone?: ButtonTone;
}

export function Button({
  busy = false,
  children,
  className,
  disabled,
  icon,
  tone = "primary",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx("button", `button--${tone}`, className)}
      disabled={disabled || busy}
      type={type}
      {...props}
    >
      {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : icon}
      <span>{children}</span>
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

export function IconButton({ children, className, label, type = "button", ...props }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={cx("icon-button", className)}
      title={label}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={cx("status-badge", `status-badge--${status}`)}>
      <span aria-hidden="true" />
      {status.replaceAll("_", " ")}
    </span>
  );
}

interface EmptyStateProps {
  action?: ReactNode;
  description: string;
  icon: ReactNode;
  title: string;
}

export function EmptyState({ action, description, icon, title }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

interface ModalProps {
  children: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  open: boolean;
  title: ReactNode;
  wide?: boolean;
}

export function Modal({ children, description, onClose, open, title, wide = false }: ModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Dialog consumers often create their close callback inline. Keep the most
  // recent callback available to the keyboard handler without restarting the
  // focus lifecycle whenever a controlled form field changes.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (open) return;

    const rememberFocusedElement = () => {
      const activeElement = document.activeElement;
      if (
        !(activeElement instanceof HTMLElement)
        || dialogRef.current?.contains(activeElement)
        || activeElement.closest("[role='dialog']")
      ) return;
      returnFocusRef.current = activeElement;
    };

    rememberFocusedElement();
    document.addEventListener("focusin", rememberFocusedElement);
    return () => document.removeEventListener("focusin", rememberFocusedElement);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = returnFocusRef.current
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;

      // React's `autoFocus` property is not reliable as an attribute in every
      // renderer, so dialog fields may opt in explicitly with data-autofocus.
      // Both are checked before the close button or another generic control.
      const autofocusTarget = dialog.querySelector<HTMLElement>("[data-autofocus]")
        ?? dialog.querySelector<HTMLElement>("[autofocus]");
      const focusTarget = autofocusTarget ?? dialog.querySelector<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]",
      ) ?? dialog;
      focusTarget?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]",
      )].filter((element) => {
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      });
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => onCloseRef.current()}>
      <section
        aria-describedby={description ? "modal-description" : undefined}
        aria-labelledby="modal-title"
        aria-modal="true"
        className={cx("modal", wide && "modal--wide")}
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="modal__header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description && <p id="modal-description">{description}</p>}
          </div>
          <IconButton label="Close dialog" onClick={() => onCloseRef.current()}>
            <X />
          </IconButton>
        </header>
        <div className="modal__body">{children}</div>
      </section>
    </div>
  );
}

export type ToastTone = "error" | "success" | "info";

export interface ToastMessage {
  id: string;
  message: string;
  tone: ToastTone;
}

interface ToastRegionProps {
  messages: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastRegion({ messages, onDismiss }: ToastRegionProps) {
  return (
    <div className="toast-region" aria-live="polite" aria-relevant="additions removals">
      {messages.map((message) => (
        <div className={cx("toast", `toast--${message.tone}`)} key={message.id}>
          {message.tone === "success" ? <Check /> : <AlertCircle />}
          <span>{message.message}</span>
          <IconButton label="Dismiss notification" onClick={() => onDismiss(message.id)}>
            <X />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

export function LoadingScreen() {
  return (
    <div className="loading-screen">
      <Brand />
      <div className="loading-screen__track"><span /></div>
      <p>Opening your reasoning workspace…</p>
    </div>
  );
}
