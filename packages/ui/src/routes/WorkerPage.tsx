import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import type { RunEvent } from '@weave-ai/shared';
import { agentUiStatus, heldByHuman, projectLabel } from '@weave-ai/shared';
import { workerPauseReason } from '@weave-ai/render';
import { Page, PageBody, PageHeader } from '../components/Page';
import { Tabs } from '../components/Tabs';
import { Transcript } from '../components/Transcript';
import { Composer } from '../components/Composer';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusGlyph';
import { SkeletonRows } from '../components/Skeleton';
import { ErrorState, EmptyState } from '../components/States';
import { Markdown } from '../components/Markdown';
import { HandoverCommand } from '../components/HandoverCommand';
import { useToast } from '../components/Toast';
import { useHandoverCommand, useEndHandover, useRunEvents, useStartHandover, useWorker, useWorkerAction, useWorkerBrief, useWorkerMessage } from '../api/hooks';
import { mergeRunEvents } from '../api/runStream';
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
  const message = useWorkerMessage();
  const toast = useToast();
  const held = detail.data ? heldByHuman(detail.data.agent) : false;
  const [sessionOpen, setSessionOpen] = useState(false);
  const [givingBack, setGivingBack] = useState(false);
  const handoverCommand = useHandoverCommand(workerId, sessionOpen || held);
  const startHandover = useStartHandover();
  const endHandover = useEndHandover();
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);
  // The steer box and the ticket page's reply box post to the same conversation, so they share one
  // draft: a note started on either is there on the other.
  const steerTicketId = detail.data?.ticket?.id ?? null;
  const { draft, patch } = useDraft(steerTicketId ? draftKey(ws, `ticket:${steerTicketId}`) : null);

  const runId = detail.data?.lastRun?.id ?? '';
  const persisted = useRunEvents(runId);
  const [live, setLive] = useState<RunEvent[]>([]);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => setLive([]), [runId]);
  useEffect(() => setLastOutcome(null), [workerId]);

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

  const { agent, ticket, project, usage, worktree, input } = detail.data;
  const pausedFor = workerPauseReason(agent);
  // `persisted` and `live` do not agree on `id` for the same row (VS-319), so merge by `seq`.
  const events = mergeRunEvents(persisted.data ?? [], live);
  // Before typing: whether a message would reach the running turn right now, and why not when it
  // wouldn't (VS-99). After sending: which of the two actually happened, until the next send.
  const steerLabel = lastOutcome ?? (input.midTurn
    ? 'Reaches the running turn immediately.'
    : input.interrupts
      ? 'Interrupts the running turn; the agent answers once its next turn starts.'
      : `Queued for the next turn${input.reason ? ` — ${input.reason}` : ''}.`);

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
            {[project ? projectLabel(project) : null, ticket?.identifier, agent.runtimeId].filter(Boolean).join(' · ')}
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
            {agent.status === 'paused' && !held ? (
              <Button size="sm" onClick={() => action.mutate({ id: workerId, action: 'resume' })}>
                Resume
              </Button>
            ) : null}
            {held ? (
              givingBack ? null : (
                <Button size="sm" onClick={() => { setSessionOpen(true); setGivingBack(true); }}>
                  Give it back
                </Button>
              )
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setSessionOpen((v) => !v)}>
                Session
              </Button>
            )}
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

      {sessionOpen || held ? (
        <div className="flex-none border-b border-line-1 bg-bg-0 px-4 py-3 md:px-5">
          <div className="mx-auto flex max-w-3xl flex-col gap-2.5">
            {handoverCommand.isLoading ? (
              <SkeletonRows rows={2} />
            ) : handoverCommand.data ? (
              <HandoverCommand result={handoverCommand.data} />
            ) : null}
            {held ? (
              givingBack ? (
                <Composer
                  rows={3}
                  placeholder="What did you do while you held this session?"
                  submitLabel="Give it back"
                  onSubmit={async (note) => {
                    await endHandover.mutateAsync({ id: workerId, note });
                    setGivingBack(false);
                    setSessionOpen(false);
                    toast.push({ title: 'Session given back', status: 'done', ttl: 4000 });
                  }}
                />
              ) : (
                <Button size="sm" onClick={() => setGivingBack(true)}>Give it back</Button>
              )
            ) : handoverCommand.data?.resumable ? (
              <Button
                size="sm"
                onClick={() => {
                  startHandover.mutate({ id: workerId }, {
                    onSuccess: () => toast.push({ title: 'Session taken', detail: 'Paste the command into a terminal on the daemon host.', status: 'done', ttl: 6000 }),
                    onError: (e) => toast.push({ title: 'Could not take the session', detail: e.message, status: 'failed' }),
                  });
                }}
              >
                Take this session
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

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
              queuedReason={steerLabel}
              value={draft.text}
              onChange={(text) => patch({ text })}
              onSubmit={async (body) => {
                const outcome = await message.mutateAsync({ id: workerId, ticketId: ticket.id, body, live: true });
                setLastOutcome(
                  outcome.delivery === 'mid_turn' ? 'Delivered to the running turn.'
                  : outcome.delivery === 'interrupted' ? 'Interrupted the running turn; it will be answered once the next turn starts.'
                  : 'Queued for the next turn.',
                );
              }}
            />
          </div>
        </div>
      ) : null}
    </Page>
  );
}
