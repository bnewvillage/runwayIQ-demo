import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/**
 * Transient status messages. Deliberately minimal: a queue, a tone, and an
 * optional sticky mode for work that outlives a fixed timeout (an ERP pull
 * takes minutes, so "started" auto-dismisses but "running" must not).
 */
const ToastContext = createContext(null);
const DEFAULT_MS = 5000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  /** @returns the toast id, so a caller can replace or dismiss it later. */
  const push = useCallback(({ text, tone = 'info', duration = DEFAULT_MS }) => {
    const id = nextId.current++;
    setToasts((cur) => [...cur, { id, text, tone }]);
    // duration 0 keeps it until the caller dismisses -- used for work whose
    // length isn't known up front.
    if (duration > 0) setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'toast toast--' + t.tone}>
            <span>{t.text}</span>
            <button className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss">&times;</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
