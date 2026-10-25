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
import { draftKey, readDraft, takeSeededDraft, useDraft } from '../lib/drafts';
import { useShowLiveRunOutput } from '../lib/liveRunPrefs';
import { enqueue, useQueueCount } from '../lib/queue';
import { useNewOutboundMessageIds } from '../lib/streamReveal';
import { cx } from '../lib/cx';
import { NetworkError, SEND_TIMEOUT_MS, withTimeout } from '../api/client';
import { useConnection, useWorkspaceEvents, useWs } from '../api/context';
import {
  ACCOUNTS_REFRESH_MS,
  useAnswerDecision,
  useDismissDecision,
  useCompactWeaver,
  useCreateThread,
  useDecisions,
  usePostThreadMessage,
  useProjects,
  useRoadmapBlocks,
  useRoadmapBlockTitles,
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
import { ChatComposer } from './ChatComposer';
import { ChatConversation, TurnRetryNotice, useLiveRunSettle } from './ChatConversation';
import type { ChatConversationHandle } from './ChatConversation';
import { V2TicketStrip, V2WorkerChip } from './ChatChips';
import { V2DecisionCard, type V2Answer } from './DecisionCard';
import { useExitPresence } from './motion';
import { SearchPanel } from './SearchPanel';
import { PlanTab } from './PlanTab';
import { PlanTabStrip, usePlanTabs } from './PlanTabs';
import { useTicketLink } from './ticket/TicketModal';
import {
  CONVERSATION_READING_WIDTH,
  DECISIONS_RAIL_WIDTH,
  DIVIDER_MAX,
  DIVIDER_MIN,
  clampDivider,
  conversationMeasure,
  readDivider,
  shouldSplit,
  useElementWidth,
  writeDivider,
} from './chatSplit';

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
  compacting,
  onCompact,
}: {
  running: number;
  needs: number;
  session: { label: string; percent: number; resetsIn: string | null } | null;
  compacting: boolean;
  onCompact: () => void;
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
        <button
          type="button"
          data-weaver-compact-now
          className="flex-none text-nano text-text-3 hover:text-text-1 disabled:opacity-50"
          disabled={compacting}
          onClick={onCompact}
          title="Summarise the conversation now, freeing context for what comes next"
        >
          {compacting ? 'Compacting…' : 'Compact now'}
        </button>
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
  onDismiss,
  width,
  onStartDrag,
  onKeyDown,
  tickets,
  projects,
  answerError,
  agentNameById,
  collapsed,
  canCollapse,
  onExpand,
  onCollapse,
}: {
  ws: string;
  decisions: Decision[];
  /** Decisions held past their removal for the exit animation (VS-427); the count excludes them. */
  exitingIds: ReadonlySet<string>;
  loaded: boolean;
  busy: boolean;
  onAnswer: (id: string, a: V2Answer) => void;
  onDismiss: (id: string, reason: string) => void;
  width: number;
  onStartDrag: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  tickets: Ticket[];
  projects: Project[];
  answerError: string | null;
  agentNameById: ReadonlyMap<string, string>;
  /** True when nothing is waiting and the reader has not expanded the pane (VS-549). */
  collapsed: boolean;
  /** Whether the collapse control should render: it can only collapse while nothing is waiting. */
  canCollapse: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}): React.ReactElement {
  const ticketOf = (d: Decision): Ticket | undefined => tickets.find((t) => t.id === d.ticketId);
  const projectOf = (d: Decision): Project | undefined => projects.find((p) => p.id === (d.projectId ?? ticketOf(d)?.projectId));
  const transition = 'width var(--v2-dur-base) var(--v2-ease)';
  // The collapsed rail is the deliberate way back to the pane (VS-549): a narrow, always-present
  // sliver with a keyboard-operable expand control, never no element at all.
  if (collapsed) {
    return (
      <aside
        aria-label="Open decisions"
        className="relative flex min-h-0 flex-none flex-col border-l border-line-2 bg-bg-0"
        style={{ width: DECISIONS_RAIL_WIDTH, transition }}
        data-decisions-pane
        data-decisions-pane-collapsed
      >
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand decisions"
          aria-expanded={false}
          className="flex h-full w-full flex-col items-center gap-2 py-3 text-text-3 hover:text-text-1"
        >
          <span aria-hidden className="text-micro leading-none">‹</span>
          <span aria-hidden className="ac-mono text-nano [writing-mode:vertical-rl]">Decisions</span>
        </button>
      </aside>
    );
  }
  return (
    <aside
      aria-label="Open decisions"
      className="relative flex min-h-0 flex-none flex-col border-l border-line-2 bg-bg-0"
      style={{ width, transition }}
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
        <A to="/needs" className={cx('text-micro text-text-3 hover:text-text-1', canCollapse ? undefined : 'ml-auto')}>Needs you</A>
        {canCollapse ? (
          <button type="button" onClick={onCollapse} aria-label="Collapse decisions" className="ml-auto flex-none px-1 text-micro text-text-3 hover:text-text-1">
            ›
          </button>
        ) : null}
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
                 delivery={t?.delivery ?? null}
                projectLabel={p ? projectLabel(p) : null}
                projectSlug={p?.slug ?? null}
                onAnswer={(a) => onAnswer(d.id, a)}
                onDismiss={(reason) => onDismiss(d.id, reason)}
              />
            );
          })
        )}
      </div>
    </aside>
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
  // The message a search result seeded (VS-714): null is the ordinary tailing view, unchanged; a
  // message id re-seeds the same history hook around that message, paged in both directions.
  const [anchor, setAnchor] = useState<string | null>(null);
  const messages = useThreadMessages(fetchId, anchor);
  const post = usePostThreadMessage();
  const blocks = useRoadmapBlocks(draft.projectId ?? null);
  const decisions = useDecisions({ status: 'open', owner: 'human', limit: 200 });
  // A second, answered-only read on the same route feeds the conversation's notes (captain,
  // 2026-09-14). Kept separate from the open list so an answered card still leaves the pane
  // optimistically the moment it is answered, without waiting for the list to refetch (VS-369).
  const answeredDecisions = useDecisions({ status: 'answered', owner: 'human', limit: 200 });
  const answer = useAnswerDecision();
  const dismiss = useDismissDecision();
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
  const conductorModels = useRuntimeModels(conductorRuntime, ws);
  const accounts = useUsageAccounts({ refetchIntervalMs: ACCOUNTS_REFRESH_MS });
  const queuedCount = useQueueCount('thread');
  const compactNow = useCompactWeaver();

  const [sending, setSending] = useState(false);
  // The weaver's session being compacted out of band. While it is, the daemon holds its wakes, so a
  // message sent now is queued and answered the moment compaction finishes. Seeded from the detail
  // (so a reload still shows it) and kept live by the `session.compaction` frame.
  const [compacting, setCompacting] = useState(false);
  // `fromStart` is true only for a run this screen saw begin (`run.started`), not one resumed from
  // `weaver.lastRun`; the live trace mounts on it before the run's first event so that line streams
  // (VS-440), while a resumed run still waits for its events so the ones already there stay whole.
  const [live, setLive] = useState<{ id: string; running: boolean; fromStart: boolean } | null>(null);
  // VS-616: the weaver's streamed text and mid-turn tool trace are opt-in (off by default). The
  // planner chat (PlanTab) passes nothing and keeps streaming.
  const showStreamedOutput = useShowLiveRunOutput();
  const [searchOpen, setSearchOpen] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  // A decision answered from this screen's own inline card, so the conversation swaps the card for
  // its note in place before the answered list refetches (VS-369's live update, in the conversation).
  const [justAnswered, setJustAnswered] = useState<Record<string, Decision>>({});
  const [divider, setDivider] = useState(readDivider);
  const [dragging, setDragging] = useState(false);
  // VS-549: the reader's deliberate expansion of an empty decisions pane. Cleared when the open
  // count drops back to zero or the region can no longer split, so the automatic collapse wins
  // again once the pane has nothing to show; it survives while the count stays zero.
  const [panePinned, setPanePinned] = useState(false);
  const dragStart = useRef<{ x: number; width: number } | null>(null);
  const { ref: shellRef, width: shellWidth } = useElementWidth<HTMLDivElement>();

  const offline = conn.state === 'offline' || conn.state === 'unreachable';

  useEffect(() => {
    if (fetchId) return;
    const first = threads.data?.[0];
    if (first) setThreadId(first.id);
    else if (threads.isSuccess && !createThread.isPending && !createThread.data) createThread.mutate({}, { onSuccess: (t) => setThreadId(t.id) });
  }, [threads.data, threads.isSuccess, fetchId, createThread]);

  // A prompt another screen seeded (VS-478): placed in this conversation's composer once its thread
  // id exists, unsent and editable. Only when the composer is empty, so a seed never overwrites
  // something the human was typing; it is consumed once.
  useEffect(() => {
    if (!fetchId) return;
    if (readDraft(draftKey(ws, `thread:${fetchId}`)).text) return;
    const seed = takeSeededDraft(ws);
    if (seed) patch({ text: seed });
  }, [fetchId, ws, patch, draft.text]);

  // Resume a turn in flight, and follow the weaver's own runs (V1's live-turn stream).
  useEffect(() => {
    const last = weaver.data?.lastRun;
    if (last && isActiveRun(last.status)) setLive((cur) => cur ?? { id: last.id, running: true, fromStart: false });
  }, [weaver.data?.lastRun]);

  useEffect(() => { setCompacting(Boolean(weaver.data?.compacting)); }, [weaver.data?.compacting]);

  useWorkspaceEvents(
    useCallback(
      (e) => {
        // `session.compaction` is an ephemeral frame; the shared `WorkspaceEvent['type']` union is the
        // durable set, so compare through a string. The frame is forwarded (it is in the stream's TRACKED list).
        if ((e.type as string) === 'session.compaction') {
          const p = e.payload as { agentId?: string; compacting?: boolean } | null;
          if (conductorId && p?.agentId === conductorId) setCompacting(Boolean(p.compacting));
          return;
        }
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

  // VS-663: a retryable failure of the weaver's own turn posts no thread message (no per-attempt
  // spam), but it is not a silent gap either — the run's recorded retry instant drives a transient
  // "retrying" line, so the human sees recovery in progress and it survives a reload.
  const lastRun = weaver.data?.lastRun ?? null;
  const retrying = Boolean(
    lastRun && !working && !isActiveRun(lastRun.status) && lastRun.status === 'failed' &&
    lastRun.scheduledRetryAt && Date.parse(lastRun.scheduledRetryAt) > Date.now(),
  );

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
  // The block choices offered for the tagged project (VS-491): the blocks still open to new pending
  // tickets. A block that is started, done or dropped is not offered, and the query's project key is
  // what keeps another project's blocks out.
  const blockChoices = useMemo(() => (blocks.data ?? []).filter((b) => b.reportedStatus === 'open'), [blocks.data]);
  const blockOptions = useMemo(() => blockChoices.map((b) => ({ id: b.id, title: b.title })), [blockChoices]);
  // What a send would carry: the chosen block, but only while it is still offered. A draft naming a
  // block that has since left the offered set is neither shown as chosen nor sent.
  const effectiveBlockId = useMemo(
    () => blockChoices.find((b) => b.id === draft.blockId)?.id ?? null,
    [blockChoices, draft.blockId],
  );
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
  // VS-549: resolve the block a sent message carries from its project's block list. A thread spans
  // projects, so only the projects that actually appear on a block-carrying message are queried, each
  // under the same `roadmapBlocks` key the composer and the roadmap screens already use.
  const messageBlockProjects = useMemo(() => {
    const ids = new Set<string>();
    for (const m of conversation) if (m.blockId && m.projectId) ids.add(m.projectId);
    return [...ids];
  }, [conversation]);
  const blockTitles = useRoadmapBlockTitles(messageBlockProjects);
  const blockName = useCallback((id: string | null) => (id ? blockTitles.get(id) ?? null : null), [blockTitles]);
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
  // The live section's own clearing is shared with a plan tab's planner chat (VS-442).
  useLiveRunSettle(live, setLive, rowRuns);

  // VS-556: the chat's tab strip — the weaver conversation as a tab, one tab per drafting plan in
  // the workspace, and New plan (created in the composer's selected project).
  const { tabs: planTabs, focused: chatTab, plannerRuntimeId, isCreating, focusWeaver, focusPlan, createPlan, renamePlan, discardPlan, onPlanGone } = usePlanTabs({ projects: projects.data ?? [] });
  const newPlanProjectId = draft.projectId ?? projects.data?.[0]?.id ?? null;
  const newPlan = useCallback((): void => { if (newPlanProjectId) createPlan(newPlanProjectId); }, [newPlanProjectId, createPlan]);

  const compactionAt = (runtimes.data ?? []).find((r) => r.id === conductorRuntime)?.capabilities['contextCompactionAt'] as number | undefined;

  const running = (workers.data ?? []).filter((w) => w.status === 'running').length;
  const sessionStrip = runtimeLimitStrip(accounts.data, conductorRuntime);

  const openTicket = useTicketLink();
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

  // VS-806: dismissing sends the optional reason to the asker; a card closed elsewhere is not an error.
  const onDismiss = useCallback(
    (id: string, reason: string): void => {
      setAnswerError(null);
      dismiss.mutate(
        { id, ...(reason ? { reason } : {}) },
        {
          onError: (e) => {
            if (isClosedRefusal(e)) return;
            setAnswerError(e.message || 'Could not dismiss that card.');
          },
        },
      );
    },
    [dismiss],
  );

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
  // Which anchor `jumpTo` has already been called for (VS-714): a search result already present in
  // `messages.data` jumps immediately; one outside it seeds the anchor above and this effect fires
  // once the anchored fetch lands and the target actually appears among the rendered rows.
  const jumpedFor = useRef<string | null>(null);
  const jumpToMessage = useCallback((messageId: string): void => {
    if ((messages.data ?? []).some((m) => m.id === messageId)) {
      conversationRef.current?.jumpTo(messageId);
      jumpedFor.current = messageId;
    } else {
      jumpedFor.current = null;
      setAnchor(messageId);
    }
  }, [messages.data]);
  useEffect(() => {
    if (!anchor || jumpedFor.current === anchor) return;
    if ((messages.data ?? []).some((m) => m.id === anchor)) {
      conversationRef.current?.jumpTo(anchor);
      jumpedFor.current = anchor;
    }
  }, [anchor, messages.data]);
  // "Jump to latest" (VS-714): a convenience, not the only way back — scrolling all the way down
  // through `messages.hasNewer` already reaches the tail on its own. Clearing the anchor reverts to
  // the plain tailing query; once its data is in (fresh or already cached), the view is sent to the
  // bottom the same way sending a message already does.
  const wasAnchored = useRef(false);
  useEffect(() => {
    if (wasAnchored.current && !anchor && messages.data !== undefined) toBottom();
    wasAnchored.current = anchor !== null;
  }, [anchor, messages.data, toBottom]);
  const jumpToLatest = useCallback((): void => { jumpedFor.current = null; setAnchor(null); }, []);
  const send = useCallback(
    (text: string, files: File[], opts: { projectId: string | null; blockId: string | null; replyToMessageId: string | null; idempotencyKey: string; dictated: boolean }): void | Promise<void> => {
      if (!fetchId) return;
      const body = {
        body: text,
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
        ...(opts.blockId ? { blockId: opts.blockId } : {}),
        ...(opts.replyToMessageId ? { replyToMessageId: opts.replyToMessageId } : {}),
        ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
        ...(opts.dictated ? { dictated: true } : {}),
      };
      const queueThisMessage = (): void => {
        enqueue({ kind: 'thread', path: `/threads/${fetchId}/messages`, body, label: text.slice(0, 60) });
        toBottom();
      };
      if (files.length > 0) {
        if (offline) return Promise.reject(new Error('Attachments cannot be queued offline — reconnect and try again.'));
        setSending(true);
        return withTimeout(
          post.mutateAsync({ threadId: fetchId, body: text, projectId: opts.projectId, blockId: opts.blockId, files, idempotencyKey: opts.idempotencyKey, replyToMessageId: opts.replyToMessageId, dictated: opts.dictated }),
          SEND_TIMEOUT_MS,
        )
          .then(() => { setSending(false); clear(); toBottom(); })
          .catch((e: unknown) => { setSending(false); throw e; });
      }
      if (offline) { queueThisMessage(); clear(); return; }
      setSending(true);
      return withTimeout(
        post.mutateAsync({ threadId: fetchId, body: text, projectId: opts.projectId, blockId: opts.blockId, idempotencyKey: opts.idempotencyKey, replyToMessageId: opts.replyToMessageId, dictated: opts.dictated }),
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
  // The pane is shown when it can split and either a decision is waiting or the reader opened it by
  // hand (VS-549): the collapse follows the live count, so a decision arriving expands it without a
  // reload and the last answer collapses it again.
  const rail = canSplit;
  const paneExpanded = rail && (openDecisionCount > 0 || panePinned);
  // VS-829: the conversation's reading measure, resolved from the conversation column's own width —
  // the shell minus the decisions pane and its divider when the split is showing. Both the message
  // column and the composer carry this one number, so they can never disagree. Before the first
  // measurement (`shellWidth === 0`, and jsdom has no ResizeObserver) the reading width is used, which
  // is what a narrow or unmeasured region should show anyway.
  const conversationWidth = shellWidth > 0 && canSplit && paneExpanded ? Math.max(0, shellWidth - divider - 1) : shellWidth;
  const measure = shellWidth > 0 ? conversationMeasure(conversationWidth) : CONVERSATION_READING_WIDTH;
  // The inline answerable card renders in exactly the case the pane is absent. It waits for the
  // region to be measured (`width > 0`): `useElementWidth` reads 0 on the first render, and treating
  // that as "phone" would flash the card on desktop for a frame before the pane takes over. Waiting
  // costs a phone one unmeasured frame with no card, and never shows desktop a card it must drop.
  const showInlineDecisionCard = shellWidth > 0 && !canSplit;

  // Drop the hand-expansion when the count returns to zero or the region can no longer split. Keyed
  // only on those two values, so pinning an empty pane (the count stays zero) is not undone here.
  useEffect(() => {
    if (!canSplit || openDecisionCount === 0) setPanePinned(false);
  }, [canSplit, openDecisionCount]);

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
                delivery={ticket?.delivery ?? null}
                projectLabel={project ? projectLabel(project) : null}
                projectSlug={project?.slug ?? null}
                onAnswer={(a) => onAnswer(d.id, a)}
                onDismiss={(reason) => onDismiss(d.id, reason)}
              />
            </div>
          );
        })}
      </>
    );
  }, [decisionsById, ticketsById, projectsById, showInlineDecisionCard, exitingDecisionIds, answer.isPending, agentNameById, onAnswer, onDismiss, ws]);

  // VS-634: under every weaver message that references tickets, a live status strip — one chip per
  // ticket (identifier, worker name or title, current status), opening the ticket through the same
  // handler the message's inline identifiers use. `V2TicketStrip` renders nothing when there are
  // none, so a message that references no ticket reserves no height.
  const renderAfterTrace = useCallback(
    (entry: ChatEntry): React.ReactNode => (
      <V2TicketStrip references={entry.references} projectIds={projectIds} open={openTicket} />
    ),
    [projectIds, openTicket],
  );

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
      <PlanTabStrip
        projects={projects.data ?? []}
        tabs={planTabs}
        focused={chatTab}
        busy={isCreating}
        onFocusWeaver={focusWeaver}
        onFocusPlan={focusPlan}
        onNewPlan={newPlan}
        onRename={renamePlan}
        onDiscard={discardPlan}
      />

      {chatTab.kind === 'weaver' ? (
        <>
      <ChatStatusBar
        running={running}
        needs={openDecisionCount}
        session={sessionStrip?.meter ? { label: sessionStrip.meter.label, percent: sessionStrip.meter.percent, resetsIn: sessionStrip.meter.resetsIn } : null}
        compacting={compacting}
        onCompact={() => compactNow.mutate()}
      />

      <div className="flex min-h-0 flex-1 items-stretch" ref={shellRef}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {anchor ? (
            // VS-714: a convenience alongside free scrolling, not a gate on it — scrolling down
            // through `messages.hasNewer` already reaches the tail without this.
            <div className="flex flex-none items-center justify-center border-b border-line-1 bg-bg-2 px-4 py-1.5">
              <button type="button" onClick={jumpToLatest} className="rounded-r4 border border-line-2 px-2.5 py-1 text-micro text-text-2 hover:text-text-1">Jump to latest</button>
            </div>
          ) : null}
          <ChatConversation
            ref={conversationRef}
            ws={ws}
            rows={rows}
            loading={messages.data === undefined && !messages.isError ? <p className="text-micro text-text-4">Loading the conversation…</p> : null}
            error={messages.isError && fetchId ? <p className="text-micro text-text-3">Could not load the thread; showing nothing until it returns.</p> : null}
            empty={<EmptyState title="Tell me what you need." detail="Ask the weaver to file a ticket, explain a failure, or tell you what is running." />}
            actorName="weaver"
            workingAriaLabel="Weaver is working"
            runtimeId={conductorRuntime}
            showStreamedOutput={showStreamedOutput}
            live={live}
            working={working}
            focused={focused}
            revealIds={revealIds}
            onTicket={openTicket}
            projectName={projectNameFor}
            blockName={blockName}
            onReply={(id) => patch({ replyToId: id })}
            resolveContext={resolveContext}
            ready={messages.data !== undefined}
            {...(messages.hasOlder ? { older: { hasOlder: true, isLoadingOlder: messages.isLoadingOlder, loadOlder: messages.loadOlder } } : {})}
            {...(messages.hasNewer ? { newer: { hasNewer: true, isLoadingNewer: messages.isLoadingNewer, loadNewer: messages.loadNewer } } : {})}
            renderDecisionMessage={renderDecisionMessage}
            renderAfterTrace={renderAfterTrace}
            footer={footer}
            measure={measure}
            {...(retrying && lastRun ? { turnNotice: <TurnRetryNotice family={lastRun.errorFamily} /> } : {})}
          />

          <div className="flex-none border-t border-line-1 bg-bg-0 px-4 py-3">
            <div data-v2-composer-column className="mx-auto w-full" style={{ maxWidth: measure }}>
              {compacting ? (
                <div role="status" data-v2-compacting-banner className="mb-2 flex items-start gap-2 rounded-r4 border border-line-1 bg-working/10 px-2.5 py-1.5">
                  <span className="mt-1 size-1.5 flex-none animate-pulse rounded-full bg-working" aria-hidden />
                  <span className="text-micro text-text-2">
                    Compacting the conversation… anything you send now is queued and answered as soon as it finishes.
                  </span>
                </div>
              ) : null}
              <ChatComposer
                projects={projects.data ?? []}
                projectId={draft.projectId ?? null}
                onChangeProject={(id) => patch({ projectId: id, blockId: null })}
                blocks={blockOptions}
                blockId={effectiveBlockId}
                onChangeBlock={(id) => patch({ blockId: id })}
                value={draft.text}
                onChange={(text) => patch({ text })}
                replyToExcerpt={replyTo?.body ?? null}
                replyToMessageId={draft.replyToId ?? null}
                onDismissReply={() => patch({ replyToId: null })}
                onSubmit={send}
                onOpenSearch={() => setSearchOpen(true)}
                focused={focused}
                dictationTarget={fetchId ? { ws, threadId: fetchId, projectId: draft.projectId ?? null, replyToMessageId: draft.replyToId ?? null } : null}
                queuedReason={compacting ? 'Compacting the conversation — your message is queued until it finishes' : offline ? 'Offline — your message is queued' : working ? 'Weaver is replying — your message is queued' : null}
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
            onDismiss={onDismiss}
            width={divider}
            onStartDrag={startDrag}
            onKeyDown={onDividerKey}
            tickets={tickets.data ?? []}
            projects={projects.data ?? []}
            answerError={answerError}
            agentNameById={agentNameById}
            collapsed={!paneExpanded}
            canCollapse={openDecisionCount === 0}
            onExpand={() => setPanePinned(true)}
            onCollapse={() => setPanePinned(false)}
          />
        ) : null}
      </div>

      <SearchPanel
        threadId={fetchId}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(messageId) => { jumpToMessage(messageId); setSearchOpen(false); }}
      />
        </>
      ) : (
        <PlanTab
          key={chatTab.planId}
          ws={ws}
          projectId={chatTab.projectId}
          planId={chatTab.planId}
          projects={projects.data ?? []}
          focused={focused}
          plannerRuntimeId={plannerRuntimeId}
          onSubmitted={onPlanGone}
        />
      )}
    </div>
  );
}
