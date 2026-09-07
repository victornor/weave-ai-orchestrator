import { useCallback } from 'react';
import type { DecisionAnswerInputs } from '@agent-conductor/shared';
import { Page, PageBody, PageHeader } from '../components/Page';
import { DecisionCard } from '../components/DecisionCard';
import { PlanPreview } from '../components/PlanPreview';
import { SkeletonCards } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { Button } from '../components/Button';
import { useAnswerDecision, useDecisions, useProjects, useTickets, useWorkers, useWorkspaceSummary } from '../api/hooks';
import { useConnection, useWs } from '../api/context';
import { enqueue, useQueue } from '../lib/queue';
import { decisionCarriesSecret } from '../lib/decisionSecrets';
import { useToast } from '../components/Toast';
import { useGo } from '../app/link';
import { useListNav } from '../lib/hotkeys';
import { isAutoApproving } from '../lib/yolo';
import { isHiddenFromChat, useHiddenDecisions } from '../lib/hiddenDecisions';

export function NeedsYouRoute(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const toast = useToast();
  const conn = useConnection();
  const decisions = useDecisions({ status: 'open', owner: 'human' });
  const conductorOwned = useDecisions({ status: 'open', owner: 'conductor' });
  const workers = useWorkers({ status: 'running' });
  const tickets = useTickets({ limit: 200 });
  const projects = useProjects();
  const summary = useWorkspaceSummary();
  const answer = useAnswerDecision();
  const queue = useQueue();
  // Hiding a card from the conductor chat never takes it off this page — this is where a decision
  // put off until later is still waiting — but the page says which ones were hidden and offers each
  // of them back, so the chat's pinned area is never a mystery from here (VS-72).
  const { hidden, show } = useHiddenDecisions(ws);
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

  const onAnswer = (id: string, a: { key?: string; text?: string; remember?: boolean; inputs?: DecisionAnswerInputs }): void => {
    // The queue is localStorage. A card that collected a credential must never go into it, so this
    // answer goes to the daemon or nowhere, and the human is told it was not sent (VS-92).
    const carriesSecret = decisionCarriesSecret(decisions.data?.find((d) => d.id === id));
    if (offline && carriesSecret) {
      toast.push({ title: 'Not sent', detail: 'This card holds a secret, so it is never stored on this device. Send it again when you are back online.', status: 'failed' });
      return;
    }
    if (offline) {
      enqueue({ kind: 'decision', path: `/decisions/${id}/answer`, body: a, label: a.key ?? a.text ?? 'decision' });
      toast.push({ title: 'Answer queued', detail: 'Re-validated against the ticket when the connection returns.', status: 'working' });
      return;
    }
    answer.mutate(
      { id, ...a },
      {
        onSuccess: () => toast.push({ title: 'Recorded', detail: a.key ? `Answer: ${a.key}` : undefined, status: 'done', ttl: 4000 }),
        onError: (e) => toast.push({
          title: carriesSecret ? 'Not sent' : 'Could not record that answer',
          detail: carriesSecret ? `${e.message} — nothing was stored on this device; send it again.` : e.message,
          status: 'failed',
        }),
      },
    );
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
              const isHidden = isHiddenFromChat(d, hidden);
              return (
                <div key={d.id} onFocus={() => nav.setIndex(i)} className={i === nav.index ? 'ring-1 ring-accent-edge rounded-r8' : undefined}>
                  {isHidden ? (
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="ac-mono text-micro text-text-4">Hidden from chat</span>
                      <button type="button" onClick={() => show(d.id)} className="text-micro font-medium text-accent-link hover:text-accent-hover">
                        Show in chat again
                      </button>
                    </div>
                  ) : null}
                  <DecisionCard
                    decision={d}
                    ticketIdentifier={t?.identifier ?? d.ticketId}
                    projectSlug={projects.data?.find((p) => p.id === (d.projectId ?? t?.projectId))?.slug ?? null}
                    askedBy={d.askedByAgentId}
                    busy={answer.isPending}
                    queued={isQueued}
                    plan={<PlanPreview decision={d} />}
                    autoApproving={isAutoApproving(d, summary.data?.config, projects.data?.find((p) => p.id === t?.projectId))}
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
