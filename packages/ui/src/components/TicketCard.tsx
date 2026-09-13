import { useEffect, useState } from 'react';
import { incompleteDelivery, type Ticket, type WorkerModelOption } from '@weave-ai/shared';
import { StatusGlyph, Badge } from './StatusGlyph';
import { WorkerModelTag } from './WorkerModelTag';
import { isFolded, ticketBoardStatus } from '../lib/board';
import { ago, cents, statusText, tokens } from '../lib/format';
import { cx } from '../lib/cx';

export interface TicketCardProps {
  ticket: Ticket;
  /** The workspace's effective worker model options (VS-217): two or more turn the tier tag on. */
  workerOptions?: WorkerModelOption[];
  workerName?: string | null;
  /** Why this ticket's worker is paused, when it is — the board says why the work stopped without opening the worker. */
  workerPausedFor?: string | null;
  /** The complete pause message behind `workerPausedFor`'s capped preview, for the tooltip (VS-201). Falls back to `workerPausedFor` when absent. */
  workerPausedForFull?: string | null;
  /** A worker is live on this ticket right now — the card reads as working whatever the status says. */
  working?: boolean;
  /** What the worker is doing now, from the daemon (VS-328); absent while it is between turns. */
  activity?: { label: string; since: string } | null;
  /** The worker's most recent test tally (VS-328), when one was parsed. */
  tests?: { passed: number; total: number } | null;
  usage?: { tokens: number; costCents: number | null } | null;
  needsYou?: boolean;
  /** The daemon will grant this ticket's open approval, so it is not waiting on the human. */
  autoApproving?: boolean;
  stalled?: boolean;
  onOpen?: () => void;
  selected?: boolean;
  className?: string;
}

/** What became of a finished ticket: merged, an open PR, a report, or cancelled. */
export function outcomeOf(ticket: Ticket): { label: string; tone: 'accent' | 'done' | 'neutral' | 'failed' } | null {
  if (ticket.status !== 'done' && ticket.status !== 'cancelled') return null;
  if (ticket.status === 'cancelled') return { label: 'cancelled', tone: 'failed' };
  // VS-250: a claimed merge with no merge-done record must not read like an ordinary success.
  if (incompleteDelivery(ticket)) return { label: 'delivery incomplete', tone: 'failed' };
  const d = (ticket.delivery ?? {}) as { merged?: boolean; prUrl?: string; prState?: string; mode?: string };
  if (d.merged) return { label: 'merged', tone: 'done' };
  if (d.prUrl) return { label: `PR ${d.prState ?? 'open'}`, tone: 'accent' };
  if (ticket.kind === 'scout' || ticket.kind === 'question') return { label: ticket.kind === 'scout' ? 'report' : 'answered', tone: 'done' };
  if (ticket.kind === 'operational') return { label: 'ran', tone: 'done' };
  return { label: 'done', tone: 'done' };
}

export function OutcomeChip({ ticket }: { ticket: Ticket }): React.ReactElement | null {
  const o = outcomeOf(ticket);
  if (!o) return null;
  return <Badge tone={o.tone === 'accent' ? 'accent' : o.tone === 'done' ? 'added' : o.tone === 'failed' ? 'removed' : 'neutral'}>{o.label}</Badge>;
}

/**
 * The open pull request a ticket records, and the checks it has reported (VS-328). Null when there is
 * no open PR or its rollup is empty — a project without CI shows nothing, never a zero.
 */
export function prChecksOf(ticket: Ticket): { number: number | null; state: string; passed: number; total: number } | null {
  const d = (ticket.delivery ?? {}) as { prUrl?: string; prState?: string; prChecks?: { passed?: number; total?: number } };
  if (!d.prUrl || (d.prState && d.prState !== 'open')) return null;
  const checks = d.prChecks;
  if (!checks || typeof checks.passed !== 'number' || typeof checks.total !== 'number' || checks.total <= 0) return null;
  const number = Number(d.prUrl.match(/\/(\d+)\/?$/)?.[1]);
  return { number: Number.isFinite(number) ? number : null, state: d.prState ?? 'open', passed: checks.passed, total: checks.total };
}

/** The activity line the daemon reports, with its own one-second clock so the elapsed time advances. */
export function ActivityLine({ activity }: { activity?: { label: string; since: string } | null }): React.ReactElement | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!activity) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [activity]);
  if (!activity) return null;
  return (
    <div className="ac-mono mb-2 flex items-center gap-1.5 rounded-r4 bg-bg-2 px-2.5 py-1 text-nano text-text-2" title={activity.label}>
      <StatusGlyph status="working" size="xs" pulse className="flex-none" />
      <span className="ac-truncate min-w-0">{activity.label}</span>
      <span className="flex-none text-text-4">· {ago(activity.since)}</span>
    </div>
  );
}

/** The last test tally, green when every test passed and warning-toned when some did not (VS-328). */
export function TestTally({ tests }: { tests?: { passed: number; total: number } | null }): React.ReactElement | null {
  if (!tests || tests.total <= 0) return null;
  const allPassed = tests.passed >= tests.total;
  return <Badge tone={allPassed ? 'added' : 'modified'}>{tests.passed}/{tests.total} tests</Badge>;
}

/** `#326 open · Checks 5/6`, only when the ticket records an open PR whose checks were reported. */
export function PrChecks({ ticket }: { ticket: Ticket }): React.ReactElement | null {
  const checks = prChecksOf(ticket);
  if (!checks) return null;
  return (
    <span className="ac-mono flex-none truncate text-nano text-text-3" title={`Checks ${checks.passed}/${checks.total}`}>
      {checks.number !== null ? `#${checks.number} ${checks.state} · ` : ''}Checks {checks.passed}/{checks.total}
    </span>
  );
}

export function TicketCard({ ticket, workerOptions, workerName, workerPausedFor, workerPausedForFull, working, activity, tests, usage, needsYou, autoApproving, stalled, onOpen, selected, className }: TicketCardProps): React.ReactElement {
  const ui = ticketBoardStatus(ticket.status, { live: working, needsYou, autoApproving, stalled });
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
      <ActivityLine activity={activity} />
      {workerPausedFor ? (
        <div className="ac-mono ac-truncate mb-2 rounded-r4 bg-bg-2 px-2.5 py-1.5 text-nano text-text-3" title={workerPausedForFull ?? workerPausedFor}>
          paused · {workerPausedFor}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Badge>{ticket.kind}</Badge>
        <WorkerModelTag ticket={ticket} options={workerOptions} />
        {isFolded(ticket.status, { live: working }) ? <Badge tone="accent">{statusText(ticket.status)}</Badge> : null}
        {autoApproving ? <Badge tone="accent">auto-approving</Badge> : null}
        <TestTally tests={tests} />
        <PrChecks ticket={ticket} />
        <OutcomeChip ticket={ticket} />
        {workerName ? <span className="ac-truncate text-micro text-text-3">{workerName}</span> : null}
        <div className="flex-1" />
        <span className="ac-mono text-nano text-text-4">{ago(ticket.updatedAt)}</span>
      </div>
    </button>
  );
}

/** Dense list row for the phone board and search results. */
export function TicketRow({ ticket, workerOptions, workerName, workerPausedFor, working, activity, tests, needsYou, autoApproving, stalled, onOpen }: TicketCardProps): React.ReactElement {
  const ui = ticketBoardStatus(ticket.status, { live: working, needsYou, autoApproving, stalled });
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-3 border-b border-line-1 px-4 py-3 text-left transition-colors duration-(--dur-fast) ease-ac hover:bg-bg-1"
    >
      <StatusGlyph status={ui} size="sm" className="mt-1" pulse={ui === 'working'} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-body leading-snug text-text-1">{ticket.title}</div>
        <ActivityLine activity={activity} />
        <div className="flex items-center gap-2">
          <span className="ac-mono text-micro text-text-3">{ticket.identifier}</span>
          <WorkerModelTag ticket={ticket} options={workerOptions} />
          {isFolded(ticket.status, { live: working }) ? <span className="ac-mono text-micro text-text-3">{statusText(ticket.status)}</span> : null}
          {autoApproving ? <span className="ac-mono text-micro text-accent-link">auto-approving</span> : null}
          <TestTally tests={tests} />
          <PrChecks ticket={ticket} />
          {workerName ? <span className="ac-truncate text-micro text-text-3">{workerName}</span> : null}
          {workerPausedFor ? <span className="ac-truncate text-micro text-text-3">paused · {workerPausedFor}</span> : null}
        </div>
      </div>
      <span className="ac-mono flex-none text-nano text-text-4">{ago(ticket.updatedAt)}</span>
    </button>
  );
}
