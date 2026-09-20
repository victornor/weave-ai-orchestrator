import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useActiveV2RootTheme } from '../lib/v2ThemeScope';
import { cx } from '../lib/cx';

/** How far the grab handle has to travel down before letting go dismisses the sheet. */
export const SWIPE_CLOSE_PX = 64;

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Tab and Shift+Tab stay inside an open sheet: it is `aria-modal`, so the rest of the page is not
 * there to be reached, and a keyboard would otherwise walk straight out into it.
 */
function useFocusTrap(open: boolean, ref: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      const node = ref.current;
      if (e.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (!node.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, ref]);
}

function useDismiss(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

/** Bottom sheet on phones, centred dialog from `sm` up. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  labelledBy,
  swipeToClose,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  labelledBy?: string;
  /** Phone affordance: a grab handle that dismisses the sheet when dragged down past the threshold. */
  swipeToClose?: boolean;
}): React.ReactElement | null {
  useDismiss(open, onClose);
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref);
  // The dialog is portalled into `document.body`, outside `.v2-root`; mirror the app's theme onto
  // the portal so its tokens (including the backdrop's `--overlay`) follow light/dark, not the
  // document default (VS-623). `V1` has no `.v2-root`, so this is a no-op there.
  const [self, setSelf] = useState<HTMLElement | null>(null);
  const theme = useActiveV2RootTheme(self);
  const grabbedAt = useRef<number | null>(null);
  const [dragged, setDragged] = useState(0);
  useEffect(() => {
    if (!open) return;
    // The panel itself when nothing asked for the focus: the trap and Escape both act from inside,
    // and a screen reader lands on the dialog rather than wherever the page was.
    const node = ref.current;
    (node?.querySelector<HTMLElement>('[data-autofocus]') ?? node)?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) {
      grabbedAt.current = null;
      setDragged(0);
    }
  }, [open]);
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div ref={setSelf} data-theme={theme ?? undefined} className="ac-viewport fixed z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-(--overlay)" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        style={dragged ? { transform: `translateY(${dragged}px)` } : undefined}
        className={cx(
          'relative w-full max-w-lg overflow-hidden rounded-t-r8 border border-line-2 bg-bg-1 shadow-sheet outline-none sm:rounded-r8',
          'motion-safe:animate-[ac-sheet-in_var(--dur-panel)_var(--ease)]',
        )}
      >
        {swipeToClose ? (
          <div
            data-testid="sheet-grab"
            className="flex touch-none justify-center pt-2 pb-1 sm:hidden"
            onPointerDown={(e) => {
              grabbedAt.current = e.clientY;
              e.currentTarget.setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (grabbedAt.current === null) return;
              setDragged(Math.max(0, e.clientY - grabbedAt.current));
            }}
            onPointerUp={() => {
              const travelled = dragged;
              grabbedAt.current = null;
              setDragged(0);
              if (travelled >= SWIPE_CLOSE_PX) onClose();
            }}
            onPointerCancel={() => {
              grabbedAt.current = null;
              setDragged(0);
            }}
          >
            <span className="h-1 w-9 rounded-pill bg-line-3" aria-hidden />
          </div>
        ) : null}
        {title ? (
          <div className="flex items-center gap-2 border-b border-line-1 px-4 py-3">
            <h2 className="text-head font-semibold tracking-head text-text-strong">{title}</h2>
            <div className="flex-1" />
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-r4 px-2 py-1 text-text-3 hover:bg-bg-3 hover:text-text-1">
              ✕
            </button>
          </div>
        ) : null}
        <div className="ac-scroll max-h-[calc(var(--ac-app-h)*0.7)] p-4">{children}</div>
        {footer ? <div className="flex gap-2 border-t border-line-1 p-4 ac-safe-bottom">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Dialog(props: Parameters<typeof Sheet>[0]): React.ReactElement | null {
  return <Sheet {...props} />;
}

/** Right-hand details pane on desktop, full-screen push on phone. */
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }): React.ReactElement | null {
  useDismiss(open, onClose);
  // Same theme mirror as `Sheet`: a portal into `document.body` sits outside `.v2-root` (VS-623).
  const [self, setSelf] = useState<HTMLElement | null>(null);
  const theme = useActiveV2RootTheme(self);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div ref={setSelf} data-theme={theme ?? undefined} className="ac-viewport fixed z-40 flex justify-end">
      <div className="absolute inset-0 bg-(--overlay)" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-xl flex-col border-l border-line-2 bg-bg-1 shadow-sheet motion-safe:animate-[ac-rise_var(--dur-panel)_var(--ease)]"
      >
        <div className="flex items-center gap-2 border-b border-line-1 px-4 py-3">
          <h2 className="text-head font-semibold tracking-head text-text-strong">{title}</h2>
          <div className="flex-1" />
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-r4 px-2 py-1 text-text-3 hover:bg-bg-3 hover:text-text-1">
            ✕
          </button>
        </div>
        <div className="ac-scroll flex-1">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
