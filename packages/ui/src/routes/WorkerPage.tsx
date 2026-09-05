import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import type { RunEvent } from '@agent-conductor/shared';
import { agentUiStatus } from '@agent-conductor/shared';
import { workerPauseReason } from '@agent-conductor/render';
import { Page, PageBody, PageHeader } from '../components/Page';
import { Tabs } from '../components/Tabs';
import { Transcript } from '../components/Transcript';
import { Composer } from '../components/Composer';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusGlyph';
import { SkeletonRows } from '../components/Skeleton';
import { ErrorState, EmptyState } from '../components/States';
import { Markdown } from '../components/Markdown';
import { usePostComment, useRunEvents, useWorker, useWorkerAction, useWorkerBrief } from '../api/hooks';
import { useWorkspaceEvents, useWs } from '../api/context';
import { useGo } from '../app/link';
import { cents, tokens } from '../lib/format';
import { draftKey, useDraft } from '../lib/drafts';

const TABS = [
  { key: 'transcript', label: 'Transcript' },
  { key: 'brief', label: 'Brief' },
] as const;

export function WorkerRoute(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const { workerId } = useParams({ strict: false }) as { workerId: string };
  const [tab, setTab] = useState<string>('transcript');
  const detail = useWorker(workerId);
  const brief = useWorkerBrief(workerId);
  const action = useWorkerAction();
  const comment = usePostComment();
  // The steer box and the ticket page's reply box post to the same conversation, so they share one
  // draft: a note started on either is there on the other.
  const steerTicketId = detail.data?.ticket?.id ?? null;
  const { draft, patch } = useDraft(steerTicketId ? draftKey(ws, `ticket:${steerTicketId}`) : null);

  const runId = detail.data?.lastRun?.id ?? '';
  const persisted = useRunEvents(runId);
  const [live, setLive] = useState<RunEvent[]>([]);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => setLive([]), [runId]);

  // Live transcript: `run.event` frames append to what the API already gave us.
  useWorkspaceEvents(
    useCallback(
      (e) => {
        if (e.type !== 'run.event') return;
        const p = e.payload as { runId?: string; event?: RunEvent } | null;
        if (!p?.event || (p.runId && runId && p.runId !== runId)) return;
        setLive((xs) => (xs.some((x) => x.id === p.event!.id) ? xs : [...xs, p.event!]));
      },
      [runId],
    ),
  );

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [live.length, persisted.data]);

  if (detail.isLoading) {
    return (
      <Page>
        <PageHeader title="Worker" />
        <PageBody className="p-5">
          <SkeletonRows rows={6} />
        </PageBody>
      </Page>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Page>
        <PageHeader title="Worker" />
        <PageBody className="p-5">
          <ErrorState code="WORKER_NOT_FOUND" message="That worker has been archived." actions={<Button variant="link" onClick={() => go('/w/$ws/team', { params: { ws } })}>Back to Team</Button>} />
        </PageBody>
      </Page>
    );
  }

  const { agent, ticket, project, usage, worktree } = detail.data;
  const pausedFor = workerPauseReason(agent);
  const events = [...(persisted.data ?? []), ...live];

  return (
    <Page>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <StatusBadge status={agentUiStatus(agent.status)} />
            <span>{agent.name}</span>
          </span>
        }
        meta={
          <span className="ac-mono">
            {[project?.slug, ticket?.identifier, agent.runtimeId, agent.model].filter(Boolean).join(' · ')}
            {usage ? ` · ${tokens(usage.tokensIn + usage.tokensOut)} tok · ${cents(usage.costCents)}` : ''}
            {worktree ? ` · ${worktree.dirty ? 'dirty' : worktree.status} ↑${worktree.ahead} ↓${worktree.behind}` : ''}
            {pausedFor ? <span className="text-blocked"> · {pausedFor}</span> : null}
          </span>
        }
        actions={
          <div className="flex gap-2">
            {ticket ? (
              <Button variant="ghost" size="sm" onClick={() => go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: ticket.identifier } })}>
                Ticket
              </Button>
            ) : null}
            {agent.status === 'paused' ? (
              <Button size="sm" onClick={() => action.mutate({ id: workerId, action: 'resume' })}>
                Resume
              </Button>
            ) : null}
            <Button size="sm" onClick={() => action.mutate({ id: workerId, action: 'relaunch', note: 'relaunched from the web app' })}>
              Relaunch
            </Button>
            <Button size="sm" variant="danger" onClick={() => action.mutate({ id: workerId, action: 'cancel', reason: 'cancelled from the web app' })}>
              Cancel
            </Button>
          </div>
        }
        tabs={<Tabs items={TABS} active={tab} onChange={setTab} className="px-3 md:px-4" />}
      />

      <PageBody>
        {tab === 'transcript' ? (
          events.length ? (
            <>
              <Transcript events={events} />
              <div ref={bottom} />
            </>
          ) : (
            <div className="p-6">
              <EmptyState title="No run yet." detail="The transcript starts when the worker's next turn does." />
            </div>
          )
        ) : (
          <div className="mx-auto max-w-3xl p-4 md:p-5">
            <Markdown source={brief.data?.brief ?? '_No brief._'} />
          </div>
        )}
      </PageBody>

      {ticket ? (
        <div className="flex-none border-t border-line-1 bg-bg-0 px-4 py-3 md:px-5">
          <div className="mx-auto max-w-3xl">
            <Composer
              placeholder="Steer this worker — posts a ticket comment and wakes it…"
              submitLabel="Send"
              value={draft.text}
              onChange={(text) => patch({ text })}
              onSubmit={(body) => comment.mutate({ id: ticket.id, body })}
            />
          </div>
        </div>
      ) : null}
    </Page>
  );
}
