import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

export type ToastTone = "pending" | "success" | "error";
export type Toast = { id: number; tone: ToastTone; message: string };

/**
 * How long a toast stays up before it clears itself.
 *
 * A failure gets twice as long as a success: it carries more to read, and it
 * is the one somebody may have looked away from. Both can still be dismissed
 * outright, and neither waits for it.
 */
const SUCCESS_MS = 3500;
const ERROR_MS = 7000;
/**
 * How long an operation has to run before it is worth saying that it is
 * running. Most saves land well inside this, and a "Saving…" that flashes for
 * a tenth of a second reads as a glitch rather than as progress.
 */
const PENDING_AFTER_MS = 400;

/**
 * What a failure is called.
 *
 * A plain string is the everything-else case; the other two are worth naming
 * separately because they are the failures a person can act on.
 */
export type ToastFailure = {
  /** The server broke, or answered with nothing worth repeating. */
  fallback: string;
  /** 404: what was acted on is already gone. Two staff share one queue. */
  gone?: string;
  /** The server was never reached at all. */
  offline?: string;
};

/**
 * Which statuses carry a message worth showing as it is.
 *
 * The server names these precisely — "Name is required", "Only an owner can
 * do that", "Too many attempts". A 500 is the opposite: its body reads
 * "Something went wrong", which tells a visitor nothing they did not know,
 * so those get our own words instead.
 */
const SPEAKS_FOR_ITSELF = new Set([400, 403, 429, 501]);

/** 401 mid-operation means the session died, whatever the route calls it. */
const SESSION_ENDED = "Your session has ended. Sign in again.";

const UNREACHABLE = "Can't reach the server. Nothing was saved.";

/** The sentence to show for a failed operation. */
export function failureMessage(
  error: unknown,
  failure: string | ToastFailure,
): string {
  const copy = typeof failure === "string" ? { fallback: failure } : failure;
  // Not an ApiError at all: fetch itself rejected, so nothing reached the
  // server and nothing can have been written.
  if (!(error instanceof ApiError)) return copy.offline ?? UNREACHABLE;
  if (error.status === 401) return SESSION_ENDED;
  if (error.status === 404 && copy.gone) return copy.gone;
  if (SPEAKS_FOR_ITSELF.has(error.status) && error.message) {
    return error.message;
  }
  return copy.fallback;
}

/** What to say while an operation runs, and when it lands or fails. */
export type ToastLabels<T = unknown> = {
  pending: string;
  /**
   * A function where the outcome is part of the sentence — the number a
   * visitor was just given, say, which is only known once it lands.
   */
  success: string | ((result: T) => string);
  /** Used where the server has nothing specific of its own to say. */
  failure: string | ToastFailure;
};

/**
 * The sentence for an operation that landed.
 * A formatter is presentation only — `Intl.ListFormat` is missing on older
 * kiosk browsers — so one that throws still leaves the success reported.
 */
function successMessage<T>(
  success: ToastLabels<T>["success"],
  result: T,
): string {
  if (typeof success !== "string") {
    try {
      return success(result);
    } catch {
      return "Done.";
    }
  }
  return success;
}

/**
 * The console's and the kiosk's running commentary on what they are doing.
 *
 * Errors stay until dismissed and successes clear themselves: a failure is the
 * one worth reading, and nobody is watching a kiosk for it.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  // A console left open all day starts and finishes hundreds of these; none
  // should still be running once the page it belongs to has gone.
  useEffect(() => {
    const running = timers.current;
    return () => {
      for (const timer of running) clearTimeout(timer);
      running.clear();
    };
  }, []);

  const wait = useCallback((ms: number, then: () => void) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      then();
    }, ms);
    timers.current.add(timer);
    return timer;
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, message }]);
      // A pending toast is the exception: it goes when its work does.
      if (tone === "success") wait(SUCCESS_MS, () => dismiss(id));
      if (tone === "error") wait(ERROR_MS, () => dismiss(id));
      return id;
    },
    [dismiss, wait],
  );

  /**
   * Runs one operation and narrates it. Resolves to whether it landed, so a
   * caller can close its editor or leave the form up.
   *
   * A failure's own message is preferred to the label: the server names the
   * problem ("Name is required", "spreadsheet was never shared") better than
   * anything this side could guess.
   */
  const track = useCallback(
    async <T,>(labels: ToastLabels<T>, action: () => Promise<T>) => {
      let pendingId: number | null = null;
      const timer = wait(PENDING_AFTER_MS, () => {
        pendingId = show(labels.pending, "pending");
      });
      const settle = () => {
        clearTimeout(timer);
        timers.current.delete(timer);
        if (pendingId !== null) dismiss(pendingId);
      };

      let result: T;
      try {
        result = await action();
      } catch (err) {
        settle();
        show(failureMessage(err, labels.failure), "error");
        return false;
      }
      // Outside the catch above, and on its own: the work has landed, and a
      // sentence that cannot be built must not turn that into a failure.
      settle();
      show(successMessage(labels.success, result), "success");
      return true;
    },
    [dismiss, show, wait],
  );

  return { toasts, show, dismiss, track };
}

export type Toasts = ReturnType<typeof useToasts>;

/**
 * Where the toasts appear.
 *
 * Two live regions, both always in the document: a screen reader announces
 * what is inserted into a region that was already there, so one that appears
 * along with its first toast may say nothing at all. Errors go in the
 * assertive one — they interrupt, which is the point of them.
 */
export function ToastList({
  toasts,
  onDismiss,
  kiosk = false,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  /** Sized for a screen read across a room rather than at a desk. */
  kiosk?: boolean;
}) {
  const errors = toasts.filter((toast) => toast.tone === "error");
  const rest = toasts.filter((toast) => toast.tone !== "error");

  const render = (toast: Toast) => (
    <p key={toast.id} className={`toast toast-${toast.tone}`}>
      <span>{toast.message}</span>
      {/* A pending toast has nothing to dismiss: it goes when the work does. */}
      {toast.tone !== "pending" && (
        <button
          type="button"
          className="toast-close"
          onClick={() => onDismiss(toast.id)}
          aria-label={`Dismiss: ${toast.message}`}
        >
          ×
        </button>
      )}
    </p>
  );

  return (
    <div className={kiosk ? "toast-host toast-host-kiosk" : "toast-host"}>
      <div aria-live="assertive">{errors.map(render)}</div>
      <div aria-live="polite">{rest.map(render)}</div>
    </div>
  );
}
