import { useCallback } from 'react';
import { Page, PageBody, PageHeader } from '../components/Page';
import { DecisionCard } from '../components/DecisionCard';
import { SkeletonCards } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { Button } from '../components/Button';
import { useAnswerDecision, useDecisions, useTickets, useWorkers } from '../api/hooks';
import { useConnection, useWs } from '../api/context';
import { enqueue, useQueue } from '../lib/queue';
import { useToast } from '../components/Toast';
import { useGo } from '../app/link';
import { useListNav } from '../lib/hotkeys';

export function NeedsYouRoute(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const toast = useToast();
  const conn = useConnection();
  const decisions = useDecisions({ status: 'open', owner: 'human' });
  const conductorOwned = useDecisions({ status: 'open', owner: 'conductor' });
  const workers = useWorkers({ status: 'running' });
  const tickets = useTickets({ limit: 200 });
  const answer = useAnswerDecision();
  const queue = useQueue();
  const offline = conn.state === 'offline' || conn.state === 'unreachable';

  const items = decisions.data ?? [];
  const nav = useListNav(items.length, {
    onOpen: (i) => {
      const t = items[i]?.ticketId;
      if (t) go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: t } });
    },
  });

  const ticketOf = useCallback(
    (id: string | null) => (id ? tickets.data?.find((t) => t.id === id || t.identifier === id) : undefined),
    [tickets.data],
  );

  const onAnswer = (id: string, a: { key?: string; text?: string; remember?: boolean }): void => {
    if (offline) {
      enqueue({ kind: 'decision', path: `/decisions/${id}/answer`, body: a, label: a.key ?? a.text ?? 'decision' });
      toast.push({ title: 'Answer queued', detail: 'Re-validated against the ticket when the connection returns.', status: 'working' });
      return;
    }
    answer.mutate({ id, ...a }, { onSuccess: () => toast.push({ title: 'Recorded', detail: a.key ? `Answer: ${a.key}` : undefined, status: 'done', ttl: 4000 }) });
  };

  return (
    <Page>
      <PageHeader
        title="Needs you"
        meta={items.length ? `${items.length} waiting` : undefined}
        actions={
          <Button variant="ghost" size="sm" onClick={() => go('/w/$ws/chat', { params: { ws } })}>
            Open chat
          </Button>
        }
      />
      <PageBody className="p-4 md:p-5">
        {decisions.isLoading ? (
          <SkeletonCards count={2} className="mx-auto max-w-2xl" />
        ) : decisions.isError ? (
          <ErrorState className="mx-auto max-w-2xl" code="DECISIONS_STALE" message="Could not refresh the inbox; showing the last known state." onRetry={() => void decisions.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing needs you right now."
            detail={`${workers.data?.length ?? 0} workers running.`}
            action={
              <Button variant="secondary" onClick={() => go('/w/$ws/board', { params: { ws } })}>
                Open the board
              </Button>
            }
          />
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-3">
            {items.map((d, i) => {
              const t = ticketOf(d.ticketId);
              const isQueued = queue.some((q) => q.path.includes(d.id));
              return (
                <div key={d.id} onFocus={() => nav.setIndex(i)} className={i === nav.index ? 'ring-1 ring-accent-edge rounded-r8' : undefined}>
                  <DecisionCard
                    decision={d}
                    ticketIdentifier={t?.identifier ?? d.ticketId}
                    askedBy={d.askedByAgentId}
                    busy={answer.isPending}
                    queued={isQueued}
                    onAnswer={(a) => onAnswer(d.id, a)}
                  />
                </div>
              );
            })}

            {conductorOwned.data?.length ? (
              <section className="mt-4">
                <div className="ac-label mb-2">Conductor is deciding</div>
                <div className="flex flex-col gap-2">
                  {conductorOwned.data.map((d) => (
                    <div key={d.id} className="ac-card px-3.5 py-2.5">
                      <div className="text-meta text-text-2">{d.title}</div>
                      {d.recommendation ? <div className="mt-1 text-micro text-text-3">Leaning: {d.recommendation}</div> : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </PageBody>
    </Page>
  );
}
