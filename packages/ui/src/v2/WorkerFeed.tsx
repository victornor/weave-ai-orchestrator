/**
 * The shared V2 worker live feed (web-v2/live-feed).
 *
 * One run's event stream, rendered the way the Live screen renders it. Live, Roles, Chat and a
 * decision card's Watch toggle all import this module rather than each opening `useRunEventStream`
 * themselves, so there is one trace feed in V2.
 *
 * `useWorkerRun` resolves a worker's *current* run — the active run, else its most recent finished
 * one — from the same `useRuns` queries V1's LiveCell uses. The revision run a held decision's Watch
 * is watching is a new run, so keying off the asking run alone would go stale the moment it starts.
 *
 * VS-409 makes an expandable pane (`compact` + `resizable`) readable and live: it opens at 264px
 * (double the old 132px box), follows its newest line, carries a corner resize grip, and offers a
 * reconnect control only once the stream has dropped — never a Refresh while the run is live. Its
 * body and the transcript's own scroller share one height, so the last line is always reachable.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { isActiveRun, type Run } from '@weave-ai/shared';
import { useRunEventStream } from '../api/runStream';
import { useRuns } from '../api/hooks';
import { RunTranscript } from '../components/RunTranscript';
import { SkeletonRows } from '../components/Skeleton';
import { statusText, tokens } from '../lib/format';
import { cx } from '../lib/cx';

/** The newest run in a list, compared by `createdAt` rather than trusting the order. */
function newest(runs: readonly Run[]): Run | null {
  let best: Run | null = null;
  for (const r of runs) if (!best || r.createdAt > best.createdAt) best = r;
  return best;
}

/** The page transcript's own cap when nothing else bounds it. */
export const TRACE_PANE_MAX_HEIGHT = 420;

/** An expandable pane's opening height: double the old 132px compact box (VS-409). */
export const TRACE_PANE_HEIGHT_DEFAULT = 264;

/** Enough for the card's header line and a few trace lines. */
export const TRACE_PANE_HEIGHT_MIN = 120;

/** One arrow-key press on the grip. */
export const TRACE_PANE_HEIGHT_STEP = 24;

/** The tallest a pane may be dragged, as a share of the viewport, floored so the range never inverts. */
export function tracePaneHeightMax(viewportHeight: number): number {
  return Math.max(TRACE_PANE_HEIGHT_MIN, Math.round(viewportHeight * 0.85));
}

function currentViewportHeight(): number {
  return typeof window === 'undefined' ? 900 : window.innerHeight;
}

function clampPaneHeight(px: number, viewportHeight: number): number {
  return Math.min(Math.max(Math.round(px), TRACE_PANE_HEIGHT_MIN), tracePaneHeightMax(viewportHeight));
}

/**
 * A pane's corner grip. Dragging it, or focusing it and pressing the up/down arrows, changes the
 * pane's height; a double-click returns it to its opening height. Live has its own grid-level grip
 * (VS-372) and never renders this one.
 */
function PaneResizeGrip({ height, onHeight, onReset }: { height: number; onHeight: (px: number) => void; onReset: () => void }): React.ReactElement {
  const start = useRef<{ y: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent): void => {
      const from = start.current;
      if (!from) return;
      onHeight(clampPaneHeight(from.height + (e.clientY - from.y), currentViewportHeight()));
    };
    const end = (): void => {
      setDragging(false);
      start.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [dragging, onHeight]);
  const step = (delta: number): void => onHeight(clampPaneHeight(height + delta, currentViewportHeight()));
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize trace pane"
      aria-valuenow={height}
      aria-valuemin={TRACE_PANE_HEIGHT_MIN}
      aria-valuemax={tracePaneHeightMax(currentViewportHeight())}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      data-v2-pane-grip
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start.current = { y: e.clientY, height };
        setDragging(true);
      }}
      onKeyDown={(e) => {
        const delta = e.key === 'ArrowDown' ? TRACE_PANE_HEIGHT_STEP : e.key === 'ArrowUp' ? -TRACE_PANE_HEIGHT_STEP : null;
        if (delta === null) return;
        e.preventDefault();
        step(delta);
      }}
      onDoubleClick={onReset}
      className="absolute bottom-0 right-0 z-10 flex size-5 cursor-ns-resize touch-none select-none items-end justify-end text-text-4 hover:text-text-2"
    >
      <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M14 6 6 14M14 10l-4 4" />
      </svg>
    </div>
  );
}

export interface WorkerRunState {
  /** The run to show: the active one, else the most recent finished one. */
  run: Run | null;
  /** True when `run` is still executing, so the feed should tail it. */
  live: boolean;
}

/**
 * Resolve a worker's current run. A worker with a turn in flight shows that run; between turns it
 * shows the newest run it has, so a cell or a card never goes blank on a handoff.
 */
export function useWorkerRun(agentId: string | null | undefined, wsOverride?: string): WorkerRunState {
  const running = useRuns({ status: 'running', limit: 200 }, wsOverride);
  const queued = useRuns({ status: 'queued', limit: 200 }, wsOverride);
  const recent = useRuns({ limit: 200 }, wsOverride);

  return useMemo(() => {
    if (!agentId) return { run: null, live: false };
    const active = [...(queued.data ?? []), ...(running.data ?? [])].filter(
      (r) => r.agentId === agentId && isActiveRun(r.status),
    );
    const inFlight = newest(active);
    if (inFlight) return { run: inFlight, live: true };
    const past = (recent.data ?? []).filter((r) => r.agentId === agentId);
    return { run: newest(past), live: false };
  }, [agentId, queued.data, running.data, recent.data]);
}

export interface WorkerFeedProps {
  /** The worker whose run to follow. Ignored when `runId` is given. */
  agentId?: string | null;
  /** A specific run to show when the worker cannot be resolved (a decision's asking run). */
  runId?: string | null;
  /** The workspace the run belongs to; required outside a workspace route. */
  ws?: string;
  /** Bounds the height for embedding in a card or a narrow pane. */
  compact?: boolean;
  /**
   * Bounds the trace body to this many pixels (VS-350: Live's 420/300/240/200 ladder; VS-372: the
   * dragged shared tile height). The body becomes a fixed box and the transcript scrolls inside it,
   * so a tile is the same height whether its run is short, waiting or full.
   */
  bodyHeight?: number;
  /** Adds the corner resize grip and lets the compact pane's height be dragged (VS-409). */
  resizable?: boolean;
  /** Hides the built-in status bar when the embedding card provides its own (VS-350). */
  showChrome?: boolean;
  /** Names the region for assistive tech. */
  label?: string;
  className?: string;
}

/** The feed: a run's status, its trace and its usage. */
export function WorkerFeed({ agentId, runId, ws, compact = false, bodyHeight, resizable = false, showChrome = true, label = 'Worker live feed', className }: WorkerFeedProps): React.ReactElement {
  const resolved = useWorkerRun(agentId, ws);
  // The worker's *current* run wins when it can be resolved; a specific `runId` (a decision's asking
  // run) is only the fallback, so a revision run that starts after the ask is what Watch follows.
  const id = resolved.run?.id ?? runId ?? null;
  const streaming = resolved.run ? resolved.live : false;
  const { events, status, retryNow } = useRunEventStream(id, { live: streaming, newest: !streaming, ws });
  const [paneHeight, setPaneHeight] = useState(TRACE_PANE_HEIGHT_DEFAULT);

  const usage = resolved.run?.usage ?? null;
  const head = runId ? null : resolved.run;
  // One height for the body and for the transcript's scroller: a fixed pane (Live's tile, an
  // expandable compact pane) or a 420px cap for the page transcript. `overflow-hidden` on the body
  // then only ever clips what the scroller is already showing, so the last line is reachable.
  const fixedHeight = bodyHeight ?? (compact ? paneHeight : undefined);
  const dropped = status.state === 'reconnecting' || status.state === 'unreachable' || status.state === 'offline';

  return (
    <div
      className={cx('overflow-hidden rounded-r4 border border-line-1 bg-bg-1', compact ? 'text-micro' : 'text-meta', className)}
      data-worker-feed
      data-feed-live={streaming ? 'true' : 'false'}
    >
      {showChrome ? (
        <div className="flex items-center gap-2 border-b border-line-1 bg-bg-2 px-2.5 py-1.5">
          <span className={cx('size-1.5 flex-none rounded-pill', streaming ? 'bg-working' : 'bg-idle')} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-text-2">{head ? statusText(head.status) : streaming ? 'Running' : 'No run yet'}</span>
          {usage ? (
            <span className="ac-mono flex-none text-nano text-text-3">
              {tokens(usage.inputTokens + usage.outputTokens)} tok
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        className="relative min-h-0 overflow-hidden"
        data-feed-body
        style={fixedHeight !== undefined ? { height: fixedHeight } : { maxHeight: TRACE_PANE_MAX_HEIGHT }}
      >
        {id === null ? (
          <p className="px-2.5 py-3 text-micro text-text-3">Waiting for the next turn.</p>
        ) : events.length === 0 ? (
          <SkeletonRows rows={3} />
        ) : (
          <RunTranscript
            events={events}
            live={streaming}
            follow={streaming || resizable}
            label={label}
            height={fixedHeight}
            maxHeight={fixedHeight === undefined ? TRACE_PANE_MAX_HEIGHT : undefined}
            className={compact ? 'ac-compact-transcript' : undefined}
          />
        )}
        {resizable ? (
          <PaneResizeGrip height={fixedHeight ?? TRACE_PANE_MAX_HEIGHT} onHeight={setPaneHeight} onReset={() => setPaneHeight(TRACE_PANE_HEIGHT_DEFAULT)} />
        ) : null}
      </div>
      {dropped ? (
        <div className="flex items-center gap-2 border-t border-line-1 px-2.5 py-1.5 text-nano text-blocked">
          <span className="min-w-0 flex-1" role="status">
            The live stream dropped — showing what was recorded.
          </span>
          <button type="button" onClick={retryNow} className="flex-none text-nano text-text-2 hover:text-text-1">
            Reconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}
