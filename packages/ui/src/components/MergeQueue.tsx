import type { MergeQueue as MergeQueueData, MergeQueueEntry } from '../api/types';
import { Card, CardBody, CardHeader } from './Card';
import { Badge } from './StatusGlyph';
import { ago } from '../lib/format';
import { cx } from '../lib/cx';

/**
 * A project's merge queue (PLAN §11.4): what is landing now, and who is waiting behind it, in order.
 * Presentational — the route fetches the queue and hands it over.
 */
export function MergeQueuePanel({
  queue,
  onOpen,
  className,
}: {
  queue: MergeQueueData;
  onOpen?: (entry: MergeQueueEntry) => void;
  className?: string;
}): React.ReactElement | null {
  const rows = [...queue.active, ...queue.waiting];
  if (rows.length === 0) return null;
  return (
    <Card className={className}>
      <CardHeader>
        <span className="ac-label">Merge queue</span>
        <span className="ac-mono text-nano text-text-4">
          {queue.active.length}/{queue.concurrency} merging · {queue.waiting.length} waiting
        </span>
      </CardHeader>
      <CardBody className="p-0">
        <ul>
          {rows.map((e) => (
            <li key={e.ticketId}>
              <button
                type="button"
                onClick={() => onOpen?.(e)}
                disabled={!onOpen}
                className={cx(
                  'flex w-full items-center gap-2 border-b border-line-1 px-3.5 py-2 text-left last:border-b-0',
                  onOpen && 'hover:bg-bg-3',
                )}
              >
                <span className="ac-mono w-8 shrink-0 text-nano text-text-4">{e.position === null ? 'now' : `#${e.position}`}</span>
                <span className="ac-mono shrink-0 text-nano text-text-3">{e.identifier}</span>
                <span className="min-w-0 flex-1 truncate text-mini text-text-2">{e.title}</span>
                {e.position === null ? <Badge tone="accent">merging</Badge> : <Badge tone="neutral">waiting</Badge>}
                <span className="ac-mono shrink-0 text-nano text-text-4">{ago(e.startedAt ?? e.queuedAt ?? '')}</span>
              </button>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/** The ticket page's own line: "#2 in the merge queue", or that it is the one merging now. */
export function MergeQueueBadge({ position, merging }: { position: number | null; merging: boolean }): React.ReactElement | null {
  if (merging) return <Badge tone="accent">merging now</Badge>;
  if (position === null) return null;
  return <Badge tone="neutral">#{position} in the merge queue</Badge>;
}
