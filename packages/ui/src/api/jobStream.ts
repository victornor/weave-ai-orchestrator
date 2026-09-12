/**
 * Live view of one job: `GET /api/w/:ws/jobs/:id/stream` (VS-37).
 *
 * The endpoint replays the job's sub-steps and its retained output before it tails, so a view that
 * mounts mid-step — including after a page reload — gets the whole picture without a separate
 * catch-up path, and a reconnect resumes from the highest `seq` seen.
 *
 * The workspace is a parameter, not `useWs()`: the first caller is onboarding, which is watching a
 * workspace it has only just created and is mounted outside any WorkspaceProvider.
 *
 * The connection state and manual retry come from `useLiveStream` (`sseStream.ts`), the same
 * state machine the workspace event stream uses. See `live-streams/connection-state`.
 */
import { useEffect, useRef, useState } from 'react';
import type { Job, JobLogLine, JobStep } from '@weave-ai/shared';
import { useLiveStream } from './sseStream';
import type { ConnectionStatus } from './sseStream';

/** Stable reference: an inline array literal here would reopen the stream on every render. */
const JOB_EVENT_TYPES = ['job.step', 'job.log', 'job.finished'] as const;

/** What the view keeps on screen; the daemon retains the same number on the record. */
export const JOB_LOG_VIEW_LINES = 200;

type JobStreamItem =
  | { kind: 'step'; jobId: string; step: JobStep; seq: number }
  | { kind: 'log'; jobId: string; line: JobLogLine; seq: number }
  | { kind: 'finished'; jobId: string; job: Job; seq: number };

/** What a surface needs from a job it is watching. `null` until the first frame arrives. */
export interface LiveJob {
  steps: JobStep[];
  log: JobLogLine[];
  state: Job['state'];
  failedStep: string | null;
  message: string | null;
  finishedAt: string | null;
}

const EMPTY: LiveJob = { steps: [], log: [], state: 'running', failedStep: null, message: null, finishedAt: null };

export interface JobStream {
  job: LiveJob | null;
  status: ConnectionStatus;
  retryNow: () => void;
}

export function useJobStream(ws: string | null, jobId: string | null): JobStream {
  const [job, setJob] = useState<LiveJob | null>(null);
  /** Highest seq rendered, so a reconnect asks for `?after=` it rather than replaying the tail. */
  const seq = useRef(0);
  const active = ws && jobId ? jobId : null;

  useEffect(() => { setJob(null); seq.current = 0; }, [jobId]);

  const { status, retryNow } = useLiveStream({
    resetKey: active,
    eventTypes: JOB_EVENT_TYPES,
    buildUrl: () => {
      if (!ws || !jobId) return null;
      const after = seq.current ? `?after=${seq.current}` : '';
      return `/api/w/${encodeURIComponent(ws)}/jobs/${encodeURIComponent(jobId)}/stream${after}`;
    },
    onFrame: (m) => {
      let item: JobStreamItem;
      try {
        item = JSON.parse(m.data) as JobStreamItem;
      } catch {
        return;
      }
      if (!item || typeof item.seq !== 'number') return;
      seq.current = Math.max(seq.current, item.seq);
      setJob((prev) => reduce(prev ?? EMPTY, item));
    },
  });

  return { job, status, retryNow };
}

/** Fold one frame in. Exported for the tests, which drive it without an EventSource. */
export function reduce(prev: LiveJob, item: JobStreamItem): LiveJob {
  if (item.kind === 'finished') {
    const { steps, log, state, failedStep, message, finishedAt } = item.job;
    return { steps, log: log.length ? log : prev.log, state, failedStep, message, finishedAt };
  }
  if (item.kind === 'step') {
    const steps = prev.steps.some((s) => s.id === item.step.id)
      ? prev.steps.map((s) => (s.id === item.step.id ? item.step : s))
      : [...prev.steps, item.step];
    return { ...prev, steps };
  }
  if (prev.log.some((l) => l.seq === item.line.seq)) return prev;
  const log = [...prev.log, item.line];
  return { ...prev, log: log.length > JOB_LOG_VIEW_LINES ? log.slice(-JOB_LOG_VIEW_LINES) : log };
}
