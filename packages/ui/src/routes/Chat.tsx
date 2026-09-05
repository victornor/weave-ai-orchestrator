import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project, ThreadMessage } from '@agent-conductor/shared';
import { ticketUiStatus, agentUiStatus, isActiveRun, isHumanReplyToolEvent } from '@agent-conductor/shared';
import { Page, PageBody, PageHeader } from '../components/Page';
import { Composer } from '../components/Composer';
import { DecisionCard } from '../components/DecisionCard';
import { PlanPreview } from '../components/PlanPreview';
import { DispatchLabel } from '../components/DispatchLabel';
import { WorkerChip, CommandChip } from '../components/Chips';
import { Skeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { Markdown } from '../components/Markdown';
import { StatusGlyph } from '../components/StatusGlyph';
import { Transcript } from '../components/Transcript';
import { ScrollToBottomButton } from '../components/ScrollToBottom';
import {
  useAnswerDecision,
  useConductor,
  useCreateThread,
  useDecisions,
  usePostThreadMessage,
  useProjects,
  useThreadMessages,
  useThreads,
  useTickets,
  useWorkers,
} from '../api/hooks';
import { useRunEventStream } from '../api/runStream';
import { useConnection, useWorkspaceEvents, useWs } from '../api/context';
import { chatEntries } from '../lib/dispatch';
import { useStickToBottom } from '../lib/stickToBottom';
import { enqueue, useQueueCount } from '../lib/queue';
import { useToast } from '../components/Toast';
import { useGo } from '../app/link';
import { clock } from '../lib/format';
import { cx } from '../lib/cx';

const IDENTIFIER = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

/** Ticket identifiers in agent text become chips that expand inline. */
function MessageBody({
  body,
  onTicket,
}: {
  body: string;
  onTicket: (id: string) => void;
  ticketStatus: (id: string) => ReturnType<typeof ticketUiStatus> | null;
}): React.ReactElement {
  // Ticket identifiers become chips, but the rest of the message is still markdown: the identifiers
  // are rewritten into anchors the markdown renderer keeps, and clicks on those open the ticket.
  const source = useMemo(() => body.replace(IDENTIFIER, (id) => `[${id}](#ticket:${id})`), [body]);
  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const a = (e.target as HTMLElement).closest('a[href^="#ticket:"]');
    if (!a) return;
    e.preventDefault();
    onTicket(decodeURIComponent(a.getAttribute('href')!.slice('#ticket:'.length)));
  };
  return (
    <div onClick={onClick}>
      <Markdown source={source} className="text-body" />
    </div>
  );
}

export function ChatRoute(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const toast = useToast();
  const conn = useConnection();
  const threads = useThreads();
  const createThread = useCreateThread();
  const [threadId, setThreadId] = useState<string | null>(null);
  const messages = useThreadMessages(threadId);
  const post = usePostThreadMessage();
  // Answered decisions are loaded too: an answered card stays in the conversation as the record of
  // what was decided. The limit is explicit because mixing answered rows into a `created_at DESC`
  // list could otherwise push an old open decision out of the default page.
  const decisions = useDecisions({ status: ['open', 'answered'], owner: 'human', limit: 200 });
  const answer = useAnswerDecision();
  // Terminal tickets and retired workers are exactly the dispatches whose labels must keep showing.
  const tickets = useTickets({ limit: 200, includeTerminal: true });
  const workers = useWorkers({ includeRetired: true });
  const projects = useProjects();
  const queuedCount = useQueueCount('thread');
  /** The project chosen beside the input; `undefined` until the human touches it, so the thread decides. */
  const [pickedProject, setPickedProject] = useState<string | null | undefined>(undefined);
  /** The conductor message the next message answers, or null. Choosing another replaces it. */
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const conductor = useConductor();
  const conductorId = conductor.data?.agent.id ?? null;
  /** The conductor run being streamed, or null when it is idle. */
  const [runId, setRunId] = useState<string | null>(null);
  /** Bridges the gap between posting and the daemon starting the run, so "working" shows at once. */
  const [sending, setSending] = useState(false);
  const offline = conn.state === 'offline' || conn.state === 'unreachable';

  const runEvents = useRunEventStream(runId);
  // The reply renders as the thread message ac_human_send created; showing the call too would
  // put the same words on screen twice.
  const liveEvents = useMemo(() => runEvents.filter((e) => !isHumanReplyToolEvent(e)), [runEvents]);
  const working = sending || runId !== null;

  useEffect(() => {
    if (threadId) return;
    const first = threads.data?.[0];
    if (first) setThreadId(first.id);
    else if (threads.isSuccess && !createThread.isPending && !createThread.data) createThread.mutate({}, { onSuccess: (t) => setThreadId(t.id) });
  }, [threads.data, threads.isSuccess, threadId, createThread]);

  // Resume mid-turn: a chat that loads while the conductor is working streams the run in flight.
  useEffect(() => {
    const last = conductor.data?.lastRun;
    if (last && isActiveRun(last.status)) setRunId((cur) => cur ?? last.id);
  }, [conductor.data?.lastRun]);

  // The conductor's turns are the ones we stream; `run.started` carries the agent it belongs to.
  useWorkspaceEvents(
    useCallback(
      (e) => {
        if (e.type !== 'run.started' && e.type !== 'run.finished') return;
        const p = e.payload as { agentId?: string } | null;
        if (!conductorId || p?.agentId !== conductorId) return;
        if (e.type === 'run.started') setRunId(e.entityId);
        else {
          setRunId((cur) => (cur === null || cur === e.entityId ? null : cur));
          setSending(false);
        }
      },
      [conductorId],
    ),
  );

  // One hook owns the list's two ends. New messages and streamed events follow the bottom only while
  // the human is there; scrolled up, they land below the fold behind the scroll-to-bottom button
  // instead of moving the viewport. At the other end, reaching the top pulls in the page before the
  // loaded history and holds the viewport on what they were reading while it lands.
  const stick = useStickToBottom([messages.data, liveEvents.length], {
    ready: !messages.isLoading,
    older: { hasOlder: messages.hasOlder, isLoadingOlder: messages.isLoadingOlder, loadOlder: messages.loadOlder },
  });

  const ticketStatus = useCallback(
    (identifier: string) => {
      const t = tickets.data?.find((x) => x.identifier === identifier);
      return t ? ticketUiStatus(t.status) : null;
    },
    [tickets.data],
  );

  const openTicket = useCallback((identifier: string) => go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: identifier } }), [go, ws]);
  const openWorker = useCallback((workerId: string) => go('/w/$ws/workers/$workerId', { params: { ws, workerId } }), [go, ws]);

  useEffect(() => setPickedProject(undefined), [threadId]);
  useEffect(() => setReplyToId(null), [threadId]);

  // The quote in the composer comes from the message the human clicked, which is on screen by
  // definition; the quote on an already-sent message comes from its own `replyToExcerpt`.
  const replyTo = useMemo(
    () => (replyToId ? (messages.data ?? []).find((m) => m.id === replyToId) ?? null : null),
    [replyToId, messages.data],
  );

  // The default is the project the thread last used — read off its own messages, so it is the same
  // on every device and needs no client-side storage.
  const lastUsedProject = useMemo(() => {
    const inbound = (messages.data ?? []).filter((m) => m.direction === 'inbound');
    return inbound.length ? (inbound[inbound.length - 1]!.projectId ?? null) : null;
  }, [messages.data]);
  const projectId = pickedProject === undefined ? lastUsedProject : pickedProject;
  const projectName = useCallback(
    (id: string) => projects.data?.find((p) => p.id === id)?.name ?? id,
    [projects.data],
  );

  // Each message, followed by the dispatches its turn filed and the decisions it raised; work and
  // decisions with no anchor fall out.
  const { entries, unattributed, unanchoredDecisions } = useMemo(
    () => chatEntries(messages.data ?? [], tickets.data ?? [], workers.data ?? [], decisions.data ?? []),
    [messages.data, tickets.data, workers.data, decisions.data],
  );
  // A decision below the conversation is a prompt, not a record: only the open ones belong there.
  const waiting = useMemo(() => unanchoredDecisions.filter((d) => d.status === 'open'), [unanchoredDecisions]);

  const answerDecision = (id: string, a: { key?: string; text?: string }): void =>
    answer.mutate(
      { id, ...a },
      { onError: (e) => toast.push({ title: 'Could not record that answer', detail: e.message, status: 'failed' }) },
    );

  const send = (text: string): void => {
    if (!threadId) return;
    // Slash commands are resolved client-side where they are pure navigation.
    const talk = /^\/talk\s+(\S+)/.exec(text);
    if (talk?.[1]) {
      openTicket(talk[1].toUpperCase());
      return;
    }
    if (/^\/conductor\b/.test(text)) {
      go('/w/$ws/team', { params: { ws } });
      return;
    }
    const d = /^\/d\s+(\S+)\s*(\S+)?/.exec(text);
    if (d?.[1]) {
      answerDecision(d[1], d[2] ? { key: d[2] } : {});
      return;
    }
    if (offline) {
      enqueue({
        kind: 'thread',
        path: `/threads/${threadId}/messages`,
        body: { body: text, ...(projectId ? { projectId } : {}), ...(replyToId ? { replyToMessageId: replyToId } : {}) },
        label: text.slice(0, 60),
      });
      // Cleared on both paths: the next message must not be silently attributed to the same question.
      setReplyToId(null);
      return;
    }
    setSending(true);
    post.mutate({ threadId, body: text, projectId, ...(replyToId ? { replyToMessageId: replyToId } : {}) });
    setReplyToId(null);
  };

  // Onboarding: the conductor's first-run interview is just Chat with a
  // progress bar, shown while the workspace has no projects.
  const onboarding = projects.isSuccess && (projects.data?.length ?? 0) === 0;
  // The worker list is no longer filtered to running, so the header counts them itself.
  const running = (workers.data ?? []).filter((w) => w.status === 'running').length;
  const answered = Math.min(5, (messages.data ?? []).filter((m) => m.direction === 'inbound').length);

  return (
    <Page>
      <PageHeader
        title="Conductor"
        meta={`${running} workers running · ${(decisions.data ?? []).filter((d) => d.status === 'open').length} need you`}
        actions={<span className="ac-mono hidden text-micro text-text-nav md:block">/brief</span>}
      />

      {onboarding ? (
        <div className="flex items-center gap-3 border-b border-line-1 bg-bg-1 px-4 py-2.5">
          <span className="text-meta text-text-2">Setting up your workspace</span>
          <span className="h-1.5 w-32 overflow-hidden rounded-pill bg-bg-3">
            <span className="block h-full rounded-pill bg-accent transition-[width] duration-(--dur-panel) ease-ac" style={{ width: `${(answered / 5) * 100}%` }} />
          </span>
          <span className="ac-mono text-micro text-text-3">{answered}/5</span>
        </div>
      ) : null}

      {/* The button floats over the list, so it is anchored to this wrapper rather than to the
          scrolled content, which would carry it away with the rest. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <PageBody scrollRef={stick.scrollRef} className="px-4 py-5 md:px-7">
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {/* Above the history, where the page being fetched will appear. Nothing marks the start
                of the thread: the loads simply stop once the API has answered with a short page. */}
            {messages.isLoadingOlder ? (
              <div role="status" className="flex justify-center">
                <span className="ac-mono text-micro text-text-4">Loading earlier messages…</span>
              </div>
            ) : null}

            {messages.isLoading ? (
              <>
                <Skeleton className="ml-auto h-12 w-2/3 rounded-r10" />
                <Skeleton className="h-16 w-4/5 rounded-r6" />
                <Skeleton className="h-24 w-full rounded-r8" />
              </>
            ) : messages.isError ? (
              <ErrorState code="CONDUCTOR_UNREACHABLE" message="Could not load the thread; the history below is the last known state." onRetry={() => void messages.refetch()} />
            ) : (messages.data?.length ?? 0) === 0 ? (
              <EmptyState
                title="Tell me what you need."
                detail={
                  <>
                    Try “add dark mode to the dashboard in web”
                    <br />
                    or “what is everyone working on?”
                  </>
                }
              />
            ) : (
              entries.map((entry) => (
                <div key={entry.message.id} className="flex flex-col gap-2">
                  <ChatMessage
                    message={entry.message}
                    onTicket={openTicket}
                    ticketStatus={ticketStatus}
                    projectName={projectName}
                    onReply={entry.message.direction === 'outbound' ? () => setReplyToId(entry.message.id) : undefined}
                  />
                  {entry.dispatches.map((d) => (
                    <DispatchLabel
                      key={d.ticket.id}
                      identifier={d.ticket.identifier}
                      name={d.worker?.name ?? d.ticket.title}
                      status={d.status}
                      onClick={() => (d.worker ? openWorker(d.worker.id) : openTicket(d.ticket.identifier))}
                    />
                  ))}
                  {entry.decisions.map((d) => (
                    <DecisionCard
                      key={d.id}
                      decision={d}
                      asker="conductor"
                      ticketIdentifier={tickets.data?.find((t) => t.id === d.ticketId)?.identifier ?? d.ticketId}
                      busy={answer.isPending}
                      plan={<PlanPreview decision={d} />}
                      onAnswer={(a) => answerDecision(d.id, a)}
                    />
                  ))}
                </div>
              ))
            )}

            {/* The turn in flight. Transient: it goes when the run finishes and the thread's
                messages stand alone, so the reply is never on screen twice. */}
            {working ? (
              <section aria-label="Conductor is working" className="flex flex-col gap-2">
                <div className="flex items-center gap-2.5">
                  <StatusGlyph status="working" size="xs" />
                  <span className="ac-mono text-micro text-text-3">{runId ? 'working' : 'starting…'}</span>
                </div>
                {liveEvents.length ? <Transcript events={liveEvents} className="gap-2 p-0 opacity-90" /> : null}
              </section>
            ) : null}

            {/* Live work no message in this thread accounts for: a worker the human started, or a
                ticket filed before the chat recorded creating runs. Everything else is a label above. */}
            {unattributed.length ? (
              <div className="flex flex-wrap gap-2">
                {unattributed.map((w) => (
                  <WorkerChip key={w.id} name={w.name} status={agentUiStatus(w.status)} onClick={() => openWorker(w.id)} />
                ))}
              </div>
            ) : null}

            {/* decisions no message in this thread accounts for: a worker's question, or one raised
                in a turn that never replied. Anchored ones sit in the conversation above. */}
            {waiting.map((d) => (
              <DecisionCard
                key={d.id}
                decision={d}
                ticketIdentifier={tickets.data?.find((t) => t.id === d.ticketId)?.identifier ?? d.ticketId}
                busy={answer.isPending}
                plan={<PlanPreview decision={d} />}
                onAnswer={(a) => answerDecision(d.id, a)}
              />
            ))}

            <div ref={stick.bottomRef} />
          </div>
        </PageBody>
        {stick.atBottom ? null : <ScrollToBottomButton unread={stick.unread} onClick={stick.toBottom} />}
      </div>

      <div className="flex-none border-t border-line-1 bg-bg-0 px-4 py-3 md:px-7">
        <div className="mx-auto max-w-3xl">
          <Composer
            placeholder="Message the conductor…"
            queuedReason={offline ? 'Offline — your message is queued' : working ? 'Conductor is replying — your message is queued' : null}
            queuedCount={queuedCount}
            scope={
              <>
                {replyTo ? <ReplyQuote body={replyTo.body} onDismiss={() => setReplyToId(null)} /> : null}
                <ProjectPicker projects={projects.data ?? []} value={projectId} onChange={setPickedProject} />
              </>
            }
            onSubmit={send}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <CommandChip command="/talk ACME-42" />
            <CommandChip command="/conductor" />
            <CommandChip command="/d <id> approve" />
          </div>
        </div>
      </div>
    </Page>
  );
}

/**
 * The project this message is about, chosen beside the input and sent with it. "All projects" is the
 * absence of a choice, so it sends nothing and leaves the message exactly as it was before.
 */
function ProjectPicker({
  projects,
  value,
  onChange,
}: {
  projects: Project[];
  value: string | null;
  onChange: (id: string | null) => void;
}): React.ReactElement {
  // Archived projects are not offered, but one the thread already used stays listed rather than
  // leaving the control blank about what the next message would carry.
  const choosable = projects.filter((p) => p.status !== 'archived' || p.id === value);
  const orphan = value !== null && !choosable.some((p) => p.id === value);
  return (
    <select
      aria-label="Project for this message"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="rounded-r4 border border-line-2 bg-bg-1 px-1.5 py-0.5 text-micro text-text-2 outline-none"
    >
      <option value="">All projects</option>
      {orphan ? <option value={value}>{value}</option> : null}
      {choosable.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

/**
 * What the next message answers, shown above the input until it is sent or dismissed. The text comes
 * from the message the human clicked, which is on screen; two lines is enough to recognise it.
 */
function ReplyQuote({ body, onDismiss }: { body: string; onDismiss: () => void }): React.ReactElement {
  return (
    <div className="mb-1.5 flex items-start gap-2 rounded-r6 border-l-2 border-accent bg-bg-2 py-1 pl-2 pr-1">
      <span className="min-w-0 flex-1">
        <span className="block text-nano text-text-4">Replying to the conductor</span>
        <span className="line-clamp-2 block text-micro text-text-2">{body}</span>
      </span>
      <button
        type="button"
        aria-label="Dismiss reply"
        onClick={onDismiss}
        className="flex-none rounded-r4 px-1.5 py-0.5 text-micro text-text-3 hover:bg-bg-3 hover:text-text-1"
      >
        ×
      </button>
    </div>
  );
}

function ChatMessage({
  message,
  onTicket,
  ticketStatus,
  projectName,
  onReply,
}: {
  message: ThreadMessage;
  onTicket: (id: string) => void;
  ticketStatus: (id: string) => ReturnType<typeof ticketUiStatus> | null;
  projectName: (id: string) => string;
  onReply?: () => void;
}): React.ReactElement {
  const mine = message.direction === 'inbound';
  return (
    <div className={cx('group flex flex-col gap-1', mine && 'items-end')}>
      {/* The quote comes off the message itself, so it survives a reload and does not need the
          message it answers to still be in the loaded page. */}
      {message.replyToExcerpt ? (
        <span className={cx('max-w-[80%] border-l-2 border-line-2 pl-2 text-micro text-text-3', mine ? 'text-right' : 'w-full max-w-full')}>
          <span className="line-clamp-2 block">{message.replyToExcerpt}</span>
        </span>
      ) : null}
      <div
        className={cx(
          mine ? 'max-w-[80%] rounded-r10 rounded-br-r4 bg-bg-3 px-3.5 py-2.5 text-body text-text-1' : 'w-full',
        )}
      >
        {mine ? message.body : <MessageBody body={message.body} onTicket={onTicket} ticketStatus={ticketStatus} />}
      </div>
      <span className="flex items-center gap-1.5">
        {message.projectId ? (
          <span className="rounded-r4 border border-line-2 bg-bg-2 px-1.5 py-0.5 text-nano text-text-3">{projectName(message.projectId)}</span>
        ) : null}
        <span className="ac-mono text-nano text-text-4">{clock(message.createdAt)}</span>
        {onReply ? (
          <button
            type="button"
            aria-label="Reply to this message"
            onClick={onReply}
            className="rounded-r4 px-1.5 py-0.5 text-nano text-text-4 hover:bg-bg-3 hover:text-text-1"
          >
            Reply
          </button>
        ) : null}
      </span>
    </div>
  );
}
