/**
 * The ticket's attached evidence, rendered inside an approval card (VS-555).
 *
 * Images show as previews and open at full size in an overlay that never navigates away from the
 * card; a non-image is not dropped — video and audio play in place, a PDF or text opens in a tab, and
 * anything else downloads with a visible error and retry (VS-597, `AttachmentItem`). Newest
 * first, each item labelled with when it was captured, and nothing at all when there is no evidence,
 * so a card for a ticket with no attachments is byte-for-byte what it was before.
 *
 * Presentational only: the card owns the ticket-detail fetch and passes `attachments`.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TicketAttachment } from '@weave-ai/shared';
import { ago } from '../lib/format';
import { AttachmentItem } from './AttachmentItem';
import { cx } from '../lib/cx';

const isImage = (a: TicketAttachment): boolean => a.mediaType.startsWith('image/');

export interface TicketEvidenceProps {
  attachments: readonly TicketAttachment[] | null | undefined;
  className?: string;
}

export function TicketEvidence({ attachments, className }: TicketEvidenceProps): React.ReactElement | null {
  const [open, setOpen] = useState<TicketAttachment | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const list = attachments ?? [];
  if (!list.length) return null;
  const ordered = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div data-v2-section="evidence" className={cx('flex flex-wrap items-start gap-2', className)}>
      {ordered.map((a) =>
        isImage(a) && a.url ? (
          <button
            key={a.id}
            type="button"
            data-attachment={a.id}
            onClick={() => setOpen(a)}
            title={`${a.label} · ${ago(a.createdAt)}`}
            aria-label={`View ${a.label} at full size`}
            className="flex max-w-64 flex-col gap-1 rounded-r4 border border-line-2 p-1.5 text-left hover:border-accent-edge focus:outline-none focus-visible:border-accent-edge"
          >
            <img src={a.url} alt={a.label} className="max-h-40 w-full rounded-r4 object-contain" />
            <span className="truncate text-nano text-text-2">{a.label}</span>
            <span className="text-nano text-text-3">{ago(a.createdAt)}</span>
          </button>
        ) : a.url ? (
          <AttachmentItem key={a.id} attachmentId={a.id} url={a.url} label={a.label} mediaType={a.mediaType} byteSize={a.byteSize} createdAt={a.createdAt} />
        ) : null,
      )}

      {open && open.url
        ? createPortal(
            <div
              className="ac-viewport fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-4"
              role="dialog"
              aria-modal="true"
              aria-label={`${open.label} at full size`}
              onClick={() => setOpen(null)}
              style={{ background: 'var(--overlay)' }}
            >
              <img
                src={open.url}
                alt={open.label}
                className="max-h-[85vh] max-w-full rounded-r4 object-contain"
                onClick={(e) => e.stopPropagation()}
              />
              <div className="flex flex-wrap items-center justify-center gap-3" onClick={(e) => e.stopPropagation()}>
                <span className="text-meta text-text-1">{open.label}</span>
                <a href={open.url} target="_blank" rel="noreferrer" className="text-meta text-accent-link underline">
                  Open in new tab
                </a>
                <button
                  type="button"
                  onClick={() => setOpen(null)}
                  className="rounded-r4 border border-line-2 px-2.5 py-1 text-meta text-text-1"
                >
                  Close
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
