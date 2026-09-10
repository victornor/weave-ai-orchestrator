import type { Agent } from '@agent-conductor/shared';
import { agentUiStatus, waitingOnRuntimeLogin } from '@agent-conductor/shared';
import { workerPauseDetail } from '@agent-conductor/render';
import { StatusGlyph, StatusBadge, Badge } from './StatusGlyph';
import { Button } from './Button';
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
  /** The ticket this worker is on is an interactive session (VS-101): a human is conversing with it directly. */
  interactive?: boolean;
  onOpen?: () => void;
  /** Offered on a paused worker; resuming continues the same ticket, worktree and session. */
  onResume?: () => void;
  resuming?: boolean;
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
  interactive,
  onOpen,
  onResume,
  resuming,
  className,
}: WorkerCardProps): React.ReactElement {
  const ui = agentUiStatus(agent.status, { needsYou, stalled });
  // Why it stopped, worded once in @agent-conductor/render so the web app and `conductor worker`
  // say the same thing. Null unless the worker is paused. The tooltip carries the complete message
  // (VS-201) — the visible line stays the capped, ellipsis-marked preview.
  const pauseDetail = workerPauseDetail(agent);
  const pausedFor = pauseDetail?.summary ?? null;
  return (
    <div className={cx('ac-card', className)}>
    <button type="button" onClick={onOpen} className="w-full p-3 text-left transition-colors duration-(--dur-fast) ease-ac hover:bg-bg-2">
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
        {interactive ? <Badge tone="accent">interactive</Badge> : null}
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
      {pausedFor ? (
        <div className="flex items-center gap-2 border-t border-line-1 px-3 py-2">
          <span className="ac-mono min-w-0 flex-1 truncate text-nano text-text-3" title={pauseDetail?.full ?? pausedFor}>
            {pausedFor}
          </span>
          {/* A worker waiting on its runtime's login resumes by itself; offering Resume here would
              start a turn that can only fail again (VS-75). */}
          {onResume && !waitingOnRuntimeLogin(agent) ? (
            <Button size="sm" onClick={onResume} disabled={resuming}>
              Resume
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function WorkerRow({ agent, projectSlug, ticketIdentifier, lastLine, needsYou, stalled, interactive, onOpen }: WorkerCardProps): React.ReactElement {
  const ui = agentUiStatus(agent.status, { needsYou, stalled });
  const pausedFor = workerPauseDetail(agent)?.summary ?? null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 border-b border-line-1 px-4 py-2.5 text-left transition-colors duration-(--dur-fast) ease-ac hover:bg-bg-1"
    >
      <StatusGlyph status={ui} size="sm" pulse={ui === 'working'} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui text-text-1">{agent.name}</span>
        <span className="ac-mono block truncate text-micro text-text-3">{pausedFor ?? lastLine ?? [projectSlug, ticketIdentifier].filter(Boolean).join(' · ')}</span>
      </span>
      {interactive ? <Badge tone="accent">interactive</Badge> : null}
    </button>
  );
}
