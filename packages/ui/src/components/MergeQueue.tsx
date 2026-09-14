import { Badge, StatusGlyph } from './StatusGlyph';
import { cx } from '../lib/cx';
import { mergeWaitLabel, type MergeWait } from '../lib/board';

/**
 * The board's one line about landing (PLAN §11.4). It says how much is in flight and opens the merge
 * queue view; it never holds the queue itself, and it keeps the same height whether or not anything
 * is merging, so the board's geometry does not move with the queue's state.
 */
export function MergeQueueStrip({
  landing,
  waiting,
  active,
  onOpen,
  className,
}: {
  landing: number;
  waiting: number;
  /** VS-391: what the longest-active merge is waiting on, for a stall that is visible on the board. */
  active?: MergeWait | null;
  onOpen: () => void;
  className?: string;
}): React.ReactElement {
  const busy = landing > 0 || waiting > 0;
  const wait = landing > 0 ? mergeWaitLabel(active ?? null) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        'flex h-6 w-full items-center gap-2 text-left transition-colors duration-(--dur-fast) ease-ac hover:text-text-2',
        busy ? 'text-text-3' : 'text-text-4',
        className,
      )}
    >
      <StatusGlyph status={busy ? 'merging' : 'idle'} size="xs" />
      <span className="text-micro font-medium">Merge queue</span>
      <span className="ac-mono text-nano">
        {busy ? `${landing} landing · ${waiting} waiting${wait ? ` · ${wait}` : ''}` : 'nothing landing'}
      </span>
      <span className="flex-1" />
      <span aria-hidden="true" className="text-nano">
        →
      </span>
    </button>
  );
}

/** The ticket page's own line: "#2 in the merge queue", or that it is the one merging now. */
export function MergeQueueBadge({
  position,
  merging,
  onOpen,
}: {
  position: number | null;
  merging: boolean;
  /** Given, the badge opens the merge queue view for the ticket's project. */
  onOpen?: () => void;
}): React.ReactElement | null {
  if (!merging && position === null) return null;
  const badge = merging ? <Badge tone="accent">merging now</Badge> : <Badge tone="neutral">#{position} in the merge queue</Badge>;
  if (!onOpen) return badge;
  return (
    <button type="button" onClick={onOpen} aria-label="Open the merge queue" className="transition-opacity duration-(--dur-fast) ease-ac hover:opacity-80">
      {badge}
    </button>
  );
}
