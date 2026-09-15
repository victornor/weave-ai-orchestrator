/**
 * The V2 Chat screen (web-v2/chat).
 *
 * The workspace conversation with the weaver, split from the open decisions it produced, under Chat's
 * own 38px status bar. It reuses V1's data flow (`routes/Chat.tsx`) and shared view models rather than
 * forking them; only the visual tree is V2's. V1 at `/` is untouched.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Decision, Project, RunTrace, ThreadMessage, Ticket } from '@weave-ai/shared';
import { agentUiStatus, isActiveRun, projectLabel } from '@weave-ai/shared';
import { decisionCardPartsOf, resolveModel, runtimeLimitStrip } from '@weave-ai/render';
import { A, useGo } from '../app/link';
import { projectColorVar } from '../lib/projectColor';
import { EmptyState } from '../components/States';
import { decisionCarriesSecret } from '../lib/decisionSecrets';
import { isClosedRefusal, staleAnswerCopy } from '../lib/decisionStaleness';
import { chatEntries, chatRows } from '../lib/dispatch';
import type { ChatEntry } from '../lib/dispatch';
import { draftKey, useDraft } from '../lib/drafts';
import { enqueue, useQueueCount } from '../lib/queue';
import { useNewOutboundMessageIds } from '../lib/streamReveal';
import { cx } from '../lib/cx';
import { NetworkError, SEND_TIMEOUT_MS, withTimeout } from '../api/client';
import { useConnection, useWorkspaceEvents, useWs } from '../api/context';
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
import { ChatConversation, useLiveRunSettle } from './ChatConversation';
import type { ChatConversationHandle } from './ChatConversation';
import { V2DispatchChip, V2WorkerChip } from './ChatChips';
import { V2DecisionCard, type V2Answer } from './DecisionCard';
import { useExitPresence } from './motion';
import { SearchPanel } from './SearchPanel';
import { PlanModal } from './PlanModal';
import { DIVIDER_MAX, DIVIDER_MIN, clampDivider, readDivider, shouldSplit, useElementWidth, writeDivider } from './chatSplit';

/** The answer shown in a note: the chosen option's label, else the first line of the free text. */
function decisionAnswerLabel(decision: Decision): string {
  if (decision.answerKey) {
    return decision.options.find((o) => o.key === decision.answerKey)?.label ?? decision.answerKey;
  }
  const first = decision.answerText ?? (decision.answerInputs ? Object.values(decision.answerInputs)[0] : undefined);
  if (Array.isArray(first)) return first.join(', ');
  if (typeof first === 'string') return first.split('\n')[0]?.trim() || first;
  return 'Answered';
}

/**
 * One muted line where an answered decision's pushed card sat (captain, 2026-09-14): a plan, merge
 * or other approval reads "You decided", a question "You answered", and the line links to the
 * decision's ticket or to Needs you when it has none. An open decision leaves no line at all.
 */
function DecisionNote({
  decision,
  ws,
  ticketIdentifier,
}: {
  decision: Decision;
  ws: string;
  ticketIdentifier: string | null;
}): React.ReactElement {
  const decided = decision.kind === 'approval' || decision.kind.endsWith('_approval');
  const link = ticketIdentifier
    ? { to: '/w/$ws/tickets/$ticketId', params: { ws, ticketId: ticketIdentifier } }
    : { to: '/needs' };
  return (
    <p data-decision-note className="text-micro leading-relaxed text-text-3">
      {decided ? 'You decided: ' : 'You answered: '}
      <A {...link} className="text-text-2 underline-offset-2 hover:text-text-1 hover:underline">
        {decisionAnswerLabel(decision)} — {decision.title}
      </A>
    </p>
  );
}

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
        <A to="/needs" className="flex-none text-nano text-text-3 hover:text-text-1">Needs you</A>
      </div>
    </header>
  );
}

/** The right pane: the workspace's open decisions as VS-345's narrow card. */
function DecisionsPane({
  ws,
  decisions,
  exitingIds,
  loaded,
  busy,
  onAnswer,
  width,
  onStartDrag,
  onKeyDown,
  tickets,
  projects,
  answerError,
  agentNameById,
}: {
  ws: string;
  decisions: Decision[];
  /** Decisions held past their removal for the exit animation (VS-427); the count excludes them. */
  exitingIds: ReadonlySet<string>;
  loaded: boolean;
  busy: boolean;
  onAnswer: (id: string, a: V2Answer) => void;
  width: number;
  onStartDrag: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  tickets: Ticket[];
  projects: Project[];
  answerError: string | null;
  agentNameById: ReadonlyMap<string, string>;
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
        <span className="ac-mono text-nano text-text-3">{decisions.filter((d) => !exitingIds.has(d.id)).length} waiting</span>
        <A to="/needs" className="ml-auto text-micro text-text-3 hover:text-text-1">Needs you</A>
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
                 exiting={exitingIds.has(d.id)}
                 askedBy={d.askedByAgentId}
                 askedByName={d.askedByAgentId ? agentNameById.get(d.askedByAgentId) ?? null : null}
                 ticketIdentifier={t?.identifier ?? d.ticketId}
                projectLabel={p ? projectLabel(p) : null}
                projectSlug={p?.slug ?? null}
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
  // A second, answered-only read on the same route feeds the conversation's notes (captain,
  // 2026-09-14). Kept separate from the open list so an answered card still leaves the pane
  // optimistically the moment it is answered, without waiting for the list to refetch (VS-369).
  const answeredDecisions = useDecisions({ status: 'answered', owner: 'human', limit: 200 });
  const answer = useAnswerDecision();
  // Retired workers and terminal tickets are fetched because the chips are the record of what a
  // turn did: a finished dispatch keeps its label, and a finished worker still resolves for it
  // (V1's Chat, `includeRetired`/`includeTerminal`). `fields: 'label'` keeps that payload small.
  const workers = useWorkers({ includeRetired: true });
  const projects = useProjects();
  const tickets = useTickets({ limit: 200, includeTerminal: true, fields: 'label' });
  const weaver = useWeaver();
  const conductorId = weaver.data?.agent.id ?? null;
  const conductorRuntime = weaver.data?.agent.runtimeId ?? null;
  // The asker's display name for every decision card on this screen, so the meta line never shows a
  // raw agent id (VS-403). The screen is one workspace, so its workers and weaver cover the askers.
  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of workers.data ?? []) map.set(w.id, w.name);
    const weaverAgent = weaver.data?.agent;
    if (weaverAgent) map.set(weaverAgent.id, weaverAgent.name);
    return map;
  }, [workers.data, weaver.data]);
  const runtimes = useRuntimes();
  const conductorModels = useRuntimeModels(conductorRuntime);
  const accounts = useUsageAccounts({ refetchIntervalMs: ACCOUNTS_REFRESH_MS });
  const queuedCount = useQueueCount('thread');

  const [sending, setSending] = useState(false);
  // `fromStart` is true only for a run this screen saw begin (`run.started`), not one resumed from
  // `weaver.lastRun`; the live trace mounts on it before the run's first event so that line streams
  // (VS-440), while a resumed run still waits for its events so the ones already there stay whole.
  const [live, setLive] = useState<{ id: string; running: boolean; fromStart: boolean } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  // A decision answered from this screen's own inline card, so the conversation swaps the card for
  // its note in place before the answered list refetches (VS-369's live update, in the conversation).
  const [justAnswered, setJustAnswered] = useState<Record<string, Decision>>({});
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
    if (last && isActiveRun(last.status)) setLive((cur) => cur ?? { id: last.id, running: true, fromStart: false });
  }, [weaver.data?.lastRun]);

  useWorkspaceEvents(
    useCallback(
      (e) => {
        if (e.type !== 'run.started' && e.type !== 'run.finished') return;
        const p = e.payload as { agentId?: string } | null;
        if (!conductorId || p?.agentId !== conductorId) return;
        if (e.type === 'run.started') setLive({ id: e.entityId, running: true, fromStart: true });
        else {
          setLive((cur) => (cur && cur.id === e.entityId ? { ...cur, running: false } : cur));
          setSending(false);
        }
      },
      [conductorId],
    ),
  );

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
  // VS-427: the optimistic removal (VS-369) drops an answered card from the cache at once; hold it
  // for one animation so it leaves rather than vanishes, in the pane and inline in the conversation.
  const decisionPresence = useExitPresence(decisions.data ?? [], (d) => d.id);
  const openDecisions = decisionPresence.map((e) => e.item);
  const exitingDecisionIds = new Set(decisionPresence.filter((e) => e.exiting).map((e) => e.item.id));
  const openDecisionCount = decisionPresence.filter((e) => !e.exiting).length;
  const decisionsById = useMemo(
    () => new Map([...openDecisions, ...(answeredDecisions.data ?? []), ...Object.values(justAnswered)].map((d) => [d.id, d] as const)),
    [decisionPresence, answeredDecisions.data, justAnswered],
  );
  const ticketsById = useMemo(() => new Map((tickets.data ?? []).map((t) => [t.id, t] as const)), [tickets.data]);
  const projectsById = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p] as const)), [projects.data]);
  /** The workspace's project ids, so a chip's project hue is the same one V1 gives it (VS-149). */
  const projectIds = useMemo(() => (projects.data ?? []).map((p) => p.id), [projects.data]);
  // A decision the channel manager pushed to the thread is a message whose card part carries the
  // decision's prose fallback (title + context). It is kept only while a decision it names is known;
  // what renders in its place is decided per width below — an inline answerable card on phone where
  // the pane is absent, nothing on desktop where the pane shows it, and one muted note line once it
  // is answered, everywhere (captain, 2026-09-14).
  const conversation = useMemo(
    () =>
      (messages.data ?? []).filter((m) => {
        const cards = decisionCardPartsOf(m.parts);
        if (cards.length === 0) return true;
        return cards.some((c) => decisionsById.has(c.ref.id));
      }),
    [messages.data, decisionsById],
  );
  // The conversation rows: each message, its turn's trace attached to the last message that run
  // produced (V1's `chatEntries`/`chatRows` view model). Silent turns are dropped here — Chat shows
  // the turn that produced a message, not a standalone trace row.
  // The shared view model returns both halves the chat shows: each message with the work its turn
  // filed under it, and the live workers no message accounts for (V1's `chatEntries`).
  const { entries, unattributed } = useMemo(
    () => chatEntries(conversation, tickets.data ?? [], workers.data ?? [], openDecisions),
    [conversation, tickets.data, workers.data, decisionPresence],
  );
  const rows = useMemo(
    () => chatRows(entries, traces.data ?? [], { showSilent: false }),
    [entries, traces.data],
  );

  const rowRuns = useMemo(() => new Set((messages.data ?? []).map((m) => m.runId).filter((id): id is string => Boolean(id))), [messages.data]);
  // The live section's own clearing is shared with the Plan modal's planner chat (VS-442).
  useLiveRunSettle(live, setLive, rowRuns);

  const compactionAt = (runtimes.data ?? []).find((r) => r.id === conductorRuntime)?.capabilities['contextCompactionAt'] as number | undefined;

  const running = (workers.data ?? []).filter((w) => w.status === 'running').length;
  const sessionStrip = runtimeLimitStrip(accounts.data, conductorRuntime);

  const openTicket = useCallback((identifier: string) => go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: identifier } }), [go, ws]);
  const openWorker = useCallback((workerId: string) => go('/w/$ws/workers/$workerId', { params: { ws, workerId } }), [go, ws]);

  const replyTo = useMemo(() => (draft.replyToId ? (messages.data ?? []).find((m) => m.id === draft.replyToId) ?? null : null), [draft.replyToId, messages.data]);

  const onAnswer = useCallback(
    (id: string, a: V2Answer): void => {
      const d = openDecisions.find((x) => x.id === id);
      const carriesSecret = decisionCarriesSecret(d);
      setAnswerError(null);
      if (offline && carriesSecret) {
        setAnswerError('A card holding a secret cannot be answered offline — reconnect and try again.');
        return;
      }
      // Swap the inline card for its note in place, as the pane and Needs you drop the card (VS-369).
      if (d && !offline) {
        setJustAnswered((prev) => ({
          ...prev,
          [id]: { ...d, status: 'answered', answerKey: a.key ?? null, answerText: a.text ?? null, answerInputs: a.inputs ?? null },
        }));
      }
      answer.mutate(
        { id, ...a },
        {
          onError: (e) => {
            if (e instanceof NetworkError && !carriesSecret) {
              enqueue({ kind: 'decision', path: `/decisions/${id}/answer`, body: a, label: a.key ?? a.text ?? 'decision' });
              return;
            }
            // The decision was already closed elsewhere: the card is gone and any replacement the
            // refetch shows speaks for itself, so this is not an error (VS-369).
            if (isClosedRefusal(e)) return;
            setJustAnswered((prev) => {
              if (!(id in prev)) return prev;
              const next = { ...prev };
              delete next[id];
              return next;
            });
            const stale = staleAnswerCopy(e, d?.ticketId ?? null);
            setAnswerError(stale ? `${stale.title}: ${stale.detail}` : e instanceof Error && e.message ? e.message : 'Could not record that answer.');
          },
        },
      );
    },
    [answer, offline, openDecisions],
  );

  const jump = useMessageContext(fetchId, anchor);
  // Only a weaver reply that arrived after this thread opened streams in; history never re-animates
  // and the human's own messages do not reveal.
  const revealIds = useNewOutboundMessageIds(messages.data, fetchId);

  // Sending always returns the view to the bottom and resumes following (VS-451): the human's own
  // message and the weaver's reply must not land behind a follow a stray upward scroll paused. Both
  // the successful send and the queued one go through here, so a queued message counts too; the
  // reply arrives later and is followed because `following` is true again. The follow itself lives in
  // the shared conversation view (VS-442), so this reaches it through its imperative handle.
  const conversationRef = useRef<ChatConversationHandle>(null);
  const toBottom = useCallback((): void => { conversationRef.current?.toBottom(); }, []);
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
        toBottom();
      };
      if (files.length > 0) {
        if (offline) return Promise.reject(new Error('Attachments cannot be queued offline — reconnect and try again.'));
        setSending(true);
        return withTimeout(
          post.mutateAsync({ threadId: fetchId, body: text, projectId: opts.projectId, files, idempotencyKey: opts.idempotencyKey, replyToMessageId: opts.replyToMessageId }),
          SEND_TIMEOUT_MS,
        )
          .then(() => { setSending(false); clear(); toBottom(); })
          .catch((e: unknown) => { setSending(false); throw e; });
      }
      if (offline) { queueThisMessage(); clear(); return; }
      setSending(true);
      return withTimeout(
        post.mutateAsync({ threadId: fetchId, body: text, projectId: opts.projectId, idempotencyKey: opts.idempotencyKey, replyToMessageId: opts.replyToMessageId }),
        SEND_TIMEOUT_MS,
      )
        .then(() => { setSending(false); clear(); toBottom(); })
        .catch((e: unknown) => {
          setSending(false);
          if (e instanceof NetworkError) { queueThisMessage(); clear(); return; }
          throw e;
        });
    },
    [fetchId, offline, post, clear, toBottom],
  );

  const canSplit = shouldSplit(shellWidth);
  // Desktop is split by default: the pane stays whether or not anything is waiting, so the layout
  // does not jump when the last card is answered and the empty state has somewhere to live.
  const rail = canSplit;
  // The inline answerable card renders in exactly the case the pane is absent. It waits for the
  // region to be measured (`width > 0`): `useElementWidth` reads 0 on the first render, and treating
  // that as "phone" would flash the card on desktop for a frame before the pane takes over. Waiting
  // costs a phone one unmeasured frame with no card, and never shows desktop a card it must drop.
  const showInlineDecisionCard = shellWidth > 0 && !canSplit;

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

  const resolveContext = useCallback(
    (t: RunTrace): { contextWindowTokens?: number | null; compactionAt?: number | null } => ({
      contextWindowTokens: resolveModel(conductorModels.data, t.model)?.contextWindowTokens,
      compactionAt,
    }),
    [conductorModels.data, compactionAt],
  );

  // The weaver-only row extras, handed to the shared conversation view (VS-442): a decision-card
  // message renders its card or its answered note in place of a bubble, and a turn's dispatches sit
  // under its reply. The planner context passes neither, so it shows the plain bubble.
  const renderDecisionMessage = useCallback((m: ThreadMessage): React.ReactNode | null => {
    const cards = decisionCardPartsOf(m.parts);
    if (cards.length === 0) return null;
    return (
      <>
        {cards.map((card) => {
          const d = decisionsById.get(card.ref.id);
          if (!d) return null;
          const ticket = d.ticketId ? ticketsById.get(d.ticketId) : undefined;
          if (d.status === 'answered') {
            return <DecisionNote key={card.ref.id} decision={d} ws={ws} ticketIdentifier={ticket?.identifier ?? null} />;
          }
          if (!showInlineDecisionCard) return null;
          const projectId = d.projectId ?? ticket?.projectId ?? null;
          const project = projectId ? projectsById.get(projectId) : undefined;
          return (
            <div key={card.ref.id} data-inline-decision-card>
              <V2DecisionCard
                decision={d}
                ws={ws}
                busy={answer.isPending}
                exiting={exitingDecisionIds.has(d.id)}
                askedBy={d.askedByAgentId}
                askedByName={d.askedByAgentId ? agentNameById.get(d.askedByAgentId) ?? null : null}
                ticketIdentifier={ticket?.identifier ?? d.ticketId}
                projectLabel={project ? projectLabel(project) : null}
                projectSlug={project?.slug ?? null}
                onAnswer={(a) => onAnswer(d.id, a)}
              />
            </div>
          );
        })}
      </>
    );
  }, [decisionsById, ticketsById, projectsById, showInlineDecisionCard, exitingDecisionIds, answer.isPending, agentNameById, onAnswer, ws]);

  const renderAfterTrace = useCallback((entry: ChatEntry): React.ReactNode => {
    if (!entry.dispatches.length) return null;
    return (
      <div className="flex flex-wrap gap-1.5" data-v2-dispatch-row>
        {entry.dispatches.map((d) => (
          <V2DispatchChip
            key={d.ticket.id}
            identifier={d.ticket.identifier}
            name={d.worker?.name ?? d.ticket.title}
            status={d.status}
            projectColorVar={d.ticket.projectId ? projectColorVar(d.ticket.projectId, projectIds) : undefined}
            onClick={() => (d.worker ? openWorker(d.worker.id) : openTicket(d.ticket.identifier))}
          />
        ))}
      </div>
    );
  }, [projectIds, openWorker, openTicket]);

  const footer = unattributed.length ? (
    <div className="flex flex-wrap gap-1.5" data-v2-live-worker-row>
      {unattributed.map((w) => (
        <V2WorkerChip
          key={w.id}
          name={w.name}
          status={agentUiStatus(w.status)}
          projectColorVar={w.projectId ? projectColorVar(w.projectId, projectIds) : undefined}
          onClick={() => openWorker(w.id)}
        />
      ))}
    </div>
  ) : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ChatStatusBar
        running={running}
        needs={openDecisionCount}
        session={sessionStrip?.meter ? { label: sessionStrip.meter.label, percent: sessionStrip.meter.percent, resetsIn: sessionStrip.meter.resetsIn } : null}
      />

      <div className="flex min-h-0 flex-1 items-stretch" ref={shellRef}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
            <ChatConversation
              ref={conversationRef}
              ws={ws}
              rows={rows}
              loading={messages.data === undefined && !messages.isError ? <p className="text-micro text-text-4">Loading the conversation…</p> : null}
              error={messages.isError && fetchId ? <p className="text-micro text-text-3">Could not load the thread; showing nothing until it returns.</p> : null}
              empty={<EmptyState title="Tell me what you need." detail="Ask the weaver to file a ticket, explain a failure, or tell you what is running." />}
              actorName="weaver"
              workingAriaLabel="Weaver is working"
              live={live}
              working={working}
              focused={focused}
              revealIds={revealIds}
              onTicket={openTicket}
              projectName={projectNameFor}
              onReply={(id) => patch({ replyToId: id })}
              resolveContext={resolveContext}
              ready={messages.data !== undefined}
              {...(messages.hasOlder ? { older: { hasOlder: true, isLoadingOlder: messages.isLoadingOlder, loadOlder: messages.loadOlder } } : {})}
              renderDecisionMessage={renderDecisionMessage}
              renderAfterTrace={renderAfterTrace}
              footer={footer}
            />
          )}

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
                onOpenPlan={() => setPlanOpen(true)}
                hotkey={!planOpen}
                dictationTarget={fetchId ? { ws, threadId: fetchId, projectId: draft.projectId ?? null, replyToMessageId: draft.replyToId ?? null } : null}
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
            exitingIds={exitingDecisionIds}
            loaded={decisions.isSuccess}
            busy={answer.isPending}
            onAnswer={onAnswer}
            width={divider}
            onStartDrag={startDrag}
            onKeyDown={onDividerKey}
            tickets={tickets.data ?? []}
            projects={projects.data ?? []}
            answerError={answerError}
            agentNameById={agentNameById}
          />
        ) : null}
      </div>

      <SearchPanel
        threadId={fetchId}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(messageId) => { setAnchor(messageId); setSearchOpen(false); }}
      />
      <PlanModal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        projects={projects.data ?? []}
        projectId={draft.projectId ?? null}
      />
    </div>
  );
}
