/**
 * Ephemeral cue stack anchored over the arena. One lightweight context drives a stack of
 * matte, hairline toasts: gold for positive moments, red for errors, neutral otherwise.
 * Toasts auto-expire (~5s) and carry a manual close (X) control. No pulsing dots; the only
 * motion is a short slide-in that reduced-motion users opt out of via CSS.
 *
 * Usage: wrap the tree in <ToastProvider>, then call useToast().push(...) anywhere.
 */

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CheckCircle2, Goal, Info, TriangleAlert, X } from "lucide-react";

export type ToastTone = "positive" | "error" | "neutral";

export type ToastInput = {
  title: string;
  detail?: string;
  tone?: ToastTone;
  /** Auto-dismiss after this many ms. Defaults to ~5s. Pass 0 to keep until closed. */
  durationMs?: number;
  /** Dedupe key: pushing the same key replaces the prior toast instead of stacking. */
  dedupeKey?: string;
};

type Toast = ToastInput & { id: number; tone: ToastTone };

type ToastApi = {
  push: (input: ToastInput) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION = 5000;
const MAX_VISIBLE = 4;

const TONE_ICON: Record<ToastTone, typeof Info> = {
  positive: Goal,
  error: TriangleAlert,
  neutral: Info,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = (idRef.current += 1);
      const tone = input.tone ?? "neutral";
      const duration = input.durationMs ?? DEFAULT_DURATION;
      const next: Toast = { ...input, id, tone };

      setToasts((prev) => {
        const deduped = input.dedupeKey
          ? prev.filter((toast) => toast.dedupeKey !== input.dedupeKey)
          : prev;
        const trimmed = [...deduped, next];
        return trimmed.slice(-MAX_VISIBLE);
      });

      if (duration > 0) {
        const timer = window.setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, timer);
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ push, dismiss }}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
      {toasts.map((toast) => {
        const Icon = TONE_ICON[toast.tone];
        return (
          <div
            key={toast.id}
            className={`toast toast-${toast.tone}`}
            role={toast.tone === "error" ? "alert" : "status"}
          >
            <span className="toast-icon" aria-hidden="true">
              <Icon size={16} />
            </span>
            <div className="toast-body">
              <strong>{toast.title}</strong>
              {toast.detail && <span>{toast.detail}</span>}
            </div>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss notification"
              onClick={() => onDismiss(toast.id)}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Stub that swallows pushes; lets callers run safely outside a provider (e.g. tests). */
const NOOP_TOAST: ToastApi = { push: () => {}, dismiss: () => {} };

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP_TOAST;
}

/** Convenience helper to keep the matte CheckCircle icon importable where copy confirms. */
export { CheckCircle2 as ToastCopyIcon };
