/**
 * Live view of one job: `GET /api/w/:ws/jobs/:id/stream` (VS-37).
 *
 * The endpoint replays the job's sub-steps and its retained output before it tails, so a view that
 * mounts mid-step — including after a page reload — gets the whole picture without a separate
 * catch-up path, and a reconnect resumes from the highest `seq` seen.
 *
 * The workspace is a parameter, not `useWs()`: the first caller is onboarding, which is watching a
 * workspace it has only just created and is mounted outside any WorkspaceProvider.
 */
import { useEffect, useRef, useState } from 'react';
import type { Job, JobLogLine, JobStep } from '@agent-conductor/shared';


const BACKOFF = [500, 1000, 2000, 4000, 8000, 15000];
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

export function useJobStream(ws: string | null, jobId: string | null): LiveJob | null {
  const [job, setJob] = useState<LiveJob | null>(null);
  /** Highest seq rendered, so a reconnect asks for `?after=` it rather than replaying the tail. */
  const seq = useRef(0);

  useEffect(() => { setJob(null); seq.current = 0; }, [jobId]);

  useEffect(() => {
    if (!jobId || !ws) return;
    let stopped = false;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const handle = (m: MessageEvent<string>): void => {
      let item: JobStreamItem;
      try {
        item = JSON.parse(m.data) as JobStreamItem;
      } catch {
        return;
      }
      if (!item || typeof item.seq !== 'number') return;
      seq.current = Math.max(seq.current, item.seq);
      attempts = 0;
      setJob((prev) => reduce(prev ?? EMPTY, item));
    };

    const open = (): void => {
      if (stopped) return;
      const after = seq.current ? `?after=${seq.current}` : '';
      es = new EventSource(`/api/w/${encodeURIComponent(ws)}/jobs/${encodeURIComponent(jobId)}/stream${after}`, { withCredentials: true });
      es.onmessage = (m) => handle(m as MessageEvent<string>);
      // The daemon names every frame; onmessage only sees unnamed ones.
      for (const type of ['job.step', 'job.log', 'job.finished']) es.addEventListener(type, (m) => handle(m as MessageEvent<string>));
      es.onerror = () => {
        es?.close();
        if (stopped) return;
        attempts += 1;
        timer = setTimeout(open, BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)] ?? 15000);
      };
    };

    open();
    return () => {
      stopped = true;
      es?.close();
      if (timer) clearTimeout(timer);
    };
  }, [ws, jobId]);

  return job;
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
