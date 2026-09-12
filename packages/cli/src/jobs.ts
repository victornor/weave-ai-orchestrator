/**
 * Following a job from the terminal (VS-37): the same sub-steps and the same output the web app
 * shows, off the same `GET /jobs/:id/stream`.
 *
 * `quiet` is JSON output mode — the command still has to wait for the job, because its one document
 * describes the finished thing, but nothing may be interleaved with it.
 */
import type { ApiClient } from './api.js';
import { ApiError } from './api.js';
import type { Job, JobLogLine, JobStep } from '@weave-ai/shared';
import { style, writeErr } from './output.js';

export type JobStreamItem =
  | { kind: 'step'; jobId: string; step: JobStep; seq: number }
  | { kind: 'log'; jobId: string; line: JobLogLine; seq: number }
  | { kind: 'finished'; jobId: string; job: Job; seq: number };

/** How long to wait for a job that stops saying anything at all. */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export interface FollowOptions { quiet?: boolean }

/**
 * Print a job's progress until it ends, and resolve with the finished record. Progress goes to
 * stderr so `weave project add ... > file` still captures only the result.
 */
export async function followJob(client: ApiClient, jobId: string, opts: FollowOptions = {}): Promise<Job> {
  const quiet = opts.quiet === true;
  const seenStep = new Map<string, string>();
  let active: string | null = null;

  const onStep = (step: JobStep): void => {
    if (seenStep.get(step.id) === step.state) return;
    seenStep.set(step.id, step.state);
    if (quiet || step.state === 'pending') return;
    if (step.state === 'running') { active = step.id; writeErr(`${style.dim('▸')} ${step.label}…`); return; }
    const took = elapsed(step);
    if (step.state === 'done') writeErr(`${style.ok('✓')} ${step.label}${took ? style.dim(` (${took})`) : ''}`);
    else if (step.state === 'skipped') writeErr(`${style.dim('–')} ${step.label} ${style.dim('skipped')}`);
    else writeErr(`${style.bad('✗')} ${step.label}`);
  };

  const onLine = (line: JobLogLine): void => {
    if (quiet) return;
    // Only the step being watched: a replayed tail of an earlier step is noise, not progress.
    if (active && line.step !== active) return;
    writeErr(style.dim(`   ${line.text}`));
  };

  return new Promise<Job>((resolve, reject) => {
    let idle: ReturnType<typeof setTimeout> | null = null;
    const bump = (): void => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => {
        subscription.close();
        reject(new ApiError('internal', `job ${jobId} stopped reporting`, 0, undefined, true));
      }, IDLE_TIMEOUT_MS);
    };
    const done = (job: Job): void => {
      if (idle) clearTimeout(idle);
      subscription.close();
      resolve(job);
    };

    const subscription = client.stream(client.w(`/jobs/${encodeURIComponent(jobId)}/stream`), {
      onMessage: (message) => {
        const item = message.json as JobStreamItem | null;
        if (!item) return;
        bump();
        if (item.kind === 'step') onStep(item.step);
        else if (item.kind === 'log') onLine(item.line);
        else done(item.job);
      },
      onError: (_error, attempt) => { if (attempt === 1 && !quiet) writeErr(style.dim('reconnecting…')); },
    });
    bump();
  });
}

/** How long a finished step took, as `1m 12s` / `3.4s`, or '' when the record has no span. */
export function elapsed(step: Pick<JobStep, 'startedAt' | 'endedAt'>): string {
  if (!step.startedAt || !step.endedAt) return '';
  return formatMs(Date.parse(step.endedAt) - Date.parse(step.startedAt));
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** The failing step's label and the lines that led to it — what a human needs to act on. */
export function failureReport(job: Job, tailLines = 12): string[] {
  const step = job.steps.find((s) => s.id === job.failedStep);
  const out = [`${style.bad('failed')} ${step?.label ?? job.failedStep ?? 'the job'}`];
  if (job.message) out.push(style.dim(`  ${job.message.split('\n')[0]!.slice(0, 300)}`));
  for (const line of job.log.filter((l) => !job.failedStep || l.step === job.failedStep).slice(-tailLines)) {
    out.push(style.dim(`  ${line.text}`));
  }
  return out;
}
