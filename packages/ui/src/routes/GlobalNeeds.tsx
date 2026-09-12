/**
 * Daemon-wide Needs you (VS-168): open human-owned decisions from every workspace.
 */
import { useCallback } from 'react';
import type { Decision, DecisionAnswerInputs } from '@weave-ai/shared';
import { Page, PageBody, PageHeader } from '../components/Page';
import { DecisionCard } from '../components/DecisionCard';
import { PlanPreview } from '../components/PlanPreview';
import { SkeletonCards } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { useAnswerDecision, useDecisionsMany, useProjects, useTickets, useWorkspaceSummary, useWorkspaces } from '../api/hooks';
import { ApiError, NetworkError } from '../api/client';
import { enqueue, useQueue } from '../lib/queue';
import { decisionCarriesSecret } from '../lib/decisionSecrets';
import { staleAnswerCopy } from '../lib/decisionStaleness';
import { useToast } from '../components/Toast';
import { useGo } from '../app/link';
import { isAutoApproving } from '../lib/yolo';
import { isHiddenFromChat, useHiddenDecisions } from '../lib/hiddenDecisions';

function WorkspaceNeeds({
  ws,
  name,
  decisions,
  isError,
  onRetry,
}: {
  ws: string;
  name: string;
  decisions: Decision[] | undefined;
  isError: boolean;
  onRetry: () => void;
}): React.ReactElement | null {
  const go = useGo();
  const toast = useToast();
  const tickets = useTickets({ limit: 200 }, { ws });
  const projects = useProjects(ws);
  const summary = useWorkspaceSummary(ws);
  const answer = useAnswerDecision();
  const queue = useQueue();
  const { hidden, show } = useHiddenDecisions(ws);

  const ticketOf = useCallback(
    (id: string | null) => (id ? tickets.data?.find((t) => t.id === id || t.identifier === id) : undefined),
    [tickets.data],
  );

  const onAnswer = (id: string, a: { key?: string; text?: string; remember?: boolean; inputs?: DecisionAnswerInputs }): void => {
    const carriesSecret = decisionCarriesSecret(decisions?.find((d) => d.id === id));
    if (carriesSecret) {
      answer.mutate(
        { id, ws, ...a },
        {
          onSuccess: () => toast.push({ title: 'Recorded', detail: a.key ? `Answer: ${a.key}` : undefined, status: 'done', ttl: 4000 }),
          onError: (e) => {
            const stale = staleAnswerCopy(e, decisions?.find((d) => d.id === id)?.ticketId ?? null);
            if (stale) {
              toast.push({
                title: stale.title,
                detail: stale.detail,
                status: 'failed',
                action: stale.ticketId ? { label: 'View the new one', run: () => go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: stale.ticketId! } }) } : undefined,
              });
              return;
            }
            toast.push({ title: 'Could not record that answer', detail: e.message, status: 'failed' });
          },
        },
      );
      return;
    }
    answer.mutate(
      { id, ws, ...a },
      {
        onSuccess: () => toast.push({ title: 'Recorded', detail: a.key ? `Answer: ${a.key}` : undefined, status: 'done', ttl: 4000 }),
        onError: (e) => {
          if (e instanceof NetworkError) {
            enqueue({ kind: 'decision', path: `/decisions/${id}/answer`, body: a, label: a.key ?? a.text ?? 'decision' });
            toast.push({ title: 'Answer queued', detail: 'Re-validated against the ticket when the connection returns.', status: 'working' });
            return;
          }
          const stale = staleAnswerCopy(e, decisions?.find((d) => d.id === id)?.ticketId ?? null);
          if (stale) {
            toast.push({
              title: stale.title,
              detail: stale.detail,
              status: 'failed',
              action: stale.ticketId ? { label: 'View the new one', run: () => go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: stale.ticketId! } }) } : undefined,
            });
            return;
          }
          toast.push({
            title: e instanceof ApiError ? 'Could not record that answer' : 'Could not record that answer',
            detail: e.message,
            status: 'failed',
          });
        },
      },
    );
  };

  if (isError) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-ui font-medium text-text-1">{name}</h2>
        <ErrorState code="DECISIONS_STALE" message={`Could not load what needs you in ${name}.`} onRetry={onRetry} />
      </section>
    );
  }
  if (decisions === undefined) return null;
  if (decisions.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-ui font-medium text-text-1">{name}</h2>
      {decisions.map((d) => {
        const t = ticketOf(d.ticketId);
        const isQueued = queue.some((q) => q.path.includes(d.id));
        const isHidden = isHiddenFromChat(d, hidden);
        return (
          <div key={d.id}>
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
              ws={ws}
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
    </section>
  );
}

export function GlobalNeedsRoute(): React.ReactElement {
  const workspaces = useWorkspaces();
  const listed = workspaces.data ?? [];
  const ids = listed.map((w) => w.id);
  const queries = useDecisionsMany(ids, { status: 'open', owner: 'human' });

  const loaded = Boolean(workspaces.data) && queries.every((q) => q.data !== undefined || q.isError);
  const total = queries.reduce((n, q) => n + (q.data?.length ?? 0), 0);

  return (
    <Page>
      <PageHeader title="Needs you" meta={loaded && total ? `${total} waiting` : undefined} />
      <PageBody className="p-4 md:p-5">
        {workspaces.isError ? (
          <ErrorState className="mx-auto max-w-2xl" code="WORKSPACES_QUERY_FAILED" message="Could not load workspaces." onRetry={() => void workspaces.refetch()} />
        ) : !workspaces.data || !loaded ? (
          <SkeletonCards count={2} className="mx-auto max-w-2xl" />
        ) : total === 0 && queries.every((q) => !q.isError) ? (
          <EmptyState className="mx-auto max-w-2xl" title="Nothing needs you right now." detail="Open decisions from every workspace show up here." />
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            {listed.map((w, i) => (
              <WorkspaceNeeds
                key={w.id}
                ws={w.id}
                name={w.name}
                decisions={queries[i]?.data}
                isError={Boolean(queries[i]?.isError)}
                onRetry={() => void queries[i]?.refetch()}
              />
            ))}
          </div>
        )}
      </PageBody>
    </Page>
  );
}
