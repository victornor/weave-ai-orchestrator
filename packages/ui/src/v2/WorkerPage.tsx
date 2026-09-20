/**
 * V2's worker page (web-v2/worker-page, VS-350) at its VS-343 route.
 *
 * V1's worker detail restyled to the Mono language: identity and metadata, the Transcript/Brief tabs,
 * the header actions, the session-handover band and a steer composer that shares its draft with the
 * ticket reply box. The transcript is VS-345's shared `WorkerFeed`, not a private run stream.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { agentUiStatus, heldByHuman, projectLabel, type ThreadMessage } from '@weave-ai/shared';
import { workerPauseReason } from '@weave-ai/render';
import {
  useCompactWorker,
  useEndHandover,
  useHandoverCommand,
  useModels,
  usePostThreadMessage,
  useRuns,
  useSetSessionOption,
  useStartHandover,
  useThreadMessages,
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
import { cx } from '../lib/cx';
import { sessionConversationRows } from '../lib/sessionConversation';
import { V2Page } from './V2Page';
import { WorkerFeed } from './WorkerFeed';
import { SessionTurn } from './SessionTurn';
import { useTicketLink } from './ticket/TicketModal';

const TABS = [
  { key: 'transcript', label: 'Transcript' },
  { key: 'brief', label: 'Brief' },
] as const;

/**
 * VS-553: who a session message is from, named for the human. Attribution is by `authorKind`, never
 * by direction: a missing or unexpected direction used to fall through to `you` and put the agent's
 * own words in the human's mouth. The session's own agent is named by its role (what the human
 * recognises), the weaver — the only other agent that posts into this thread — by `Weaver`, a system
 * notice by `System`, and any kind this surface does not know by its own name rather than `you`.
 */
export function sessionAuthorLabel(
  message: Pick<ThreadMessage, 'authorKind' | 'authorId'>,
  sessionAgentId: string,
  roleName: string,
): string {
  switch (message.authorKind) {
    case 'human':
      return 'you';
    case 'agent':
      return message.authorId === sessionAgentId ? roleName : 'Weaver';
    case 'system':
      return 'System';
    default:
      return message.authorKind;
  }
}

/**
 * VS-495: a persistent session with no ticket has no ticket-comment history for `WorkerFeed` to
 * read — its conversation lives in its own thread instead, the same storage the weaver's own chat
 * uses. This renders that thread plainly: no decision cards, no dispatch chips — those are
 * `ChatConversation`'s weaver/planner-only extras (see `PlanTab`), and a persistent session's
 * ticketless turns raise none of them.
 *
 * VS-618: it renders the raw session, not a list of delivered answers. The human's messages,
 * system notices and relays are interleaved in time with each turn's own transcript (assistant
 * text, tool calls, diffs, file previews, commands), live while a turn runs and unchanged after.
 * The engine's delivered copy of a turn's final text is not rendered again — the transcript holds
 * those words — so nothing is shown twice.
 */
export function SessionThreadFeed({ threadId, label, sessionAgentId, roleName }: { threadId: string; label: string; sessionAgentId: string; roleName: string }): React.ReactElement {
  const onTicket = useTicketLink();
  const history = useThreadMessages(threadId);
  // The session's runs come from the same `useRuns` query `useWorkerRun` already makes, so this is a
  // cache hit, not a second request. Bound them to the loaded conversation window so a long history
  // does not mount a transcript per turn ever recorded.
  const recent = useRuns({ limit: 200 });
  const messages = history.data ?? [];
  const oldest = messages[0]?.createdAt;
  const runs = useMemo(
    () => (oldest ? (recent.data ?? []).filter((r) => r.agentId === sessionAgentId && (r.startedAt ?? r.createdAt) >= oldest) : []),
    [recent.data, sessionAgentId, oldest],
  );
  const { rows, answersByRun } = useMemo(
    () => sessionConversationRows(messages, runs, sessionAgentId),
    [messages, runs, sessionAgentId],
  );
  if (history.isLoading) return <SkeletonRows rows={4} />;
  if (history.isError) return <ErrorState code="THREAD_UNREADABLE" message={history.error?.message ?? 'Could not load this conversation.'} />;
  if (!rows.length) return <p className="text-meta text-text-3">Nothing said yet — say something below.</p>;
  return (
    <ol aria-label={label} className="flex flex-col gap-3">
      {rows.map((row) =>
        row.kind === 'turn' ? (
          <li key={row.key}>
            <SessionTurn run={row.run} deliveredText={answersByRun.get(row.run.id) ?? null} onTicket={onTicket} />
          </li>
        ) : row.message.authorKind === 'system' ? (
          // VS-596: a system notice (a real failure reason) is a state, not a message from either
          // party — centred and muted, never attributed to the session or the human.
          <li key={row.key} className="flex flex-col items-center gap-1">
            <div className="max-w-[85%] rounded-r6 border border-line-1 px-3 py-2 text-center text-meta text-text-3">
              <Markdown source={row.message.body} />
            </div>
            <span className="ac-mono text-nano text-text-4">{sessionAuthorLabel(row.message, sessionAgentId, roleName)}</span>
          </li>
        ) : (
          <li key={row.key} className={cx('flex flex-col gap-1', row.message.direction === 'outbound' ? 'items-start' : 'items-end')}>
            <div className={cx('max-w-[85%] rounded-r6 px-3 py-2 text-meta', row.message.direction === 'outbound' ? 'bg-bg-2 text-text-1' : 'bg-accent-tint text-text-1')}>
              <Markdown source={row.message.body} />
            </div>
            <span className="ac-mono text-nano text-text-4">{sessionAuthorLabel(row.message, sessionAgentId, roleName)}</span>
          </li>
        ),
      )}
    </ol>
  );
}

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
  const onTicket = useTicketLink();
  const [tab, setTab] = useState<string>('transcript');
  const detail = useWorker(workerId);
  const brief = useWorkerBrief(workerId);
  const action = useWorkerAction();
  const message = useWorkerMessage();
  const postThreadMessage = usePostThreadMessage();
  const compact = useCompactWorker(workerId);
  const models = useModels();
  const setSessionOption = useSetSessionOption(workerId);
  const [optionCandidate, setOptionCandidate] = useState<string | null>(null);
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

  const { agent, ticket, thread, project, usage, worktree, input } = detail.data;
  const isSession = agent.kind === 'session';
  const pausedFor = workerPauseReason(agent);
  // VS-526: the catalog option this session runs on, and the runtime each option resolves to. Only a
  // catalog with a configured option can be chosen; the rest are shown disabled.
  const configuredOptions = (models.data?.workerOptions ?? []).filter((o) => o.runtime);
  const currentOption = configuredOptions.find((o) => o.id === agent.workerModelId) ?? null;
  const currentRuntime = currentOption?.runtime ?? models.data?.workers.runtime ?? agent.runtimeId;
  const candidate = optionCandidate ? configuredOptions.find((o) => o.id === optionCandidate) ?? null : null;
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
          {isSession && configuredOptions.length > 0 ? (
            <label className="flex items-center gap-1.5 text-micro text-text-3">
              <span className="ac-label">Option</span>
              <select
                className="ac-input ac-mono py-1 text-nano"
                data-v2-session-option
                value={agent.workerModelId ?? ''}
                onChange={(e) => {
                  const next = e.target.value;
                  // Only stage the change; it is applied from the confirm band below, which first
                  // states what it does to the conversation.
                  if (next !== (agent.workerModelId ?? '')) { setSessionOption.reset(); setOptionCandidate(next); }
                }}
              >
                <option value="" disabled={configuredOptions.length > 0}>{currentOption ? 'workers setting' : '(workers setting)'}</option>
                {configuredOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.id}</option>
                ))}
              </select>
            </label>
          ) : null}
          {isSession ? (
            <Button size="sm" variant="secondary" disabled={compact.isPending} onClick={() => compact.mutate()}>
              {compact.isPending ? 'Compacting…' : 'Compact now'}
            </Button>
          ) : null}
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

      {agent.errorText ? (
        <p role="alert" className="border-b border-line-1 px-4 py-2 text-micro text-blocked" data-v2-worker-failure>
          {agent.errorText}
        </p>
      ) : null}

      {candidate ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line-1 px-4 py-2 text-micro" data-v2-session-option-confirm>
          <span className={candidate.runtime === currentRuntime ? 'text-text-3' : 'text-blocked'}>
            {candidate.runtime === currentRuntime
              ? `Switch to ${candidate.id} (${candidate.runtime}) — same runtime, the conversation is kept.`
              : `Switch to ${candidate.id} (${candidate.runtime}) — a different runtime, so the conversation restarts on ${candidate.runtime} and the current history does not carry over.`}
          </span>
          <Button size="sm" disabled={setSessionOption.isPending} onClick={() => setSessionOption.mutate({ workerModelId: candidate.id }, { onSuccess: () => setOptionCandidate(null) })}>
            {setSessionOption.isPending ? 'Switching…' : 'Switch'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOptionCandidate(null)}>Keep</Button>
        </div>
      ) : null}

      {isSession && agent.workerModelId && detail.data.sessionTurns === 0 ? (
        <p className="border-b border-line-1 px-4 py-2 text-micro text-text-3" data-v2-session-restarted>
          New conversation on {agent.runtimeId} — the previous one is not carried over (it started on a different runtime).
        </p>
      ) : null}

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
            {isSession && !ticket && thread ? (
              <SessionThreadFeed
                threadId={thread.id}
                label={`${agent.name} conversation`}
                sessionAgentId={agent.id}
                roleName={detail.data.role?.name ?? agent.name}
              />
            ) : (
              <WorkerFeed agentId={workerId} ws={ws} label={`${agent.name} transcript`} onTicket={onTicket} />
            )}
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
      ) : isSession && thread ? (
        // VS-495: a persistent session's ticketless conversation posts to its own thread — the same
        // storage and route the weaver's own chat uses — never a ticket comment, since there is none.
        <div className="flex-none border-t border-line-1 bg-bg-0 px-4 py-3 md:px-5">
          <div className="mx-auto max-w-3xl">
            {/* Uncontrolled (no value/onChange): there is no ticket to key a persisted draft on
                (`steerTicketId` is null here), and a draft key of null makes `patch` a no-op while
                `value` stays fixed at the empty string — passing them would make typing impossible. */}
            <Composer
              placeholder="Talk to this session…"
              submitLabel="Send"
              onSubmit={async (body) => { await postThreadMessage.mutateAsync({ threadId: thread.id, body }); }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
