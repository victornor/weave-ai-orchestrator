/**
 * V2's worker page (web-v2/worker-page, VS-350) at its VS-343 route.
 *
 * V1's worker detail restyled to the Mono language: identity and metadata, the Transcript/Brief tabs,
 * the header actions, the session-handover band and a steer composer that shares its draft with the
 * ticket reply box. The transcript is VS-345's shared `WorkerFeed`, not a private run stream.
 */
import { useEffect, useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { agentUiStatus, heldByHuman, projectLabel } from '@weave-ai/shared';
import { workerPauseReason } from '@weave-ai/render';
import {
  useEndHandover,
  useHandoverCommand,
  useStartHandover,
  useWorker,
  useWorkerAction,
  useWorkerBrief,
  useWorkerMessage,
} from '../api/hooks';
import { useWs } from '../api/context';
import { useGo } from '../app/link';
import { Button } from '../components/Button';
import { Composer } from '../components/Composer';
import { HandoverCommand } from '../components/HandoverCommand';
import { Markdown } from '../components/Markdown';
import { SkeletonRows } from '../components/Skeleton';
import { ErrorState } from '../components/States';
import { StatusBadge } from '../components/StatusGlyph';
import { Tabs } from '../components/Tabs';
import { draftKey, useDraft } from '../lib/drafts';
import { cents, tokens } from '../lib/format';
import { V2Page } from './V2Page';
import { WorkerFeed } from './WorkerFeed';

const TABS = [
  { key: 'transcript', label: 'Transcript' },
  { key: 'brief', label: 'Brief' },
] as const;

export function V2WorkerPage(): React.ReactElement {
  const { workerId } = useParams({ strict: false }) as { workerId?: string };
  return (
    <V2Page title="Worker" subtitle={workerId}>
      <WorkerBody workerId={workerId ?? ''} />
    </V2Page>
  );
}

export function WorkerBody({ workerId }: { workerId: string }): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const [tab, setTab] = useState<string>('transcript');
  const detail = useWorker(workerId);
  const brief = useWorkerBrief(workerId);
  const action = useWorkerAction();
  const message = useWorkerMessage();
  const held = detail.data ? heldByHuman(detail.data.agent) : false;
  const [sessionOpen, setSessionOpen] = useState(false);
  const [givingBack, setGivingBack] = useState(false);
  const handoverCommand = useHandoverCommand(workerId, sessionOpen || held);
  const startHandover = useStartHandover();
  const endHandover = useEndHandover();
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Every action on this page is a mutation; surface whichever one failed so a rejected Resume,
  // Relaunch, Cancel or handover is not mistaken for a no-op.
  const actionError = action.error ?? message.error ?? startHandover.error ?? endHandover.error;

  const steerTicketId = detail.data?.ticket?.id ?? null;
  const { draft, patch } = useDraft(steerTicketId ? draftKey(ws, `ticket:${steerTicketId}`) : null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => setLastOutcome(null), [workerId]);

  if (detail.isLoading) {
    return (
      <div className="p-5">
        <SkeletonRows rows={6} />
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="p-5">
        <ErrorState
          code="WORKER_NOT_FOUND"
          message="That worker has been archived."
          actions={
            <Button variant="link" onClick={() => go('/w/$ws/roles', { params: { ws } })}>
              Back to Roles
            </Button>
          }
        />
      </div>
    );
  }

  const { agent, ticket, project, usage, worktree, input } = detail.data;
  const pausedFor = workerPauseReason(agent);
  const steerLabel =
    lastOutcome ??
    (input.midTurn
      ? 'Reaches the running turn immediately.'
      : input.interrupts
        ? 'Interrupts the running turn; the agent answers once its next turn starts.'
        : `Queued for the next turn${input.reason ? ` — ${input.reason}` : ''}.`);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-v2-worker={agent.id}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line-1 px-4 py-2">
        <StatusBadge status={agentUiStatus(agent.status)} />
        <span className="text-ui font-medium text-text-1">{agent.name}</span>
        <span className="ac-mono min-w-0 flex-1 truncate text-nano text-text-3">
          {[project ? projectLabel(project) : null, ticket?.identifier, agent.runtimeId].filter(Boolean).join(' · ')}
          {usage ? ` · ${tokens(usage.tokensIn + usage.tokensOut)} tok · ${cents(usage.costCents)}` : ''}
          {worktree ? ` · ${worktree.dirty ? 'dirty' : worktree.status} ↑${worktree.ahead} ↓${worktree.behind}` : ''}
          {pausedFor ? ` · ${pausedFor}` : ''}
        </span>
        <div className="flex flex-none gap-2">
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
          {confirmCancel ? (
            <>
              <Button size="sm" variant="danger" onClick={() => action.mutate({ id: workerId, action: 'cancel', reason: 'cancelled from the web app' })}>
                Confirm cancel
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirmCancel(false)}>
                Keep running
              </Button>
            </>
          ) : (
            <Button size="sm" variant="danger" onClick={() => setConfirmCancel(true)}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {actionError ? (
        <p role="alert" className="border-b border-line-1 px-4 py-2 text-micro text-blocked" data-v2-worker-error>
          {actionError.message}
        </p>
      ) : null}

      <Tabs items={TABS} active={tab} onChange={setTab} className="border-b border-line-1 px-3 md:px-4" />

      {sessionOpen || held ? (
        <div className="v2-anim-fade flex-none border-b border-line-1 bg-bg-0 px-4 py-3 md:px-5">
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
                  }}
                />
              ) : (
                <Button size="sm" onClick={() => setGivingBack(true)}>
                  Give it back
                </Button>
              )
            ) : handoverCommand.data?.resumable ? (
              <Button size="sm" onClick={() => startHandover.mutate({ id: workerId })}>
                Take this session
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'transcript' ? (
          <div className="mx-auto max-w-3xl p-4 md:p-5">
            <WorkerFeed agentId={workerId} ws={ws} label={`${agent.name} transcript`} />
            <div ref={bottom} />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl p-4 md:p-5">
            <Markdown source={brief.data?.brief ?? '_No brief._'} />
          </div>
        )}
      </div>

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
                  outcome.delivery === 'mid_turn'
                    ? 'Delivered to the running turn.'
                    : outcome.delivery === 'interrupted'
                      ? 'Interrupted the running turn; it will be answered once the next turn starts.'
                      : 'Queued for the next turn.',
                );
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
