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
 */
import { useMemo } from 'react';
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
  /** Overrides the trace body's height in pixels (VS-350: Live's 420/300/240/200 ladder). */
  bodyHeight?: number;
  /** Hides the built-in status bar when the embedding card provides its own (VS-350). */
  showChrome?: boolean;
  /** Names the region for assistive tech. */
  label?: string;
  className?: string;
}

/** The feed: a run's status, its trace and its usage. */
export function WorkerFeed({ agentId, runId, ws, compact = false, bodyHeight, showChrome = true, label = 'Worker live feed', className }: WorkerFeedProps): React.ReactElement {
  const resolved = useWorkerRun(agentId, ws);
  // The worker's *current* run wins when it can be resolved; a specific `runId` (a decision's asking
  // run) is only the fallback, so a revision run that starts after the ask is what Watch follows.
  const id = resolved.run?.id ?? runId ?? null;
  const streaming = resolved.run ? resolved.live : false;
  const { events, status, retryNow } = useRunEventStream(id, { live: streaming, newest: !streaming, ws });

  const usage = resolved.run?.usage ?? null;
  const head = runId ? null : resolved.run;

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
          <button type="button" onClick={retryNow} className="ac-mono flex-none text-nano text-text-3 hover:text-text-1">
            Refresh
          </button>
        </div>
      ) : null}
      <div className="min-h-0" style={{ maxHeight: bodyHeight ?? (compact ? 132 : 420) }}>
        {id === null ? (
          <p className="px-2.5 py-3 text-micro text-text-3">Waiting for the next turn.</p>
        ) : events.length === 0 ? (
          <SkeletonRows rows={3} />
        ) : (
          <RunTranscript
            events={events}
            live={streaming}
            label={label}
            className={compact ? 'ac-compact-transcript' : undefined}
          />
        )}
      </div>
      {status.state === 'unreachable' || status.state === 'offline' ? (
        <p className="border-t border-line-1 px-2.5 py-1.5 text-nano text-blocked" role="status">
          The live stream dropped — showing what was recorded.
        </p>
      ) : null}
    </div>
  );
}
