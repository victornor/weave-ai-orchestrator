import type { Agent } from '@agent-conductor/shared';
import { agentUiStatus } from '@agent-conductor/shared';
import { StatusGlyph, StatusBadge } from './StatusGlyph';
import { cents, initials, tokens } from '../lib/format';
import { cx } from '../lib/cx';

export interface WorkerCardProps {
  agent: Agent;
  projectSlug?: string | null;
  ticketIdentifier?: string | null;
  lastLine?: string | null;
  worktree?: { status: string; dirty: boolean; ahead: number; behind: number } | null;
  usage?: { tokens: number; costCents: number | null; estimated?: boolean } | null;
  needsYou?: boolean;
  stalled?: boolean;
  onOpen?: () => void;
  className?: string;
}

export function WorkerCard({
  agent,
  projectSlug,
  ticketIdentifier,
  lastLine,
  worktree,
  usage,
  needsYou,
  stalled,
  onOpen,
  className,
}: WorkerCardProps): React.ReactElement {
  const ui = agentUiStatus(agent.status, { needsYou, stalled });
  return (
    <button type="button" onClick={onOpen} className={cx('ac-card w-full p-3 text-left transition-colors duration-(--dur-fast) ease-ac hover:bg-bg-2', className)}>
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="ac-mono flex size-7 flex-none items-center justify-center rounded-r4 border border-line-2 bg-bg-3 text-nano text-text-2">
          {initials(agent.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-medium text-text-1">{agent.name}</span>
          <span className="ac-mono mt-0.5 block truncate text-micro text-text-3">
            {[projectSlug, ticketIdentifier].filter(Boolean).join(' · ') || '—'}
          </span>
        </span>
        <StatusBadge status={ui} />
      </div>
      {lastLine ? <div className="ac-mono ac-truncate mb-2.5 rounded-r4 bg-bg-2 px-2.5 py-2 text-micro text-text-2">{lastLine}</div> : null}
      <div className="ac-mono flex items-center gap-2.5 text-nano text-text-4">
        {worktree ? (
          <>
            <span className={worktree.dirty ? 'text-working' : 'text-text-4'}>● {worktree.dirty ? 'dirty' : worktree.status}</span>
            <span>
              ↑{worktree.ahead} ↓{worktree.behind}
            </span>
          </>
        ) : null}
        {usage ? (
          <>
            <span>{tokens(usage.tokens)} tok</span>
            <span>
              {cents(usage.costCents)}
              {usage.estimated ? ' est' : ''}
            </span>
          </>
        ) : null}
      </div>
    </button>
  );
}

export function WorkerRow({ agent, projectSlug, ticketIdentifier, lastLine, needsYou, stalled, onOpen }: WorkerCardProps): React.ReactElement {
  const ui = agentUiStatus(agent.status, { needsYou, stalled });
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 border-b border-line-1 px-4 py-2.5 text-left transition-colors duration-(--dur-fast) ease-ac hover:bg-bg-1"
    >
      <StatusGlyph status={ui} size="sm" pulse={ui === 'working'} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui text-text-1">{agent.name}</span>
        <span className="ac-mono block truncate text-micro text-text-3">{lastLine ?? [projectSlug, ticketIdentifier].filter(Boolean).join(' · ')}</span>
      </span>
    </button>
  );
}
