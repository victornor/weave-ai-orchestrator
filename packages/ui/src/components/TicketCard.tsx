import type { Ticket } from '@agent-conductor/shared';
import { ticketUiStatus } from '@agent-conductor/shared';
import { StatusGlyph, Badge } from './StatusGlyph';
import { isFolded } from '../lib/board';
import { ago, cents, statusText, tokens } from '../lib/format';
import { cx } from '../lib/cx';

export interface TicketCardProps {
  ticket: Ticket;
  workerName?: string | null;
  usage?: { tokens: number; costCents: number | null } | null;
  needsYou?: boolean;
  stalled?: boolean;
  onOpen?: () => void;
  selected?: boolean;
  className?: string;
}

export function TicketCard({ ticket, workerName, usage, needsYou, stalled, onOpen, selected, className }: TicketCardProps): React.ReactElement {
  const ui = ticketUiStatus(ticket.status, { hasOpenHumanDecision: needsYou, workerStalled: stalled });
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? 'true' : undefined}
      className={cx(
        'ac-card w-full p-3 text-left transition-colors duration-(--dur-fast) ease-ac hover:bg-bg-2',
        selected && 'border-accent-edge bg-bg-2',
        className,
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <StatusGlyph status={ui} size="xs" pulse={ui === 'working'} />
        <span className="ac-mono text-micro text-text-3">{ticket.identifier}</span>
        <div className="flex-1" />
        {usage ? (
          <span className="ac-mono text-nano text-text-4">
            {tokens(usage.tokens)} · {cents(usage.costCents)}
          </span>
        ) : null}
      </div>
      <div className="mb-2 text-ui leading-snug text-text-1">{ticket.title}</div>
      <div className="flex items-center gap-2">
        <Badge>{ticket.kind}</Badge>
        {isFolded(ticket.status) ? <Badge tone="accent">{statusText(ticket.status)}</Badge> : null}
        {workerName ? <span className="ac-truncate text-micro text-text-3">{workerName}</span> : null}
        <div className="flex-1" />
        <span className="ac-mono text-nano text-text-4">{ago(ticket.updatedAt)}</span>
      </div>
    </button>
  );
}

/** Dense list row for the phone board and search results. */
export function TicketRow({ ticket, workerName, needsYou, stalled, onOpen }: TicketCardProps): React.ReactElement {
  const ui = ticketUiStatus(ticket.status, { hasOpenHumanDecision: needsYou, workerStalled: stalled });
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-3 border-b border-line-1 px-4 py-3 text-left transition-colors duration-(--dur-fast) ease-ac hover:bg-bg-1"
    >
      <StatusGlyph status={ui} size="sm" className="mt-1" pulse={ui === 'working'} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-body leading-snug text-text-1">{ticket.title}</div>
        <div className="flex items-center gap-2">
          <span className="ac-mono text-micro text-text-3">{ticket.identifier}</span>
          {isFolded(ticket.status) ? <span className="ac-mono text-micro text-text-3">{statusText(ticket.status)}</span> : null}
          {workerName ? <span className="ac-truncate text-micro text-text-3">{workerName}</span> : null}
        </div>
      </div>
      <span className="ac-mono flex-none text-nano text-text-4">{ago(ticket.updatedAt)}</span>
    </button>
  );
}
