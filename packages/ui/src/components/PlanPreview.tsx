import { useState } from 'react';
import type { Decision } from '@agent-conductor/shared';
import { Markdown } from './Markdown';
import { SkeletonRows } from './Skeleton';
import { useTicketDocument } from '../api/hooks';
import { cx } from '../lib/cx';

export interface PlanPreviewProps {
  decision: Decision;
  className?: string;
}

/**
 * The plan a `plan_approval` is asking about, one tap from the Approve button (PLAN §12.2). The
 * document is the worker's rendered OpenSpec proposal + tasks + design; HEAD is always the revision
 * the open decision refers to, because a newer plan revision supersedes the pending approval.
 *
 * Renders nothing for any other decision kind, so a call site can pass it unconditionally.
 */
export function PlanPreview({ decision, className }: PlanPreviewProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const ticketId = decision.kind === 'plan_approval' ? decision.ticketId : null;
  const doc = useTicketDocument(ticketId ?? '', 'plan');

  if (!ticketId) return null;

  const body = doc.data?.body?.trim() ?? '';
  // A plan that never landed reads as an empty document; say so rather than showing an empty box.
  if (!doc.isLoading && (doc.isError || body.length === 0)) {
    return (
      <p className={cx('mb-3 rounded-r6 border border-dashed border-line-2 px-3 py-2.5 text-meta text-text-3', className)}>
        No plan document on this ticket — the proposal is missing or empty.
      </p>
    );
  }

  return (
    <div className={cx('mb-3 overflow-hidden rounded-r6 border border-line-1 bg-bg-2', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-meta font-medium text-text-1">{open ? 'Hide the plan' : 'Read the plan'}</span>
        <div className="flex-1" />
        {doc.data ? <span className="ac-mono text-nano text-text-4">r{doc.data.revision}</span> : null}
        <span aria-hidden className="text-micro text-text-3">{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className="max-h-96 overflow-y-auto border-t border-line-1 px-3 py-2.5">
          {doc.isLoading ? <SkeletonRows rows={4} /> : <Markdown source={body} />}
        </div>
      ) : null}
    </div>
  );
}
