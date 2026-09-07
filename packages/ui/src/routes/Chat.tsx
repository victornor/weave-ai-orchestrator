import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Decision, DecisionAnswerInputs, Project, ThreadMessage } from '@agent-conductor/shared';
import { ticketUiStatus, agentUiStatus, isActiveRun, isHumanReplyToolEvent } from '@agent-conductor/shared';
import { Page, PageBody, PageHeader } from '../components/Page';
import { Composer } from '../components/Composer';
import { DecisionCard } from '../components/DecisionCard';
import { PlanPreview } from '../components/PlanPreview';
import { DispatchLabel } from '../components/DispatchLabel';
import { WorkerChip } from '../components/Chips';
import { Skeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { Markdown } from '../components/Markdown';
import { StatusGlyph } from '../components/StatusGlyph';
import { Transcript } from '../components/Transcript';
import { TurnTrace } from '../components/TurnTrace';
import { ScrollToBottomButton } from '../components/ScrollToBottom';
import { SessionLimit } from '../components/SessionLimit';
import { usePlanSync } from '../lib/planSync';
import { ContextMeter } from '../components/ContextMeter';
import {
  ACCOUNTS_REFRESH_MS,
  useAnswerDecision,
  useConductor,
  useCreateThread,
  useDecisions,
  usePostThreadMessage,
  useProjects,
  useRunTraces,
  useThreadMessages,
  useThreads,
  useRuntimeModels,
  useRuntimes,
  useTickets,
  useUsageAccounts,
  useWorkers,
} from '../api/hooks';
import { useRunEventStream } from '../api/runStream';
import { useConnection, useWorkspaceEvents, useWs } from '../api/context';
import { contextStrip, resolveModel, runtimeLimitStrip } from '@agent-conductor/render';
import { chatEntries, chatRows } from '../lib/dispatch';
import { useShowSilentTurns } from '../lib/chatPrefs';
import { readExpandedTraces, toggleExpandedTrace } from '../lib/traceExpansion';
import { draftKey, useDraft } from '../lib/drafts';
import { isHiddenFromChat, useHiddenDecisions } from '../lib/hiddenDecisions';
import { MIN_PX, STEP_PX, clampHeight, maxHeight, readDecisionHeight, writeDecisionHeight } from '../lib/decisionHeight';
import type { HeightBounds } from '../lib/decisionHeight';
import { isAtBottom, useStickToBottom } from '../lib/stickToBottom';
import { readChatScroll, writeChatScroll } from '../lib/chatScroll';
import { enqueue, useQueueCount } from '../lib/queue';
import { useToast } from '../components/Toast';
import { useGo } from '../app/link';
import { clock } from '../lib/format';
import { cx } from '../lib/cx';

const IDENTIFIER = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

/** How long a finished turn is held on screen when no row ever arrives to replace it. */
const SETTLE_MS = 4000;

/** Ticket identifiers in message text become chips that expand inline. */
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
      <Markdown source={source} className="text-body" breaks />
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
  // The unsent message — text, the project it is tagged with, what it answers — kept per workspace
  // and thread, so leaving the page and coming back finds it where it was left. Keyed by the
  // thread, so switching thread reads that thread's draft rather than carrying this one over.
  const { draft, patch } = useDraft(threadId ? draftKey(ws, `thread:${threadId}`) : null);
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
  const pickedProject = draft.projectId;
  /** The conductor message the next message answers, or null. Choosing another replaces it. */
  const replyToId = draft.replyToId ?? null;
  const conductor = useConductor();
  const conductorId = conductor.data?.agent.id ?? null;
  // The conductor's own runtime, not the workers': the agent row is kept in step with the
  // `conductor` block of the workspace config by `ensureConductor`, and Settings reads the same
  // field, so there is one source for which runtime the conductor is on.
  const conductorRuntime = conductor.data?.agent.runtimeId ?? null;
  // Polled rather than streamed: nothing emits a workspace event when a snapshot is replaced, so
  // the strip re-reads on the daemon's own probe cadence and ticks its countdown locally between.
  const accounts = useUsageAccounts({ refetchIntervalMs: ACCOUNTS_REFRESH_MS });
  // … and a human who does not want to wait for that cadence can sync from the sheet (VS-84).
  const planSync = usePlanSync();
  // How full the conductor's context is. The window is the model's own, from the runtime's model
  // list; the compaction point is the runtime's own capability — neither is decided in the UI. The
  // size itself is the last finished turn's input plus cache reads, refreshed because `run.finished`
  // invalidates the conductor detail.
  const runtimes = useRuntimes();
  const conductorModels = useRuntimeModels(conductorRuntime);
  const lastRun = conductor.data?.lastRun ?? null;
  /** Only for the divider between the two meters: whether the plan meter renders anything at all. */
  const hasPlanMeter = runtimeLimitStrip(accounts.data, conductorRuntime) !== null;
  const context = useMemo(() => contextStrip({
    usage: lastRun?.usage,
    contextWindowTokens: resolveModel(conductorModels.data, lastRun?.model)?.contextWindowTokens,
    compactionAt: (runtimes.data ?? []).find((r) => r.id === conductorRuntime)?.capabilities['contextCompactionAt'] as number | undefined,
    hasRun: Boolean(lastRun?.finishedAt),
  }), [lastRun, conductorModels.data, runtimes.data, conductorRuntime]);
  /**
   * The conductor run on screen, and whether it is still going.
   *
   * A finished run is kept here rather than dropped, until the row that takes its place has been
   * rendered: `run.finished`, the thread's refetch and the traces' refetch are three separate
   * arrivals, and clearing on the first of them empties the bottom of the list for as long as the
   * other two take. See `conductor-chat/live-turn-stream`.
   */
  const [live, setLive] = useState<{ id: string; running: boolean } | null>(null);
  const runId = live?.id ?? null;
  /** Bridges the gap between posting and the daemon starting the run, so "working" shows at once. */
  const [sending, setSending] = useState(false);
  const offline = conn.state === 'offline' || conn.state === 'unreachable';

  const runEvents = useRunEventStream(runId, { live: live?.running ?? false });
  // The reply renders as the thread message ac_human_send created; showing the call too would
  // put the same words on screen twice.
  const liveEvents = useMemo(() => runEvents.filter((e) => !isHumanReplyToolEvent(e)), [runEvents]);
  const working = sending || (live?.running ?? false);

  useEffect(() => {
    if (threadId) return;
    const first = threads.data?.[0];
    if (first) setThreadId(first.id);
    else if (threads.isSuccess && !createThread.isPending && !createThread.data) createThread.mutate({}, { onSuccess: (t) => setThreadId(t.id) });
  }, [threads.data, threads.isSuccess, threadId, createThread]);

  // Resume mid-turn: a chat that loads while the conductor is working streams the run in flight.
  useEffect(() => {
    const last = conductor.data?.lastRun;
    if (last && isActiveRun(last.status)) setLive((cur) => cur ?? { id: last.id, running: true });
  }, [conductor.data?.lastRun]);

  // The conductor's turns are the ones we stream; `run.started` carries the agent it belongs to.
  useWorkspaceEvents(
    useCallback(
      (e) => {
        if (e.type !== 'run.started' && e.type !== 'run.finished') return;
        const p = e.payload as { agentId?: string } | null;
        if (!conductorId || p?.agentId !== conductorId) return;
        if (e.type === 'run.started') setLive({ id: e.entityId, running: true });
        else {
          // Only the run being shown settles here; a `run.finished` for some other turn leaves the
          // one on screen alone, exactly as it did when this was a bare id.
          setLive((cur) => (cur && cur.id === e.entityId ? { id: cur.id, running: false } : cur));
          setSending(false);
        }
      },
      [conductorId],
    ),
  );

  const ticketStatus = useCallback(
    (identifier: string) => {
      const t = tickets.data?.find((x) => x.identifier === identifier);
      return t ? ticketUiStatus(t.status) : null;
    },
    [tickets.data],
  );

  const openTicket = useCallback((identifier: string) => go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: identifier } }), [go, ws]);
  const openWorker = useCallback((workerId: string) => go('/w/$ws/workers/$workerId', { params: { ws, workerId } }), [go, ws]);

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
  const { entries, unattributed } = useMemo(
    () => chatEntries(messages.data ?? [], tickets.data ?? [], workers.data ?? [], decisions.data ?? []),
    [messages.data, tickets.data, workers.data, decisions.data],
  );

  // What each turn in the loaded history did, counted (VS-74). The runs behind the messages on
  // screen, plus every conductor turn since the oldest of them — which is the only way a turn that
  // sent no message is heard about. Counts only: no transcript is fetched until one is opened.
  const messageRuns = useMemo(
    () => [...new Set((messages.data ?? []).filter((m) => m.direction === 'outbound' && m.runId).map((m) => m.runId!))],
    [messages.data],
  );
  const oldestLoaded = messages.data?.[0]?.createdAt ?? null;
  const traces = useRunTraces({ ids: messageRuns, agent: conductorId, since: oldestLoaded });

  const showSilent = useShowSilentTurns();
  const rows = useMemo(
    () => chatRows(entries, traces.data ?? [], { showSilent }),
    [entries, traces.data, showSilent],
  );
  /** Every run the list already accounts for, which is what tells the live block it may let go. */
  const rowRuns = useMemo(
    () => new Set(rows.map((r) => (r.kind === 'trace' ? r.trace.runId : r.entry.message.runId)).filter((id): id is string => Boolean(id))),
    [rows],
  );

  // Let go of a finished turn once the list holds it — or, failing that, after a moment. The floor
  // matters: a turn that said nothing while those rows are hidden would otherwise never be replaced
  // by anything, and the live block would sit under the conversation for the rest of the session.
  useEffect(() => {
    if (!live || live.running) return;
    if (rowRuns.has(live.id)) { setLive(null); return; }
    const t = setTimeout(() => setLive(null), SETTLE_MS);
    return () => clearTimeout(t);
  }, [live, rowRuns]);

  /** Which turns' traces are open, remembered for the session so scrolling back does not re-collapse them. */
  const [expanded, setExpanded] = useState<string[]>(() => readExpandedTraces(ws));
  useEffect(() => setExpanded(readExpandedTraces(ws)), [ws]);
  const toggleTrace = useCallback((runId: string) => setExpanded(toggleExpandedTrace(ws, runId)), [ws]);
  // Every open decision is pinned above the composer instead of sitting where it was asked, so one
  // raised twenty messages ago is still the thing on screen. Oldest first: the longest wait reads
  // first, and the order does not shuffle as answers come in.
  const pinned = useMemo(
    () =>
      (decisions.data ?? [])
        .filter((d) => d.status === 'open')
        .sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt))),
    [decisions.data],
  );
  // Hidden on this device (VS-72): a decision the human means to take later, taken off the pinned
  // area without being answered. It is still open and still in Needs you — only the card is gone —
  // so the pinned area keeps a count of them and can put them all back with one press.
  const { hidden, hide, showMany } = useHiddenDecisions(ws);
  const shown = useMemo(() => pinned.filter((d) => !isHiddenFromChat(d, hidden)), [pinned, hidden]);
  const hiddenOpen = useMemo(() => pinned.filter((d) => isHiddenFromChat(d, hidden)), [pinned, hidden]);
  // A follow-up comment on the ticket a hidden decision hangs off changes what is being asked, so
  // the card comes back rather than staying hidden against a conversation that has moved on. The
  // other re-pin triggers need no listener: an edited decision stops matching the fingerprint it was
  // hidden against, a superseded one is replaced by a different id, and one about to expire is shown
  // whatever was stored (see lib/hiddenDecisions.ts).
  useWorkspaceEvents(
    useCallback(
      (e) => {
        if (e.type !== 'ticket.comment') return;
        const back = hiddenOpen.filter((d) => d.ticketId === e.entityId).map((d) => d.id);
        if (back.length) showMany(back);
      },
      [hiddenOpen, showMany],
    ),
  );

  // Who is asking, for a card that no longer sits under the message that would have said so: the
  // agent id settles it mid-turn, before the turn's message exists to anchor to.
  const anchored = useMemo(() => new Set(entries.flatMap((e) => e.decisions.map((d) => d.id))), [entries]);
  const askedByConductor = useCallback(
    (d: Decision) => (conductorId !== null && d.askedByAgentId === conductorId) || anchored.has(d.id),
    [conductorId, anchored],
  );

  // One hook owns the list's two ends. New messages and streamed events follow the bottom only while
  // the human is there; scrolled up, they land below the fold behind the scroll-to-bottom button
  // instead of moving the viewport. At the other end, reaching the top pulls in the page before the
  // loaded history and holds the viewport on what they were reading while it lands. The pinned area
  // counts as content too: it takes height off the list, so the newest message must be re-reached.
  const stick = useStickToBottom([messages.data, liveEvents.length, shown.length, hiddenOpen.length], {
    // Loaded history, not "not loading": the query is disabled until the thread id is known, and a
    // disabled query is idle rather than fetching, so `isLoading` is already false on the first
    // render — before there is a thread, let alone a message to open on.
    ready: messages.data !== undefined,
    older: { hasOlder: messages.hasOlder, isLoadingOlder: messages.isLoadingOlder, loadOlder: messages.loadOlder },
  });

  /**
   * The scrolling element, so this workspace's reading position can be kept. Held as state rather
   * than a ref because the effects below key on it; the hook's own ref is still called, so it keeps
   * owning the measuring.
   */
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  // Depends on the hook's own ref rather than on `stick`, which is a fresh object every render: a
  // ref callback whose identity changes is detached and re-attached on every commit.
  const attach = stick.scrollRef;
  const attachScroll = useCallback((el: HTMLDivElement | null) => { setScrollEl(el); attach(el); }, [attach]);

  // How tall the pinned area is, dragged by its top edge and remembered per device (VS-94). `null`
  // is "never resized", which is a rendering rather than a number: the area stays as tall as its
  // contents under today's cap, so one short card is not a tall empty box. The list below shrinks
  // by whatever the area takes — `useStickToBottom` already re-pins on that, so nothing here has to.
  const [decisionHeight, setDecisionHeight] = useState<number | null>(readDecisionHeight);
  const decisionsRef = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);
  // The geometry a drag is measured against, captured when it starts: the area's bottom edge is held
  // still by the composer below it, and the list's top by the header above it, so neither moves while
  // the edge does. Re-reading them mid-drag would measure the box the drag is in the middle of moving.
  const dragBounds = useRef<HeightBounds | null>(null);
  /**
   * What the area is actually as tall as, and how tall it may become. A focusable separator has to
   * report a value, and before the first resize there is no chosen number to report — so it is
   * measured. Held as state rather than read during render: a rect is not a render-time thing.
   */
  const [gauge, setGauge] = useState<{ height: number; max: number }>({ height: 0, max: MIN_PX });

  /** Live geometry, or null when the area is not on screen and there is nothing to measure against. */
  const readBounds = useCallback((): HeightBounds | null => {
    const section = decisionsRef.current;
    if (!section || !scrollEl) return null;
    return { sectionBottom: section.getBoundingClientRect().bottom, pageTop: scrollEl.getBoundingClientRect().top };
  }, [scrollEl]);

  // No dependency array: the area's height changes with its contents, not with anything this could
  // key on, and the state is only written when the numbers actually differ so it still settles.
  useLayoutEffect(() => {
    const section = decisionsRef.current;
    const bounds = readBounds();
    if (!section || !bounds) return;
    const next = { height: Math.round(section.getBoundingClientRect().height), max: maxHeight(bounds) };
    setGauge((prev) => (prev.height === next.height && prev.max === next.max ? prev : next));
  });

  /** Giving the chosen height back: the area goes back to behaving as though it was never resized. */
  const resetHeight = useCallback(() => {
    setDecisionHeight(null);
    writeDecisionHeight(null);
  }, []);

  const startDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const bounds = readBounds();
    if (!bounds) return;
    // The area's own bottom edge is what the pointer's distance from it means, so a drag is an
    // absolute position rather than an accumulated delta: past a clamp there is no travel to undo
    // before the edge moves again, which is what a delta-based drag reads as a dead zone.
    dragBounds.current = bounds;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
  }, [readBounds]);

  // The pointer leaves a strip this thin at once, so the drag is followed on the window. Pointer
  // capture would do it in a browser, but it is best-effort — jsdom has no `setPointerCapture` — and
  // these listeners are what the behaviour actually rests on. The chosen height is written once, at
  // the end: a press that never moved has chosen nothing.
  useEffect(() => {
    if (!dragging) return;
    let latest: number | null = null;
    const move = (e: PointerEvent): void => {
      const bounds = dragBounds.current;
      if (!bounds) return;
      latest = clampHeight(bounds.sectionBottom - e.clientY, bounds);
      setDecisionHeight(latest);
    };
    const end = (): void => {
      if (latest !== null) writeDecisionHeight(latest);
      dragBounds.current = null;
      setDragging(false);
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

  const onHandleKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      resetHeight();
      return;
    }
    const bounds = readBounds();
    if (!bounds) return;
    // Before the first resize the keyboard steps off what the area is measured at, so the first
    // press moves it from where it is rather than jumping to a number nobody chose.
    const from = decisionHeight ?? gauge.height;
    const to =
      e.key === 'ArrowUp' ? from + STEP_PX
      : e.key === 'ArrowDown' ? from - STEP_PX
      : e.key === 'Home' ? MIN_PX
      : e.key === 'End' ? maxHeight(bounds)
      : null;
    if (to === null) return;
    // Otherwise the message list scrolls under the arrow keys while the handle is being used.
    e.preventDefault();
    const next = clampHeight(to, bounds);
    setDecisionHeight(next);
    writeDecisionHeight(next);
  }, [decisionHeight, gauge.height, readBounds, resetHeight]);

  // Recorded as the human scrolls, not on the way out: by the time an unmount cleanup runs React has
  // already detached the ref, and a detached element reports no scroll position to record.
  //
  // Only a position the human chose is one: the follow's own scrolling moves the list too, and every
  // frame of it is short of the bottom, so recording on the measurement alone stores the middle of an
  // animation as a reading position and puts the next visit there. The follow says whose scroll this
  // is; the measurement says whether it ended anywhere worth keeping. Both, or nothing is kept.
  useEffect(() => {
    if (!scrollEl) return;
    const record = (): void => writeChatScroll(ws, scrollEl.scrollTop, stick.following.current || isAtBottom(scrollEl));
    scrollEl.addEventListener('scroll', record, { passive: true });
    return () => scrollEl.removeEventListener('scroll', record);
  }, [scrollEl, ws, stick.following]);

  // Coming back to a workspace's chat: put the list back where it was left, but only when that was
  // away from the newest message. At the bottom there is nothing to restore — the hook opens there
  // anyway, and setting the offset ourselves would fight the scroll it is in the middle of.
  //
  // Waits for the history for the same reason the hook does, and remembers which workspace it put
  // back rather than merely that it ran: restoring onto the empty list the first render shows would
  // spend the one restore on nothing, and the next workspace would get none at all.
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (restored.current === ws || messages.data === undefined || !scrollEl) return;
    restored.current = ws;
    const saved = readChatScroll(ws);
    if (saved !== null) scrollEl.scrollTop = saved;
  }, [messages.data, scrollEl, ws]);

  const answerDecision = (id: string, a: { key?: string; text?: string; inputs?: DecisionAnswerInputs }): void =>
    answer.mutate(
      { id, ...a },
      // Never queued, whatever it carries: the chat's decision answers go to the daemon or nowhere,
      // and a card holding a secret says so rather than leaving the value on the device (VS-92).
      { onError: (e) => toast.push({ title: 'Could not record that answer', detail: e.message, status: 'failed' }) },
    );

  /** The project a card belongs to, named or — for a workspace-wide question — left for the card to label. */
  const projectSlugOf = (d: { projectId: string | null; ticketId: string | null }): string | null =>
    projects.data?.find((p) => p.id === (d.projectId ?? tickets.data?.find((t) => t.id === d.ticketId)?.projectId))?.slug ?? null;

  const send = (text: string): void => {
    if (!threadId) return;
    if (offline) {
      enqueue({
        kind: 'thread',
        path: `/threads/${threadId}/messages`,
        body: { body: text, ...(projectId ? { projectId } : {}), ...(replyToId ? { replyToMessageId: replyToId } : {}) },
        label: text.slice(0, 60),
      });
      // Cleared on both paths: the next message must not be silently attributed to the same question.
      patch({ replyToId: null });
      return;
    }
    setSending(true);
    post.mutate({ threadId, body: text, projectId, ...(replyToId ? { replyToMessageId: replyToId } : {}) });
    patch({ replyToId: null });
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
        // Hidden on a phone: the plan strip is the live number worth the width there, and the
        // header must stay one line.
        meta={<span className="hidden md:inline">{`${running} workers running · ${(decisions.data ?? []).filter((d) => d.status === 'open').length} need you`}</span>}
        actions={
          <div className="flex min-w-0 items-center gap-2.5">
            <ContextMeter view={context} />
            {context && hasPlanMeter ? <span className="h-3 w-px bg-line-2" aria-hidden /> : null}
            <SessionLimit accounts={accounts.data} runtimeId={conductorRuntime} sync={planSync} />
          </div>
        }
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
        <PageBody scrollRef={attachScroll} className="px-4 py-5 md:px-7">
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {/* Above the history, where the page being fetched will appear. Nothing marks the start
                of the thread: the loads simply stop once the API has answered with a short page. */}
            {messages.isLoadingOlder ? (
              <div role="status" className="flex justify-center">
                <span className="ac-mono text-micro text-text-4">Loading earlier messages…</span>
              </div>
            ) : null}

            {/* No history yet — including the renders before the thread id is known, where the query
                is disabled and so reports neither loading nor data. Claiming an empty thread there
                would put the opening pitch on screen for a moment on every visit. */}
            {messages.data === undefined && !messages.isError ? (
              <>
                <Skeleton className="ml-auto h-12 w-2/3 rounded-r10" />
                <Skeleton className="h-16 w-4/5 rounded-r6" />
                <Skeleton className="h-24 w-full rounded-r8" />
              </>
            ) : messages.isError ? (
              <ErrorState code="CONDUCTOR_UNREACHABLE" message="Could not load the thread; the history below is the last known state." onRetry={() => void messages.refetch()} />
            ) : rows.length === 0 ? (
              <EmptyState
                title="Tell me what you need."
                detail={
                  <>
                    Try “add dark mode to the dashboard in web”, “why is ACME-42 blocked?”
                    <br />
                    or “what is everyone working on?”
                    <br />
                    <span className="text-micro text-text-4">
                      The mic is push-to-talk on ⌘⇧M at a desk and tap-to-toggle on a phone.
                    </span>
                  </>
                }
              />
            ) : (
              rows.map((row) =>
                row.kind === 'trace' ? (
                  /* A turn that said nothing. Secondary to the conversation, and collapsed until asked. */
                  <div key={row.key} className="opacity-80">
                    <TurnTrace trace={row.trace} standalone open={expanded.includes(row.trace.runId)} onToggle={() => toggleTrace(row.trace.runId)} />
                  </div>
                ) : (
                  <div key={row.key} className="flex flex-col gap-2">
                    <ChatMessage
                      message={row.entry.message}
                      onTicket={openTicket}
                      ticketStatus={ticketStatus}
                      projectName={projectName}
                      onReply={row.entry.message.direction === 'outbound' ? () => patch({ replyToId: row.entry.message.id }) : undefined}
                    />
                    {/* Under the reply, above the work it filed: what the turn did, then what it left. */}
                    {row.trace ? (
                      <TurnTrace trace={row.trace} open={expanded.includes(row.trace.runId)} onToggle={() => toggleTrace(row.trace!.runId)} />
                    ) : null}
                    {row.entry.dispatches.map((d) => (
                      <DispatchLabel
                        key={d.ticket.id}
                        identifier={d.ticket.identifier}
                        name={d.worker?.name ?? d.ticket.title}
                        status={d.status}
                        onClick={() => (d.worker ? openWorker(d.worker.id) : openTicket(d.ticket.identifier))}
                      />
                    ))}
                    {/* Answered here, open below: an open card is pinned above the composer, and the
                        record of what was decided takes its place here once it has been answered. */}
                    {row.entry.decisions
                      .filter((d) => d.status !== 'open')
                      .map((d) => (
                        <DecisionCard
                          key={d.id}
                          decision={d}
                          asker="conductor"
                          ticketIdentifier={tickets.data?.find((t) => t.id === d.ticketId)?.identifier ?? d.ticketId}
                          projectSlug={projectSlugOf(d)}
                          busy={answer.isPending}
                          plan={<PlanPreview decision={d} />}
                          onAnswer={(a) => answerDecision(d.id, a)}
                        />
                      ))}
                  </div>
                ),
              )
            )}

            {/* The turn in flight, and the moment after it: the block stays until the row that
                replaces it is on screen, so the end of a turn is a fold rather than a blink. The
                streamed reply text is still never left behind — the thread message is the record. */}
            {working || live ? (
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

            <div ref={stick.bottomRef} />
          </div>
        </PageBody>
        {stick.atBottom ? null : <ScrollToBottomButton unread={stick.unread} onClick={stick.toBottom} />}
      </div>

      {/* Outside the scrolling body, so nothing the human has to answer can be scrolled away, and the
          follow-the-bottom button keeps the list it belongs to. Capped and scrolled internally: a pile
          of open decisions must never push the composer off screen. */}
      {shown.length || hiddenOpen.length ? (
        <section
          ref={decisionsRef}
          aria-label="Open decisions"
          className="ac-scroll flex-none border-t border-line-1 bg-bg-0 px-4 pb-3 md:px-7"
          // Unresized, the area is as tall as its contents up to the app's own share of the height.
          // Resized, it is exactly what was chosen — and the cap keeps following `--ac-app-h`, so a
          // height chosen before a keyboard opened is brought back inside the viewport it left.
          style={
            decisionHeight === null
              ? { maxHeight: 'calc(var(--ac-app-h) * 0.45)' }
              : { height: `${decisionHeight}px`, maxHeight: 'calc(var(--ac-app-h) * 0.75)' }
          }
        >
          {/* The top edge, as a handle. Sticky rather than absolute: the area scrolls within itself,
              and a grip that scrolled away with the cards would be unreachable exactly when there
              are enough of them to want it. `touch-action: none` is what stops a finger drag from
              scrolling the page instead of moving the edge. */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the decisions area"
            aria-valuenow={decisionHeight ?? gauge.height}
            aria-valuemin={MIN_PX}
            aria-valuemax={gauge.max}
            tabIndex={0}
            title="Drag to resize · double-click to reset"
            onPointerDown={startDrag}
            onDoubleClick={resetHeight}
            onKeyDown={onHandleKey}
            className="sticky top-0 z-10 -mx-4 mb-2 flex h-3 cursor-ns-resize touch-none items-center justify-center bg-bg-0 outline-none focus-visible:bg-bg-2 md:-mx-7"
          >
            <span className={cx('h-0.5 w-10 rounded-full', dragging ? 'bg-text-3' : 'bg-line-2')} />
          </div>
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {/* What was hidden is still counted here, so the pinned area never quietly under-reports
                what is waiting: one press brings every one of them back. */}
            {hiddenOpen.length ? (
              <button
                type="button"
                onClick={() => showMany(hiddenOpen.map((d) => d.id))}
                className="self-start rounded-r6 border border-dashed border-line-2 px-3 py-1.5 text-micro text-text-3 hover:bg-bg-2 hover:text-text-1"
              >
                {hiddenOpen.length} hidden from chat — show {hiddenOpen.length === 1 ? 'it' : 'them'} again
              </button>
            ) : null}
            {shown.map((d) => (
              <DecisionCard
                key={d.id}
                decision={d}
                {...(askedByConductor(d) ? { asker: 'conductor' as const } : {})}
                ticketIdentifier={tickets.data?.find((t) => t.id === d.ticketId)?.identifier ?? d.ticketId}
                projectSlug={projectSlugOf(d)}
                busy={answer.isPending}
                plan={<PlanPreview decision={d} />}
                onHide={() => hide(d)}
                onAnswer={(a) => answerDecision(d.id, a)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex-none border-t border-line-1 bg-bg-0 px-4 py-3 md:px-7">
        <div className="mx-auto max-w-3xl">
          <Composer
            placeholder="Message the conductor…"
            queuedReason={offline ? 'Offline — your message is queued' : working ? 'Conductor is replying — your message is queued' : null}
            queuedCount={queuedCount}
            value={draft.text}
            onChange={(text) => patch({ text })}
            scope={
              <>
                {replyTo ? <ReplyQuote body={replyTo.body} onDismiss={() => patch({ replyToId: null })} /> : null}
                <ProjectPicker projects={projects.data ?? []} value={projectId} onChange={(id) => patch({ projectId: id })} />
              </>
            }
            onSubmit={send}
          />
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
        {/* Both directions through the same renderer: what the human typed reads back the way they
            typed it, and the two sides of the thread stay consistent. */}
        <MessageBody body={message.body} onTicket={onTicket} ticketStatus={ticketStatus} />
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
