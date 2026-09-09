/**
 * Workspace live floor (VS-152): one cell per currently-working worker, each streaming that
 * worker's in-progress run. Membership is `liveWorkingAgents` — the same liveness predicate the
 * board uses, listed as workers. No steer/attach/resume from a cell; the ticket is the way in.
 */
import { useMemo } from 'react';
import { agentUiStatus, isActiveRun, type Agent, type Run, type Ticket } from '@agent-conductor/shared';
import { Page, PageBody, PageHeader } from '../components/Page';
import { RunTranscript } from '../components/RunTranscript';
import { StreamStatusNotice } from '../components/StreamStatus';
import { SkeletonCards } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { StatusBadge } from '../components/StatusGlyph';
import { useRuns, useTickets, useWorkers } from '../api/hooks';
import { useRunEventStream } from '../api/runStream';
import { useWs } from '../api/context';
import { A } from '../app/link';
import { liveWorkingAgents } from '../lib/board';

export function LiveRoute(): React.ReactElement {
  const workers = useWorkers({});
  const tickets = useTickets({ limit: 300 });
  const running = useRuns({ status: 'running', limit: 200 });
  const queued = useRuns({ status: 'queued', limit: 200 });

  const live = useMemo(() => liveWorkingAgents(workers.data ?? []), [workers.data]);
  const ticketsById = useMemo(() => {
    const map = new Map<string, Ticket>();
    for (const t of tickets.data ?? []) map.set(t.id, t);
    return map;
  }, [tickets.data]);
  const runByAgent = useMemo(() => {
    const map = new Map<string, Run>();
    for (const r of [...(queued.data ?? []), ...(running.data ?? [])]) {
      if (!isActiveRun(r.status)) continue;
      const seen = map.get(r.agentId);
      if (!seen || r.createdAt > seen.createdAt) map.set(r.agentId, r);
    }
    return map;
  }, [running.data, queued.data]);

  const loaded = workers.data !== undefined;
  const n = live.length;

  return (
    <Page>
      <PageHeader title="Live" meta={loaded ? (n === 1 ? '1 working' : `${n} working`) : undefined} />
      <PageBody className="p-4 md:p-5">
        {workers.isError ? (
          <ErrorState
            code="WORKERS_QUERY_FAILED"
            message="Could not load who is working."
            onRetry={() => void workers.refetch()}
          />
        ) : !loaded ? (
          <SkeletonCards count={4} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" />
        ) : n === 0 ? (
          <EmptyState title="Nobody is working." detail="Live workers on a ticket show up here. Paused and idle ones stay on Team and the board." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {live.map((w) => (
              <LiveCell key={w.id} agent={w} ticket={w.ticketId ? ticketsById.get(w.ticketId) : undefined} run={runByAgent.get(w.id) ?? null} />
            ))}
          </div>
        )}
      </PageBody>
    </Page>
  );
}

function LiveCell({
  agent,
  ticket,
  run,
}: {
  agent: Agent;
  ticket: Ticket | undefined;
  run: Run | null;
}): React.ReactElement {
  const ws = useWs();
  const live = Boolean(run && isActiveRun(run.status));
  const { events, status, retryNow } = useRunEventStream(live && run ? run.id : null, { live });
  const identifier = ticket?.identifier ?? agent.ticketId;
  const title = ticket?.title;
  const ticketLabel = [identifier, title].filter(Boolean).join(' · ') || 'ticket';

  return (
    <article className="ac-card flex min-h-0 flex-col overflow-hidden">
      <header className="flex items-start gap-2.5 border-b border-line-1 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-ui font-medium text-text-1">{agent.name}</div>
          {identifier ? (
            <A
              to="/w/$ws/tickets/$ticketId"
              params={{ ws, ticketId: identifier }}
              className="ac-mono mt-0.5 block truncate text-micro text-accent-link hover:underline"
            >
              {ticketLabel}
            </A>
          ) : (
            <div className="ac-mono mt-0.5 truncate text-micro text-text-3">no ticket</div>
          )}
        </div>
        <StatusBadge status={agentUiStatus(agent.status)} />
      </header>
      <div className="min-h-0 flex-1 p-2.5">
        {live ? (
          <>
            <StreamStatusNotice status={status} onRetry={retryNow} className="mb-2" />
            <RunTranscript
              events={events}
              live
              label={`Transcript of ${agent.name}`}
              className="max-h-[calc(var(--ac-app-h)*0.25)] md:max-h-[calc(var(--ac-app-h)*0.3)]"
            />
          </>
        ) : (
          <p className="px-1 py-2 text-micro text-text-3">Waiting for the next turn.</p>
        )}
      </div>
    </article>
  );
}
