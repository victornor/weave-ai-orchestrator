/**
 * Daemon-wide Live floor (VS-168): one cell per live worker on a ticket, across every workspace.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isActiveRun, type Agent, type Run, type Ticket, type WorkerModelOption } from '@weave-ai/shared';
import { Page, PageBody, PageHeader } from '../components/Page';
import { SkeletonCards } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { useModelsMany, useRunsMany, useTicketsMany, useWorkersMany, useWorkspaces } from '../api/hooks';
import { liveWorkingAgents } from '../lib/board';
import { liveRunTailSlots } from '../lib/liveStreams';
import {
  type CellSize,
  columnCount,
  readLiveCellSizes,
  sizeOf,
  writeLiveCellSizes,
} from '../lib/liveCellSize';
import { LiveCell } from './Live';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (): void => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

const GLOBAL_SIZE_KEY = 'global';

export function GlobalLiveRoute(): React.ReactElement {
  const workspaces = useWorkspaces();
  const listed = workspaces.data ?? [];
  const ids = useMemo(() => listed.map((w) => w.id), [listed]);
  const workerQueries = useWorkersMany(ids);
  const ticketQueries = useTicketsMany(ids, { limit: 300 });
  const runningQueries = useRunsMany(ids, { status: 'running', limit: 200 });
  const queuedQueries = useRunsMany(ids, { status: 'queued', limit: 200 });
  // Per-workspace effective catalogs (VS-217) so a global cell carries the same tier tag as the
  // workspace Live page's.
  const modelQueries = useModelsMany(ids);
  const minSm = useMediaQuery('(min-width: 40rem)');
  const minXl = useMediaQuery('(min-width: 80rem)');
  const colsMax = columnCount(minSm, minXl);
  const [sizes, setSizes] = useState(() => readLiveCellSizes(GLOBAL_SIZE_KEY));

  type Cell = { ws: string; name: string; agent: Agent; ticket: Ticket | undefined; run: Run | null; options?: WorkerModelOption[] };
  const cells = useMemo<Cell[]>(() => {
    const out: Cell[] = [];
    for (let i = 0; i < listed.length; i++) {
      const w = listed[i];
      const workers = workerQueries[i]?.data;
      if (!w || !workers) continue;
      const ticketsById = new Map<string, Ticket>();
      for (const t of ticketQueries[i]?.data ?? []) ticketsById.set(t.id, t);
      const runByAgent = new Map<string, Run>();
      for (const r of [...(queuedQueries[i]?.data ?? []), ...(runningQueries[i]?.data ?? [])]) {
        if (!isActiveRun(r.status)) continue;
        const seen = runByAgent.get(r.agentId);
        if (!seen || r.createdAt > seen.createdAt) runByAgent.set(r.agentId, r);
      }
      for (const agent of liveWorkingAgents(workers)) {
        out.push({
          ws: w.id,
          name: w.name,
          agent,
          ticket: agent.ticketId ? ticketsById.get(agent.ticketId) : undefined,
          run: runByAgent.get(agent.id) ?? null,
          options: modelQueries[i]?.data?.workerOptions,
        });
      }
    }
    return out;
  }, [listed, workerQueries, ticketQueries, runningQueries, queuedQueries, modelQueries]);

  const liveIds = useMemo(() => cells.map((c) => c.agent.id), [cells]);
  const tailSlots = useMemo(
    () => liveRunTailSlots(cells.filter((c) => c.run && isActiveRun(c.run.status)).map((c) => c.agent.id)),
    [cells],
  );
  const commit = useCallback((id: string, next: CellSize) => {
    setSizes((prev) => writeLiveCellSizes(GLOBAL_SIZE_KEY, { ...prev, [id]: next }, liveIds));
  }, [liveIds]);

  const loaded = Boolean(workspaces.data) && workerQueries.every((q) => q.data !== undefined || q.isError);
  const failed = listed.map((w, i) => (workerQueries[i]?.isError ? w : null)).filter((w): w is NonNullable<typeof w> => w !== null);
  const n = cells.length;

  if (workspaces.isError) {
    return (
      <Page>
        <PageHeader title="Live" />
        <PageBody className="p-4 md:p-5">
          <ErrorState code="WORKSPACES_QUERY_FAILED" message="Could not load workspaces." onRetry={() => void workspaces.refetch()} />
        </PageBody>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="Live" meta={loaded ? (n === 1 ? '1 working' : `${n} working`) : undefined} />
      <PageBody className="p-4 md:p-5">
        {!workspaces.data ? (
          <SkeletonCards count={4} className="grid gap-3 sm:grid-cols-8 xl:grid-cols-12" />
        ) : !loaded ? (
          <SkeletonCards count={4} className="grid gap-3 sm:grid-cols-8 xl:grid-cols-12" />
        ) : n === 0 && failed.length === 0 ? (
          <EmptyState title="Nobody is working." detail="Live workers on a ticket across every workspace show up here." />
        ) : (
          <div className="flex flex-col gap-3">
            {failed.map((w) => (
              <ErrorState
                key={w.id}
                code="WORKERS_QUERY_FAILED"
                message={`Could not load who is working in ${w.name}.`}
                onRetry={() => void workerQueries[listed.findIndex((x) => x.id === w.id)]?.refetch()}
              />
            ))}
            {n > 0 ? (
              <div className="grid grid-flow-dense gap-3 sm:grid-cols-8 xl:grid-cols-12">
                {cells.map((c) => (
                  <LiveCell
                    key={c.agent.id}
                    agent={c.agent}
                    ticket={c.ticket}
                    run={c.run}
                    size={sizeOf(sizes, c.agent.id, colsMax)}
                    colsMax={colsMax}
                    desktop={minSm}
                    onSize={(next) => commit(c.agent.id, next)}
                    workerOptions={c.options}
                    ws={c.ws}
                    workspaceName={c.name}
                    streamLive={tailSlots.has(c.agent.id)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </PageBody>
    </Page>
  );
}
