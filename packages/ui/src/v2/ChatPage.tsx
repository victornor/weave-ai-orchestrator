/**
 * The V2 Chat screen (web-v2/chat).
 *
 * The workspace conversation with the weaver, split from the open decisions it produced, under Chat's
 * own 38px status bar. It reuses V1's data flow (`routes/Chat.tsx`) and shared view models rather than
 * forking them; only the visual tree is V2's. V1 at `/` is untouched.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Decision, Project, ThreadMessage, Ticket } from '@weave-ai/shared';
import { isActiveRun, isHumanReplyToolEvent, projectLabel } from '@weave-ai/shared';
import { resolveModel, runtimeLimitStrip } from '@weave-ai/render';
import { A, useGo } from '../app/link';
import { ScrollToBottomButton } from '../components/ScrollToBottom';
import { EmptyState } from '../components/States';
import { decisionCarriesSecret } from '../lib/decisionSecrets';
import { staleAnswerCopy } from '../lib/decisionStaleness';
import { chatEntries, chatRows } from '../lib/dispatch';
import { draftKey, useDraft } from '../lib/drafts';
import { enqueue, useQueueCount } from '../lib/queue';
import { useStickToBottom } from '../lib/stickToBottom';
import { cx } from '../lib/cx';
import { NetworkError, SEND_TIMEOUT_MS, withTimeout } from '../api/client';
import { useConnection, useWorkspaceEvents, useWs } from '../api/context';
import { useRunEventStream } from '../api/runStream';
import {
  ACCOUNTS_REFRESH_MS,
  useAnswerDecision,
  useCreateThread,
  useDecisions,
  useMessageContext,
  usePostThreadMessage,
  useProjects,
  useRunTraces,
  useRuntimes,
  useRuntimeModels,
  useThreadMessages,
  useThreads,
  useTickets,
  useUsageAccounts,
  useWeaver,
  useWorkers,
} from '../api/hooks';
import { ChatMessage } from './ChatMessage';
import { ChatComposer } from './ChatComposer';
import { ChatTrace, ChatTurnTrace } from './ChatTrace';
import { V2DecisionCard, type V2Answer } from './DecisionCard';
import { SearchPanel } from './SearchPanel';
import { DIVIDER_MAX, DIVIDER_MIN, clampDivider, readDivider, shouldSplit, useElementWidth, writeDivider } from './chatSplit';

/** How long a finished turn is held on screen when no row replaces it (V1's SETTLE_MS). */
const SETTLE_MS = 4000;

/** The status bar: running workers, waiting decisions, and the weaver session's limit. */
function ChatStatusBar({
  running,
  needs,
  session,
}: {
  running: number;
  needs: number;
  session: { label: string; percent: number; resetsIn: string | null } | null;
}): React.ReactElement {
  return (
    <header className="flex h-[38px] flex-none items-center gap-2.5 overflow-x-auto border-b border-line-1 bg-bg-0 px-4">
      <span className="text-ui text-text-3">Chat</span>
      <span className="ac-mono flex-none whitespace-nowrap text-nano text-text-3" data-status-summary>
        {running} workers running · {needs} need you
      </span>
      <div className="ml-auto flex flex-none items-center gap-2">
        {session ? (
          <span className="flex items-center gap-2" data-session-meter>
            <span className="ac-mono whitespace-nowrap text-nano text-text-3">{session.label} {session.percent}%</span>
            <span className="h-1 w-14 overflow-hidden rounded-r4 bg-bg-3" aria-hidden>
              <span className="block h-full rounded-r4 bg-accent-link" style={{ width: `${session.percent}%` }} />
            </span>
            {session.resetsIn ? <span className="ac-mono whitespace-nowrap text-nano text-text-3">{session.resetsIn}</span> : null}
          </span>
        ) : null}
        <A to="/v2/needs" className="flex-none text-nano text-text-3 hover:text-text-1">Needs you</A>
      </div>
    </header>
  );
}

/** The right pane: the workspace's open decisions as VS-345's narrow card. */
function DecisionsPane({
  ws,
  decisions,
  loaded,
  busy,
  onAnswer,
  width,
  onStartDrag,
  onKeyDown,
  tickets,
  projects,
  answerError,
}: {
  ws: string;
  decisions: Decision[];
  loaded: boolean;
  busy: boolean;
  onAnswer: (id: string, a: V2Answer) => void;
  width: number;
  onStartDrag: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  tickets: Ticket[];
  projects: Project[];
  answerError: string | null;
}): React.ReactElement {
  const ticketOf = (d: Decision): Ticket | undefined => tickets.find((t) => t.id === d.ticketId);
  const projectOf = (d: Decision): Project | undefined => projects.find((p) => p.id === (d.projectId ?? ticketOf(d)?.projectId));
  return (
    <aside
      aria-label="Open decisions"
      className="relative flex min-h-0 flex-none flex-col border-l border-line-2 bg-bg-0"
      style={{ width }}
      data-decisions-pane
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the decisions pane"
        aria-valuenow={width}
        aria-valuemin={DIVIDER_MIN}
        aria-valuemax={DIVIDER_MAX}
        tabIndex={0}
        onPointerDown={onStartDrag}
        onKeyDown={onKeyDown}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize outline-none focus-visible:bg-accent-tint"
      />
      <div className="flex h-[38px] flex-none items-center gap-2 border-b border-line-1 px-3">
        <span className="text-meta font-semibold text-text-1">Decisions</span>
        <span className="ac-mono text-nano text-text-3">{decisions.length} waiting</span>
        <A to="/v2/needs" className="ml-auto text-micro text-text-3 hover:text-text-1">Needs you</A>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {answerError ? (
          <p className="rounded-r4 border border-blocked/35 px-2.5 py-2 text-micro text-text-1" role="status" data-answer-error>
            {answerError}
          </p>
        ) : null}
        {decisions.length === 0 ? (
          <p className="px-1 py-6 text-center text-micro text-text-3">
            {loaded ? 'Nothing needs you right now.' : 'Loading…'}
          </p>
        ) : (
          decisions.map((d) => {
            const t = ticketOf(d);
            const p = projectOf(d);
            return (
              <V2DecisionCard
                key={d.id}
                decision={d}
                ws={ws}
                narrow
                busy={busy}
                askedBy={d.askedByAgentId}
                ticketIdentifier={t?.identifier ?? d.ticketId}
                projectLabel={p ? projectLabel(p) : null}
                onAnswer={(a) => onAnswer(d.id, a)}
              />
            );
          })
        )}
      </div>
    </aside>
  );
}

/** The window a search result opened, standing in for the tailing list until "back to latest". */
function JumpView({
  ws,
  messages,
  targetId,
  loading,
  projectName,
  onTicket,
  onReply,
  onBack,
}: {
  ws: string;
  messages: ThreadMessage[];
  targetId: string;
  loading: boolean;
  projectName: (id: string | null) => string | null;
  onTicket: (id: string) => void;
  onReply: (id: string) => void;
  onBack: () => void;
}): React.ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center justify-between gap-2 border-b border-line-1 bg-bg-2 px-4 py-1.5">
        <span className="text-micro text-text-3">Jumped to a message in the conversation</span>
        <button type="button" onClick={onBack} className="rounded-r4 border border-line-2 px-2.5 py-1 text-micro text-text-2 hover:text-text-1">Back to latest</button>
      </div>
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 py-5">
        {loading ? <p className="text-micro text-text-3">Loading…</p> : messages.map((m) => (
          <div key={m.id} className={cx('rounded-r4', m.id === targetId && 'bg-accent/10')}>
            <ChatMessage message={m} ws={ws} spent={null} projectName={projectName(m.projectId)} onTicket={onTicket} {...(m.direction === 'outbound' ? { onReply: () => onReply(m.id) } : {})} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function V2ChatPage({ focused = true }: { focused?: boolean } = {}): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const conn = useConnection();

  const threads = useThreads();
  const createThread = useCreateThread();
  const [threadId, setThreadId] = useState<string | null>(null);
  const createdId = createThread.data?.id ?? null;
  const listed = Boolean(threadId && threads.data?.some((t) => t.id === threadId));
  const fetchId = listed || (threadId !== null && threadId === createdId) ? threadId : null;

  const { draft, patch, clear } = useDraft(fetchId ? draftKey(ws, `thread:${fetchId}`) : null);
  const messages = useThreadMessages(fetchId);
  const post = usePostThreadMessage();
  const decisions = useDecisions({ status: 'open', owner: 'human', limit: 200 });
  const answer = useAnswerDecision();
  const workers = useWorkers({});
  const projects = useProjects();
  const tickets = useTickets({ limit: 200 });
  const weaver = useWeaver();
  const conductorId = weaver.data?.agent.id ?? null;
  const conductorRuntime = weaver.data?.agent.runtimeId ?? null;
  const runtimes = useRuntimes();
  const conductorModels = useRuntimeModels(conductorRuntime);
  const accounts = useUsageAccounts({ refetchIntervalMs: ACCOUNTS_REFRESH_MS });
  const queuedCount = useQueueCount('thread');

  const [sending, setSending] = useState(false);
  const [live, setLive] = useState<{ id: string; running: boolean } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [divider, setDivider] = useState(readDivider);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; width: number } | null>(null);
  const { ref: shellRef, width: shellWidth } = useElementWidth<HTMLDivElement>();

  const offline = conn.state === 'offline' || conn.state === 'unreachable';

  useEffect(() => {
    if (fetchId) return;
    const first = threads.data?.[0];
    if (first) setThreadId(first.id);
    else if (threads.isSuccess && !createThread.isPending && !createThread.data) createThread.mutate({}, { onSuccess: (t) => setThreadId(t.id) });
  }, [threads.data, threads.isSuccess, fetchId, createThread]);

  // Resume a turn in flight, and follow the weaver's own runs (V1's live-turn stream).
  useEffect(() => {
    const last = weaver.data?.lastRun;
    if (last && isActiveRun(last.status)) setLive((cur) => cur ?? { id: last.id, running: true });
  }, [weaver.data?.lastRun]);

  useWorkspaceEvents(
    useCallback(
      (e) => {
        if (e.type !== 'run.started' && e.type !== 'run.finished') return;
        const p = e.payload as { agentId?: string } | null;
        if (!conductorId || p?.agentId !== conductorId) return;
        if (e.type === 'run.started') setLive({ id: e.entityId, running: true });
        else {
          setLive((cur) => (cur && cur.id === e.entityId ? { id: cur.id, running: false } : cur));
          setSending(false);
        }
      },
      [conductorId],
    ),
  );

  // `focused` gates the run stream (VS-199, as V1's `ChatPage focused` does): in Global Chats each
  // pane renders this screen, but only the focused pane may hold a live stream to its weaver's run.
  const { events: runEvents, status: runStreamStatus, retryNow } = useRunEventStream(live?.id ?? null, { live: focused && (live?.running ?? false) });
  const liveEvents = useMemo(() => runEvents.filter((e) => !isHumanReplyToolEvent(e)), [runEvents]);
  const working = sending || (live?.running ?? false);

  const projectName = useCallback(
    (id: string | null) => (id ? projectLabel(projects.data?.find((p) => p.id === id) ?? { slug: id, name: id }) : null),
    [projects.data],
  );

  const oldestLoaded = messages.data?.[0]?.createdAt ?? null;
  const messageRuns = useMemo(
    () => [...new Set((messages.data ?? []).filter((m) => m.direction === 'outbound' && m.runId).map((m) => m.runId!))],
    [messages.data],
  );
  const traces = useRunTraces({ ids: messageRuns, agent: conductorId, since: oldestLoaded });
  // The conversation rows: each message, its turn's trace attached to the last message that run
  // produced (V1's `chatEntries`/`chatRows` view model). Silent turns are dropped here — Chat shows
  // the turn that produced a message, not a standalone trace row.
  const rows = useMemo(
    () => chatRows(chatEntries(messages.data ?? [], tickets.data ?? [], workers.data ?? [], decisions.data ?? []).entries, traces.data ?? [], { showSilent: false }),
    [messages.data, tickets.data, workers.data, decisions.data, traces.data],
  );

  const rowRuns = useMemo(() => new Set((messages.data ?? []).map((m) => m.runId).filter((id): id is string => Boolean(id))), [messages.data]);
  useEffect(() => {
    if (!live || live.running) return;
    if (rowRuns.has(live.id)) { setLive(null); return; }
    const t = setTimeout(() => setLive(null), SETTLE_MS);
    return () => clearTimeout(t);
  }, [live, rowRuns]);

  const compactionAt = (runtimes.data ?? []).find((r) => r.id === conductorRuntime)?.capabilities['contextCompactionAt'] as number | undefined;

  const running = (workers.data ?? []).filter((w) => w.status === 'running').length;
  const openDecisions = decisions.data ?? [];
  const sessionStrip = runtimeLimitStrip(accounts.data, conductorRuntime);

  const openTicket = useCallback((identifier: string) => go('/v2/w/$ws/tickets/$ticketId', { params: { ws, ticketId: identifier } }), [go, ws]);

  const replyTo = useMemo(() => (draft.replyToId ? (messages.data ?? []).find((m) => m.id === draft.replyToId) ?? null : null), [draft.replyToId, messages.data]);

  const send = useCallback(
    (text: string, files: File[], opts: { projectId: string | null; replyToMessageId: string | null; idempotencyKey: string }): void | Promise<void> => {
      if (!fetchId) return;
      const body = {
        body: text,
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
        ...(opts.replyToMessageId ? { replyToMessageId: opts.replyToMessageId } : {}),
        ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
      };
      const queueThisMessage = (): void => {
        enqueue({ kind: 'thread', path: `/threads/${fetchId}/messages`, body, label: text.slice(0, 60) });
      };
      if (files.length > 0) {
        if (offline) return Promise.reject(new Error('Attachments cannot be queued offline — reconnect and try again.'));
        setSending(true);
        return withTimeout(
          post.mutateAsync({ threadId: fetchId, body: text, projectId: opts.projectId, files, idempotencyKey: opts.idempotencyKey, replyToMessageId: opts.replyToMessageId }),
          SEND_TIMEOUT_MS,
        )
          .then(() => { setSending(false); clear(); })
          .catch((e: unknown) => { setSending(false); throw e; });
      }
      if (offline) { queueThisMessage(); clear(); return; }
      setSending(true);
      return withTimeout(
        post.mutateAsync({ threadId: fetchId, body: text, projectId: opts.projectId, idempotencyKey: opts.idempotencyKey, replyToMessageId: opts.replyToMessageId }),
        SEND_TIMEOUT_MS,
      )
        .then(() => { setSending(false); clear(); })
        .catch((e: unknown) => {
          setSending(false);
          if (e instanceof NetworkError) { queueThisMessage(); clear(); return; }
          throw e;
        });
    },
    [fetchId, offline, post, clear],
  );

  const onAnswer = useCallback(
    (id: string, a: V2Answer): void => {
      const d = openDecisions.find((x) => x.id === id);
      const carriesSecret = decisionCarriesSecret(d);
      setAnswerError(null);
      if (offline && carriesSecret) {
        setAnswerError('A card holding a secret cannot be answered offline — reconnect and try again.');
        return;
      }
      answer.mutate(
        { id, ...a },
        {
          onError: (e) => {
            if (e instanceof NetworkError && !carriesSecret) {
              enqueue({ kind: 'decision', path: `/decisions/${id}/answer`, body: a, label: a.key ?? a.text ?? 'decision' });
              return;
            }
            const stale = staleAnswerCopy(e, d?.ticketId ?? null);
            setAnswerError(stale ? `${stale.title}: ${stale.detail}` : e instanceof Error && e.message ? e.message : 'Could not record that answer.');
          },
        },
      );
    },
    [answer, offline, openDecisions],
  );

  const jump = useMessageContext(fetchId, anchor);
  const stick = useStickToBottom([messages.data, liveEvents.length], {
    ready: messages.data !== undefined,
    ...(messages.hasOlder
      ? { older: { hasOlder: true, isLoadingOlder: messages.isLoadingOlder, loadOlder: messages.loadOlder } }
      : {}),
  });
  const attachScroll = useCallback((el: HTMLDivElement | null) => { stick.scrollRef(el); }, [stick.scrollRef]);

  const canSplit = shouldSplit(shellWidth);
  // Desktop is split by default: the pane stays whether or not anything is waiting, so the layout
  // does not jump when the last card is answered and the empty state has somewhere to live.
  const rail = canSplit;

  const startDrag = useCallback((e: React.PointerEvent): void => {
    e.preventDefault();
    dragStart.current = { x: e.clientX, width: divider };
    setDragging(true);
  }, [divider]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent): void => {
      const s = dragStart.current;
      if (!s) return;
      setDivider(clampDivider(s.width - (e.clientX - s.x)));
    };
    const end = (): void => {
      setDragging(false);
      dragStart.current = null;
      setDivider((cur) => { writeDivider(cur); return cur; });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [dragging]);

  const onDividerKey = useCallback((e: React.KeyboardEvent): void => {
    const step = 20;
    const to = e.key === 'ArrowLeft' ? divider + step : e.key === 'ArrowRight' ? divider - step : e.key === 'Home' ? DIVIDER_MIN : e.key === 'End' ? DIVIDER_MAX : null;
    if (to === null) return;
    e.preventDefault();
    const next = clampDivider(to);
    setDivider(next);
    writeDivider(next);
  }, [divider]);

  const projectNameFor = projectName;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ChatStatusBar
        running={running}
        needs={openDecisions.length}
        session={sessionStrip?.meter ? { label: sessionStrip.meter.label, percent: sessionStrip.meter.percent, resetsIn: sessionStrip.meter.resetsIn } : null}
      />

      <div className="flex min-h-0 flex-1 items-stretch" ref={shellRef}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col">
            {anchor ? (
              <JumpView
                ws={ws}
                messages={jump.data ?? []}
                targetId={anchor}
                loading={jump.isLoading}
                projectName={projectNameFor}
                onTicket={openTicket}
                onReply={(id) => patch({ replyToId: id })}
                onBack={() => setAnchor(null)}
              />
            ) : (
              <div ref={attachScroll} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
                <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5">
                  {messages.data === undefined && !messages.isError ? (
                    <p className="text-micro text-text-4">Loading the conversation…</p>
                  ) : messages.isError && fetchId ? (
                    <p className="text-micro text-text-3">Could not load the thread; showing nothing until it returns.</p>
                  ) : rows.length === 0 ? (
                    <EmptyState title="Tell me what you need." detail="Ask the weaver to file a ticket, explain a failure, or tell you what is running." />
                  ) : (
                    rows.map((row) => {
                      if (row.kind !== 'message') return null;
                      const m = row.entry.message;
                      const trace = row.trace;
                      return (
                        <div key={row.key} className="flex flex-col gap-1.5">
                          <ChatMessage
                            message={m}
                            ws={ws}
                            spent={trace?.usage ? trace.usage.inputTokens + trace.usage.outputTokens : null}
                            projectName={projectNameFor(m.projectId)}
                            onTicket={openTicket}
                            {...(m.direction === 'outbound' ? { onReply: () => patch({ replyToId: m.id }) } : {})}
                          />
                          {m.direction === 'outbound' && trace ? (
                            <ChatTurnTrace
                              trace={trace}
                              contextWindowTokens={resolveModel(conductorModels.data, trace.model)?.contextWindowTokens}
                              compactionAt={compactionAt}
                            />
                          ) : null}
                        </div>
                      );
                    })
                  )}

                  {working || live ? (
                    <section aria-label="Weaver is working" className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <span className="size-1.5 flex-none rounded-pill bg-working" aria-hidden />
                        <span className="ac-mono text-nano text-text-3">{live ? 'working' : 'starting…'}</span>
                      </div>
                      {live ? (
                        <p className="text-nano text-text-3">
                          {runStreamStatus.state === 'unreachable' || runStreamStatus.state === 'offline' ? 'The live stream dropped. ' : ''}
                          <button type="button" onClick={retryNow} className="text-text-3 underline">Refresh</button>
                        </p>
                      ) : null}
                      {liveEvents.length ? <ChatTrace events={liveEvents} className="border-l border-line-1 pl-2.5" /> : null}
                    </section>
                  ) : null}
                  <div ref={stick.bottomRef} />
                </div>
              </div>
            )}
            {!anchor && !stick.atBottom ? <ScrollToBottomButton unread={stick.unread} onClick={stick.toBottom} /> : null}
          </div>

          <div className="flex-none border-t border-line-1 bg-bg-0 px-4 py-3">
            <div className="mx-auto w-full max-w-[720px]">
              <ChatComposer
                projects={projects.data ?? []}
                projectId={draft.projectId ?? null}
                onChangeProject={(id) => patch({ projectId: id })}
                value={draft.text}
                onChange={(text) => patch({ text })}
                replyToExcerpt={replyTo?.body ?? null}
                replyToMessageId={draft.replyToId ?? null}
                onDismissReply={() => patch({ replyToId: null })}
                onSubmit={send}
                onOpenSearch={() => setSearchOpen(true)}
                queuedReason={offline ? 'Offline — your message is queued' : working ? 'Weaver is replying — your message is queued' : null}
                queuedCount={queuedCount}
              />
            </div>
          </div>
        </div>

        {rail ? (
          <DecisionsPane
            ws={ws}
            decisions={openDecisions}
            loaded={decisions.isSuccess}
            busy={answer.isPending}
            onAnswer={onAnswer}
            width={divider}
            onStartDrag={startDrag}
            onKeyDown={onDividerKey}
            tickets={tickets.data ?? []}
            projects={projects.data ?? []}
            answerError={answerError}
          />
        ) : null}
      </div>

      <SearchPanel
        threadId={fetchId}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(messageId) => { setAnchor(messageId); setSearchOpen(false); }}
      />
    </div>
  );
}
