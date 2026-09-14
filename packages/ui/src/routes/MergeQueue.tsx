import { useEffect, useState } from 'react';
import { projectLabel, type UiStatus } from '@weave-ai/shared';
import { Page, PageBody, PageHeader } from '../components/Page';
import { Segmented } from '../components/Tabs';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { StatusGlyph } from '../components/StatusGlyph';
import { useMergeQueue, useProjects, useWorkers } from '../api/hooks';
import { useWs } from '../api/context';
import { useGo, useSearchParams } from '../app/link';
import type { MergeQueueEntry, MergeQueueOutcome } from '../api/types';
import { ago, duration } from '../lib/format';
import { mergeWaitLabel, mergeWaitPhase } from '../lib/board';

/** How a ticket left the queue, as a glyph and a word (PLAN §11.4). */
const OUTCOME: Record<MergeQueueOutcome['outcome'], { status: UiStatus; label: string }> = {
  landed: { status: 'done', label: 'landed' },
  failed: { status: 'failed', label: 'failed' },
  withdrawn: { status: 'idle', label: 'left the queue' },
};

/**
 * The merge queue, one project at a time (PLAN §11.4): what is landing now, who is waiting behind it,
 * and what recently left. Its own page rather than a card on the board, so it has room to say all of
 * it and the board keeps its own shape.
 */
export function MergeQueueRoute(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const search = useSearchParams();
  const projects = useProjects();
  const list = projects.data ?? [];

  // The project is addressed by id in the URL and mirrored into state, so a switch shows at once.
  // An id the workspace no longer has falls back to the first project rather than to an error.
  const [chosen, setChosen] = useState<string | undefined>(search['project']);
  useEffect(() => { setChosen(search['project']); }, [search['project']]);
  const projectId = list.some((p) => p.id === chosen) ? chosen : list[0]?.id;
  const project = list.find((p) => p.id === projectId);

  const queue = useMergeQueue(projectId);
  const workers = useWorkers({});
  const active = queue.data?.active ?? [];
  const waiting = queue.data?.waiting ?? [];
  const recent = queue.data?.recent ?? [];

  // Ticks the elapsed time of whatever is merging; nothing ticks while the queue is idle.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (active.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active.length]);

  const openTicket = (identifier: string): void => go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: identifier } });
  const openWorker = (workerId: string): void => go('/w/$ws/workers/$workerId', { params: { ws, workerId } });
  const choose = (id: string): void => {
    setChosen(id);
    go('/w/$ws/merge-queue', { params: { ws }, search: { ...search, project: id }, replace: true });
  };
  const workerName = (id: string | null): string | null => (id ? workers.data?.find((w) => w.id === id)?.name ?? null : null);

  return (
    <Page>
      <PageHeader
        title="Merge queue"
        meta={project ? <span>{projectLabel(project)}</span> : undefined}
        actions={
          list.length > 1 ? (
            <Segmented
              ariaLabel="Project"
              mono
              className="max-w-[60vw] md:max-w-none"
              options={list.map((p) => ({ value: p.id, label: projectLabel(p) }))}
              value={projectId ?? ''}
              onChange={choose}
            />
          ) : undefined
        }
      />
      <PageBody>
        {list.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No projects yet." detail="A project's tickets land through its merge queue." />
          </div>
        ) : queue.isLoading ? (
          <SkeletonRows rows={6} />
        ) : queue.isError ? (
          <ErrorState
            className="m-4"
            code="MERGE_QUEUE_QUERY_FAILED"
            message="Could not read this project's merge queue."
            onRetry={() => void queue.refetch()}
          />
        ) : (
          <div className="mx-auto max-w-[56rem] space-y-5 px-4 py-4 md:px-5">
            {active.length === 0 && waiting.length === 0 ? (
              <section className="ac-card p-4">
                <div className="flex items-center gap-2.5">
                  <StatusGlyph status="idle" size="sm" />
                  <span className="text-ui text-text-soft">Nothing is merging or waiting to merge.</span>
                </div>
                <p className="mt-1.5 text-micro text-text-3">
                  An approved ticket joins this queue and lands with {queue.data?.concurrency ?? 1} at a time.
                </p>
              </section>
            ) : (
              <>
                <section>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="ac-label">Landing now</span>
                    <span className="flex-1" />
                    <span className="ac-mono text-nano text-text-4">
                      {active.length} of {queue.data?.concurrency ?? 1} slots
                    </span>
                  </div>
                  {active.length === 0 ? (
                    <p className="text-micro text-text-3">Nothing is merging; the queue admits the next ticket in a moment.</p>
                  ) : (
                    <ul className="space-y-2">
                      {active.map((e) => {
                        const wait = mergeWaitLabel({ identifier: e.identifier, phase: mergeWaitPhase(e.ciState), since: e.ciStateAt }, now);
                        return (
                          <li key={e.ticketId} className="ac-card p-3.5">
                            <button
                              type="button"
                              onClick={() => openTicket(e.identifier)}
                              className="flex w-full items-center gap-2.5 text-left"
                            >
                              <StatusGlyph status="merging" size="sm" pulse />
                              <span className="ac-mono shrink-0 text-micro text-text-3">{e.identifier}</span>
                              <span className="min-w-0 flex-1 truncate text-ui text-text-1">{e.title}</span>
                              <span className="ac-mono shrink-0 text-nano text-text-4">
                                {duration(e.startedAt ? now - new Date(e.startedAt).getTime() : null)}
                              </span>
                            </button>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-micro text-text-3">
                              <span>{workerName(e.workerId) ?? 'no worker yet'}</span>
                              {wait ? (
                                <>
                                  <span className="text-text-4">·</span>
                                  <span className="ac-mono text-text-3">waiting {wait}</span>
                                </>
                              ) : null}
                              {e.workerId ? (
                                <>
                                  <span className="text-text-4">·</span>
                                  <button
                                    type="button"
                                    onClick={() => openWorker(e.workerId as string)}
                                    className="text-accent-link transition-colors duration-(--dur-fast) ease-ac hover:text-accent-hover"
                                  >
                                    Open the landing log →
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                <section>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="ac-label">Waiting</span>
                    <span className="ac-mono text-nano text-text-4">{waiting.length}</span>
                  </div>
                  {waiting.length === 0 ? (
                    <p className="text-micro text-text-3">Nothing is waiting behind it.</p>
                  ) : (
                    <ul>
                      {waiting.map((e) => (
                        <li key={e.ticketId}>
                          <QueueRow entry={e} onOpen={() => openTicket(e.identifier)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}

            <section>
              <div className="mb-1 flex items-center gap-2">
                <span className="ac-label">Recently left the queue</span>
              </div>
              {recent.length === 0 ? (
                <p className="text-micro text-text-3">Nothing has left this queue yet.</p>
              ) : (
                <ul>
                  {recent.map((o) => (
                    <li key={`${o.ticketId}-${o.at}`}>
                      <OutcomeRow outcome={o} onOpen={() => openTicket(o.identifier)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </PageBody>
    </Page>
  );
}

function QueueRow({ entry, onOpen }: { entry: MergeQueueEntry; onOpen: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2.5 border-b border-line-1 px-2 py-2 text-left transition-colors duration-(--dur-fast) ease-ac last:border-b-0 hover:bg-bg-3"
    >
      <span className="ac-mono w-6 shrink-0 text-nano text-text-4">#{entry.position}</span>
      <span className="ac-mono shrink-0 text-nano text-text-3">{entry.identifier}</span>
      <span className="min-w-0 flex-1 truncate text-meta text-text-2">{entry.title}</span>
      <span className="ac-mono shrink-0 text-nano text-text-4">waited {ago(entry.queuedAt)}</span>
    </button>
  );
}

function OutcomeRow({ outcome, onOpen }: { outcome: MergeQueueOutcome; onOpen: () => void }): React.ReactElement {
  const o = OUTCOME[outcome.outcome];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2.5 border-b border-line-1 px-2 py-2 text-left transition-colors duration-(--dur-fast) ease-ac last:border-b-0 hover:bg-bg-3"
    >
      <StatusGlyph status={o.status} size="xs" />
      <span className="w-24 shrink-0 whitespace-nowrap text-micro text-text-3">{o.label}</span>
      <span className="ac-mono shrink-0 text-nano text-text-3">{outcome.identifier}</span>
      <span className="min-w-0 flex-1 truncate text-meta text-text-2">{outcome.title}</span>
      <span className="ac-mono shrink-0 text-nano text-text-4">{ago(outcome.at)}</span>
    </button>
  );
}
