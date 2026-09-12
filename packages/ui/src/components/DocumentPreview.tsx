import { useState } from 'react';
import { documentTarget } from '@weave-ai/shared';
import type { Decision } from '@weave-ai/shared';
import { Markdown } from './Markdown';
import { SkeletonRows } from './Skeleton';
import { useTicketDocumentById } from '../api/hooks';
import { cx } from '../lib/cx';

export interface DocumentPreviewProps {
  decision: Decision;
  className?: string;
  ws?: string;
}

/**
 * The document a decision's target points at (VS-224): content on the card, the revision it names
 * visible, the complete text reachable in place. Open by default on an open decision — the human
 * should not have to tap to know what they are agreeing to; a closed card is a record and starts
 * collapsed. A document that has moved past the revision the decision names is never shown as
 * current: a banner says so, and any older content shown is labelled with the revision it actually
 * is. Renders nothing when the decision carries no document target, so a call site can pass it
 * unconditionally.
 */
export function DocumentPreview({ decision, className, ws }: DocumentPreviewProps): React.ReactElement | null {
  const target = documentTarget(decision);
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? decision.status === 'open';

  const doc = useTicketDocumentById(decision.ticketId ?? '', target?.documentId ?? '', undefined, ws);
  // Only fetched when the document has moved past the revision the decision names; when current,
  // this is the HEAD key again and hits the same cache entry — one request in the normal case.
  const current = doc.data?.currentRevision;
  const asked = target?.revision;
  const stale = current != null && asked !== undefined && current > asked;
  // A revision ahead of the document's own — named, never written, or the document recreated.
  // HEAD content must not pass for it.
  const revisionMissing = current !== undefined && asked !== undefined && asked > current;
  const named = useTicketDocumentById(decision.ticketId ?? '', target?.documentId ?? '', stale ? asked : undefined, ws);

  if (!target) return null;
  const badge = asked !== undefined ? `r${asked}` : doc.data ? `r${doc.data.revision}` : null;

  return (
    <div className={cx('mb-3 overflow-hidden rounded-r6 border border-line-1 bg-bg-2', className)} data-document-preview={target.documentId}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-meta font-medium text-text-1">{expanded ? 'Hide the document' : 'Read the document'}</span>
        <div className="flex-1" />
        {badge ? <span className="ac-mono text-nano text-text-4">{badge}</span> : null}
        <span aria-hidden className="text-micro text-text-3">{expanded ? '▾' : '▸'}</span>
      </button>
      {stale ? (
        <p className="border-t border-line-1 px-3 py-2 text-micro font-medium text-needs-you" role="status">
          The document was revised since this was asked — now r{doc.data?.currentRevision}. This decision refers to r{asked}.
        </p>
      ) : null}
      {revisionMissing ? (
        <p className="border-t border-line-1 px-3 py-2.5 text-meta text-text-3">
          Revision r{asked} could not be found — the document is at r{current}.
        </p>
      ) : expanded ? (
        stale ? (
          named.isLoading ? (
            <SkeletonRows rows={3} />
          ) : named.data ? (
            <div className="border-t border-line-1 px-3 py-2.5" aria-label={`Revision r${asked}, superseded`}>
              <p className="ac-mono mb-1.5 text-nano text-text-4">r{asked} · superseded by r{current}</p>
              <Markdown source={named.data.body} />
            </div>
          ) : (
            <p className="border-t border-line-1 px-3 py-2.5 text-meta text-text-3">
              Revision r{asked} could not be found{doc.data && !named.isError ? ` — the document is at r${current}` : ''}.
            </p>
          )
        ) : doc.isLoading ? (
          <SkeletonRows rows={4} />
        ) : doc.isError || !doc.data || doc.data.body.trim() === '' ? (
          <p className="border-t border-line-1 px-3 py-2.5 text-meta text-text-3">The document this decision points at could not be found.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto border-t border-line-1 px-3 py-2.5">
            <Markdown source={doc.data.body} />
          </div>
        )
      ) : null}
    </div>
  );
}
