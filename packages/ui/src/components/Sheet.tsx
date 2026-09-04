import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx';

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
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  labelledBy?: string;
}): React.ReactElement | null {
  useDismiss(open, onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [open]);
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-(--overlay)" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-labelledby={labelledBy}
        className={cx(
          'relative w-full max-w-lg overflow-hidden rounded-t-r8 border border-line-2 bg-bg-1 shadow-sheet sm:rounded-r8',
          'motion-safe:animate-[ac-sheet-in_var(--dur-panel)_var(--ease)]',
        )}
      >
        {title ? (
          <div className="flex items-center gap-2 border-b border-line-1 px-4 py-3">
            <h2 className="text-head font-semibold tracking-head text-text-strong">{title}</h2>
            <div className="flex-1" />
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-r4 px-2 py-1 text-text-3 hover:bg-bg-3 hover:text-text-1">
              ✕
            </button>
          </div>
        ) : null}
        <div className="ac-scroll max-h-[70vh] p-4">{children}</div>
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
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end">
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
