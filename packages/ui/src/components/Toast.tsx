import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { UiStatus } from '@weave-ai/shared';
import { StatusGlyph } from './StatusGlyph';
import { useActiveV2RootTheme } from '../lib/v2ThemeScope';
import { cx } from '../lib/cx';

export interface Toast {
  id: string;
  title: string;
  detail?: string;
  status?: UiStatus;
  href?: string;
  /** milliseconds; the arrival toast auto-dismisses after 8s. */
  ttl?: number;
  undo?: { label: string; run: () => void };
  /** A single labelled action, rendered like `undo` but without implying anything was reverted. */
  action?: { label: string; run: () => void };
}

interface ToastCtx {
  push: (t: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [items, setItems] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      const ttl = t.ttl ?? 8000;
      if (ttl > 0) timers.current.set(id, setTimeout(() => dismiss(id), ttl));
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  const [self, setSelf] = useState<HTMLElement | null>(null);
  const theme = useActiveV2RootTheme(self);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        ref={setSelf}
        className={cx(
          'pointer-events-none fixed inset-x-0 top-[calc(var(--ac-app-top)_+_var(--space-5))] z-[60] flex flex-col items-center gap-2 px-3 sm:left-auto sm:right-4 sm:items-end',
          theme ? 'v2-root' : undefined,
        )}
        // `.v2-root`'s own rule paints a full background — only its token declarations are wanted
        // here, on a container that must stay invisible around the toast cards themselves.
        style={theme ? { background: 'transparent' } : undefined}
        data-theme={theme ?? undefined}
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto w-full max-w-sm rounded-r6 border border-line-2 bg-bg-2 px-3.5 py-2.5 shadow-sheet',
              // V2 uses its own motion tokens; the container mirrors `.v2-root` above (VS-367), so
              // `--v2-dur-*` is in scope here too. V1 keeps `ac-rise` on its own duration (VS-427).
              theme ? 'v2-anim-rise' : 'motion-safe:animate-[ac-rise_var(--dur-panel)_var(--ease)]',
            )}
            role="status"
          >
            <div className="flex items-start gap-2.5">
              {t.status ? <StatusGlyph status={t.status} size="sm" className="mt-0.5" /> : null}
              <div className="min-w-0 flex-1">
                <div className="text-ui font-medium text-text-1">{t.title}</div>
                {t.detail ? <div className="mt-0.5 text-micro text-text-3">{t.detail}</div> : null}
              </div>
              {t.undo || t.action ? (
                <button
                  type="button"
                  className="text-micro font-medium text-accent-link"
                  onClick={() => {
                    (t.undo ?? t.action)?.run();
                    dismiss(t.id);
                  }}
                >
                  {(t.undo ?? t.action)?.label}
                </button>
              ) : (
                <button type="button" aria-label="Dismiss" className="text-text-3 hover:text-text-1" onClick={() => dismiss(t.id)}>
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast outside ToastProvider');
  return c;
}
