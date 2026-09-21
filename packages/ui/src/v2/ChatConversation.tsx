/**
 * The one conversation view (web-v2/chat): the scrolling message list, each turn's trace, and the
 * live working section, shared by the weaver chat (`ChatPage`) and a plan tab's planner chat so
 * the two read identically (VS-442).
 *
 * It owns no thread of its own. The caller passes the rows (`chatRows`), the live run to follow, and
 * the weaver-only extras — decision cards, dispatch chips, the unattributed-worker row — as render
 * props, so the planner context simply omits them rather than rendering broken ones. The live run's
 * events, its stream, the reveal and the stick-to-bottom follow are all this component's, so there is
 * one implementation of each.
 */
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { RunEvent, RunTrace, ThreadMessage } from '@weave-ai/shared';
import { isHumanReplyToolEvent } from '@weave-ai/shared';
import { ScrollToBottomButton } from '../components/ScrollToBottom';
import { useStickToBottom } from '../lib/stickToBottom';
import type { OlderPages } from '../lib/stickToBottom';
import type { ChatEntry, ChatRow } from '../lib/dispatch';
import { replyTargets } from '../lib/replyTargets';
import { cx } from '../lib/cx';
import { useRunEventStream } from '../api/runStream';
import type { PartialText } from '../lib/livePartials';
import { ChatMessage } from './ChatMessage';
import { ChatTrace, ChatTurnTrace, CompactionRow } from './ChatTrace';
import { LiveTurnSection } from './LiveTurnSection';

/** A finished turn is held on screen this long when no row replaces it (V1's `SETTLE_MS`). */
export const LIVE_SETTLE_MS = 4000;

/** The run the conversation is watching: `fromStart` is true only for one it saw begin (VS-440). */
export interface LiveChatRun {
  id: string;
  running: boolean;
  fromStart: boolean;
}

/** The context-window figures a turn's summary reads; absent fields leave the `ctx` part out. */
export interface TurnContext {
  contextWindowTokens?: number | null;
  compactionAt?: number | null;
}

const NO_CONTEXT = (): TurnContext => ({});

/** How long a jumped-to message stays marked before the highlight clears (VS-447). */
const JUMP_HIGHLIGHT_MS = 1600;

/** Whether the human asked for reduced motion — a jump scrolls instantly rather than smoothly. */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** What a caller can ask the shared view to do imperatively — sending returns the list to its
 *  bottom and resumes following (VS-451), which each surface's own `send` calls. */
export interface ChatConversationHandle {
  toBottom: () => void;
}

export interface ChatConversationProps {
  /** The imperative handle: `toBottom()` scrolls to the end and resumes following. */
  ref?: React.Ref<ChatConversationHandle>;
  /** The workspace, for attachment URLs and the live stream. */
  ws: string;
  /** The rows to render, from `chatRows`; a trace-only row is never shown (`showSilent: false`). */
  rows: ChatRow[];
  /** Rendered when there is nothing to show yet; a node, so each surface keeps its own copy. */
  loading?: React.ReactNode;
  /** Rendered when the thread could not be read. */
  error?: React.ReactNode;
  /** Rendered once the thread is loaded but empty. */
  empty: React.ReactNode;
  /** The actor named in a turn's summary ("weaver" / "Planner"). */
  actorName?: string;
  /** The live working section's accessible name ("Weaver is working" / "Planner is working"). */
  workingAriaLabel?: string;
  /** The run to follow live. */
  live: LiveChatRun | null;
  /** True while a turn is starting or running: the live section is shown on it. */
  working: boolean;
  /** The live run's runtime id, so its live activity row resolves partial-output coverage (VS-599). */
  runtimeId?: string | null;
  /**
   * VS-616: whether the live section shows the streamed text and the mid-turn tool trace. Defaults
   * to true, so the planner chat streams as before; the weaver chat passes its device switch, which
   * is off by default. The activity row always renders either way.
   */
  showStreamedOutput?: boolean;
  /** Only the focused pane holds a live stream to its run (VS-199). */
  focused?: boolean;
  /** Outbound messages that genuinely arrived after this thread opened, so only those reveal. */
  revealIds?: ReadonlySet<string>;
  onTicket: (identifier: string) => void;
  projectName: (id: string | null) => string | null;
  /** Resolve the roadmap block a message carried to its title; absent hides the block marker (VS-549). */
  blockName?: (id: string | null) => string | null;
  /** Present only where the thread supports replying; omitted hides the control. */
  onReply?: (messageId: string) => void;
  /** The turn summary's context-window figures for a trace. */
  resolveContext?: (trace: RunTrace) => TurnContext;
  /** False until the content the list opens on has loaded (the opening jump belongs to it). */
  ready?: boolean;
  /** The older end of the list, when this surface pages its history. */
  older?: OlderPages;
  /** Weaver-only: render a decision-card message in place of its bubble, or null to fall through. */
  renderDecisionMessage?: (message: ThreadMessage) => React.ReactNode | null;
  /** VS-622: plan-only — render a plan-artifact card message in place of its bubble, or null to fall through. */
  renderPlanArtifactMessage?: (message: ThreadMessage) => React.ReactNode | null;
  /** Weaver-only: chips rendered after a message's trace (its dispatches). */
  renderAfterTrace?: (entry: ChatEntry) => React.ReactNode;
  /** Weaver-only: the live workers no message accounts for, below the conversation. */
  footer?: React.ReactNode;
}

/** The live turning section: the activity row and streaming partials, the dropped-stream retry and
 *  the streaming trace. */
function LiveSection({
  workingAriaLabel,
  live,
  liveEvents,
  partials,
  lastPartialAt,
  partialSince,
  runtimeId,
  showStreamedOutput,
  runStreamStatus,
  onRetry,
  onTicket,
}: {
  workingAriaLabel: string;
  live: LiveChatRun | null;
  liveEvents: readonly RunEvent[];
  partials: readonly PartialText[];
  lastPartialAt: number | null;
  partialSince: number | null;
  /** The run's runtime, so the row can say "whole steps only" for one that cannot stream (VS-599). */
  runtimeId?: string | null;
  /** VS-616: whether the streamed text and the mid-turn trace render (the weaver's device switch). */
  showStreamedOutput: boolean;
  runStreamStatus: { state: string };
  onRetry: () => void;
  /** Ticket identifiers in the streamed text and trace become tags that call this (VS-623). */
  onTicket?: (id: string) => void;
}): React.ReactElement {
  // VS-454: a compaction is under way when a start has arrived with no completion after it. The
  // weaver goes quiet for tens of seconds here, so say so rather than leaving the live area reading
  // "working" through the pause.
  const compacting = useMemo(() => {
    let started = false;
    for (const e of liveEvents) {
      if (e.type === 'session.compaction.started') started = true;
      else if (e.type === 'session.compaction.completed') started = false;
    }
    return started;
  }, [liveEvents]);
  return (
    <section aria-label={workingAriaLabel} className="flex flex-col gap-2">
      {compacting ? (
        // VS-454: the live compaction row, shared with the screenshot harness and tests. The trace
        // still renders beside it, exactly as it did before VS-616.
        <>
          <CompactionRow />
          {liveEvents.length || live?.fromStart ? (
            <ChatTrace events={liveEvents} runId={live?.id ?? null} onTicket={onTicket} className="border-l border-line-1 pl-2.5" reveal />
          ) : null}
        </>
      ) : (
        // VS-599/VS-616: one shared live turn — the activity row always, and the streamed text and
        // trace when the surface asks for them (the weaver chat's switch is off by default).
        <LiveTurnSection
          events={liveEvents}
          partials={partials}
          lastPartialAt={lastPartialAt}
          partialSince={partialSince}
          runtimeId={runtimeId}
          runId={live?.id ?? null}
          showOutput={showStreamedOutput}
          mountTrace={Boolean(live?.fromStart)}
          onTicket={onTicket}
        />
      )}
      {live && (runStreamStatus.state === 'unreachable' || runStreamStatus.state === 'offline' || runStreamStatus.state === 'stale') ? (
        <p className="text-nano text-text-3">
          {runStreamStatus.state === 'stale' ? 'The live stream stalled.' : 'The live stream dropped.'}{' '}
          <button type="button" onClick={onRetry} className="text-text-3 underline">Refresh</button>
        </p>
      ) : null}
    </section>
  );
}

export function ChatConversation({
  ref,
  ws,
  rows,
  loading = null,
  error = null,
  empty,
  actorName = 'weaver',
  workingAriaLabel = 'Weaver is working',
  live,
  working,
  runtimeId,
  showStreamedOutput = true,
  focused = true,
  revealIds,
  onTicket,
  projectName,
  blockName,
  onReply,
  resolveContext = NO_CONTEXT,
  ready = true,
  older,
  renderDecisionMessage,
  renderPlanArtifactMessage,
  renderAfterTrace,
  footer,
}: ChatConversationProps): React.ReactElement {
  const runId = live?.id ?? null;
  const { events: runEvents, status: runStreamStatus, retryNow, partials, lastPartialAt, partialSince } = useRunEventStream(runId, { live: focused && (live?.running ?? false) });
  const liveEvents = useMemo(() => runEvents.filter((e) => !isHumanReplyToolEvent(e)), [runEvents]);

  const stick = useStickToBottom([rows, liveEvents.length], {
    ready,
    // The sentinel sits inside the scroller's bottom padding, so V2 measures the scroller's own end
    // and follows with a rAF loop that keeps up with a growing reveal (VS-425).
    exact: true,
    ...(older ? { older } : {}),
  });
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightIds, setHighlightIds] = useState<ReadonlySet<string>>(() => new Set());
  const attachScroll = useCallback((el: HTMLDivElement | null) => { scrollerRef.current = el; stick.scrollRef(el); }, [stick.scrollRef]);
  // Sending returns to the bottom and resumes following (VS-451); the caller's `send` calls this.
  useImperativeHandle(ref, () => ({ toBottom: stick.toBottom }), [stick.toBottom]);

  // Which human message each reply answers, computed from the conversation on screen (VS-447).
  const messages = useMemo(() => rows.flatMap((r) => (r.kind === 'message' ? [r.entry.message] : [])), [rows]);
  const { responses, repliesTo } = useMemo(() => replyTargets(messages), [messages]);

  /**
   * Jump to and briefly mark the named messages: centre the first in the conversation scroller,
   * move focus to it, and stop the follow so it cannot yank the view back to the bottom. The scroll
   * is instant under reduced motion; the mark clears itself after a beat.
   */
  const onJumpTo = useCallback((ids: string[]): void => {
    const first = ids[0];
    const scroller = scrollerRef.current;
    if (!first || !scroller) return;
    const target = Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]')).find((el) => el.dataset['messageId'] === first);
    if (!target) return;
    stick.pause();
    // Centre the target inside the conversation scroller itself. `scrollIntoView` would scroll every
    // ancestor as well, shifting the shell and the panes on narrower widths, so compute the target's
    // offset within the scroller and move only that.
    const scrollerRect = scroller.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const centred = scroller.scrollTop + (targetRect.top - scrollerRect.top) - (scroller.clientHeight - targetRect.height) / 2;
    const to = Math.max(0, Math.min(centred, scroller.scrollHeight - scroller.clientHeight));
    if (prefersReducedMotion() || typeof scroller.scrollTo !== 'function') scroller.scrollTop = to;
    else scroller.scrollTo({ top: to, behavior: 'smooth' });
    // Focus after the scroll so the browser does not scroll again to bring it into view.
    target.focus({ preventScroll: true });
    setHighlightIds(new Set(ids));
    if (highlightTimer.current !== null) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => {
      highlightTimer.current = null;
      setHighlightIds(new Set());
    }, JUMP_HIGHLIGHT_MS);
  }, [stick.pause]);

  useEffect(
    () => () => {
      if (highlightTimer.current !== null) clearTimeout(highlightTimer.current);
    },
    [],
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={attachScroll} data-v2-chat-scroll className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5">
          {rows.length === 0 && loading ? (
            loading
          ) : rows.length === 0 && error ? (
            error
          ) : rows.length === 0 ? (
            empty
          ) : (
            rows.map((row) => {
              if (row.kind !== 'message') return null;
              const m = row.entry.message;
              const highlighted = highlightIds.has(m.id);
              const decision = renderDecisionMessage?.(m) ?? renderPlanArtifactMessage?.(m) ?? null;
              return (
                <div
                  key={row.key}
                  className={cx('flex flex-col gap-1.5', highlighted && 'v2-jump-highlight')}
                  data-message-id={m.id}
                  data-jump-highlight={highlighted || undefined}
                  tabIndex={-1}
                >
                  {decision ?? (
                    <>
                      <ChatMessage
                        message={m}
                        ws={ws}
                        spent={row.trace?.usage ? row.trace.usage.inputTokens + row.trace.usage.outputTokens : null}
                        projectName={projectName(m.projectId)}
                        blockName={blockName}
                        onTicket={onTicket}
                        reveal={revealIds?.has(m.id) ?? false}
                        highlighted={highlighted}
                        responseIds={responses.get(m.id)}
                        jumpBackTo={repliesTo.get(m.id) ?? null}
                        onJumpTo={onJumpTo}
                        {...(onReply && m.direction === 'outbound' ? { onReply: () => onReply(m.id) } : {})}
                      />
                      {m.direction === 'outbound' && row.trace ? (
                        <ChatTurnTrace trace={row.trace} ws={ws} actorName={actorName} onTicket={onTicket} {...resolveContext(row.trace)} />
                      ) : null}
                      {renderAfterTrace?.(row.entry)}
                    </>
                  )}
                </div>
              );
            })
          )}

          {working || live ? (
            <LiveSection
              workingAriaLabel={workingAriaLabel}
              live={live}
              liveEvents={liveEvents}
              partials={partials ?? []}
              lastPartialAt={lastPartialAt ?? null}
              partialSince={partialSince ?? null}
              runtimeId={runtimeId}
              showStreamedOutput={showStreamedOutput}
              runStreamStatus={runStreamStatus}
              onRetry={retryNow}
              onTicket={onTicket}
            />
          ) : null}

          {footer}
          <div ref={stick.bottomRef} />
        </div>
      </div>
      {!stick.atBottom ? <ScrollToBottomButton unread={stick.unread} onClick={stick.toBottom} /> : null}
    </div>
  );
}

/**
 * Clear a finished run once the conversation accounts for it, or after a settle delay, so the live
 * section does not outlive the turn (V1's behaviour). `rowRunIds` must be memoised.
 */
export function useLiveRunSettle(
  live: LiveChatRun | null,
  setLive: (next: LiveChatRun | null) => void,
  rowRunIds: ReadonlySet<string>,
): void {
  useEffect(() => {
    if (!live || live.running) return;
    if (rowRunIds.has(live.id)) { setLive(null); return; }
    const t = setTimeout(() => setLive(null), LIVE_SETTLE_MS);
    return () => clearTimeout(t);
  }, [live, rowRunIds, setLive]);
}
