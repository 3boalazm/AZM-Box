import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Icon from "./Icon";

export type ToastKind = "info" | "success" | "error";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
}

interface FeedbackApi {
  /** Non-blocking message that fades on its own. */
  notify: (message: string, kind?: ToastKind) => void;
  /** In-app replacement for window.confirm. Resolves true on confirm, false on cancel/Esc. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const api = useContext(FeedbackContext);
  if (!api) throw new Error("useFeedback must be used inside <FeedbackProvider>.");
  return api;
}

let toastCounter = 0;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

  const notify = useCallback((message: string, kind: ToastKind = "info") => {
    const id = ++toastCounter;
    setToasts((current) => [...current.slice(-3), { id, kind, message }]);
    window.setTimeout(() => dismiss(id), kind === "error" ? 8000 : 4500);
  }, [dismiss]);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    // Only one dialog at a time: a newer request cancels an older pending one.
    setDialog((previous) => {
      previous?.resolve(false);
      return { ...options, resolve };
    });
  }), []);

  const close = useCallback((result: boolean) => {
    setDialog((current) => {
      current?.resolve(result);
      return null;
    });
    returnFocusRef.current?.focus?.();
  }, []);

  useEffect(() => {
    if (!dialog) return;
    confirmButtonRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
      } else if (event.key === "Tab") {
        // Two focusable controls: keep Tab inside the dialog.
        event.preventDefault();
        const next = document.activeElement === confirmButtonRef.current ? cancelButtonRef.current : confirmButtonRef.current;
        next?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dialog, close]);

  const api = useMemo(() => ({ notify, confirm }), [notify, confirm]);

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <span>{toast.message}</span>
            <button type="button" className="toast-close" aria-label="Dismiss message" onClick={() => dismiss(toast.id)}><Icon name="close"/></button>
          </div>
        ))}
      </div>
      {dialog && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(false); }}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-message">
            <h2 id="dialog-title">{dialog.title}</h2>
            <p id="dialog-message">{dialog.message}</p>
            <div className="dialog-actions">
              <button ref={cancelButtonRef} type="button" className="dialog-button" onClick={() => close(false)}>{dialog.cancelLabel ?? "Cancel"}</button>
              <button ref={confirmButtonRef} type="button" className={`dialog-button dialog-primary${dialog.danger ? " dialog-danger" : ""}`} onClick={() => close(true)}>{dialog.confirmLabel ?? "OK"}</button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}
