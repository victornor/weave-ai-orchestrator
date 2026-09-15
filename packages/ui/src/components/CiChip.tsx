/**
 * VS-481: the compact CI-status chip a merge-approval card shows, derived from the ticket's recorded
 * delivery by the shared `ciChipCopy`. Shared so the V2 card (Needs you, chat) and the ticket page's
 * card render exactly the same thing; renders nothing when there is no rollup to speak of.
 */
import { ciChipCopy } from '@weave-ai/shared';
import { cx } from '../lib/cx';

/** The chip's tone on the card; skipped and stale are deliberately quiet, not a pass and not a failure. */
const TONE: Record<string, string> = {
  pending: 'text-working',
  passed: 'text-review-clean',
  failed: 'text-blocked',
  skipped: 'text-text-3',
  stale: 'text-text-3',
};

export function CiChip({ delivery, approvedHead, className }: {
  delivery?: Record<string, unknown> | null;
  approvedHead?: string | null;
  className?: string;
}): React.ReactElement | null {
  const chip = ciChipCopy(delivery, { approvedHead: approvedHead ?? undefined });
  if (!chip) return null;
  const title = chip.checks.length ? `${chip.line} — ${chip.checks.join(', ')}` : chip.line;
  return (
    <div className={cx('flex flex-wrap items-center gap-2', className)} data-ci-chip={chip.tone} title={title}>
      <span className={cx('v2-tag flex-none', TONE[chip.tone])}>{chip.line}</span>
      {chip.checks.length ? (
        <span className="ac-mono min-w-0 truncate text-nano text-text-3" data-ci-checks>
          {chip.checks.join(', ')}
        </span>
      ) : null}
    </div>
  );
}
