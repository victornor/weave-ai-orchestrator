/**
 * The onboarding step machinery shared by V1's `OnboardingRoute` and V2's `V2Onboarding`
 * (PLAN §20 `weave init`): the create-step view model, its resume record and the row that renders
 * one step's state and job output.
 */
import { useEffect } from 'react';
import { Button } from '../components/Button';
import { JobProgress } from '../components/JobProgress';
import { StreamStatusNotice } from '../components/StreamStatus';
import { useJobStream } from '../api/jobStream';
import { duration } from './format';
import { cx } from './cx';

type StepState = 'pending' | 'running' | 'done' | 'failed';

/**
 * One line of the create step. `jobId` is set for the steps the daemon performs as a job — today
 * only adding a project — and is what the view re-attaches to after a reload.
 */
export interface StepView {
  label: string;
  state: StepState;
  detail?: string;
  startedAt?: number;
  endedAt?: number;
  jobId?: string;
  /** The project the step is adding, so Retry knows what to retry. */
  projectId?: string;
}

/**
 * Enough to come back to a create that is still running: which workspace, which steps, and the job
 * for each. Without it a reload during a four-minute clone lands back on an empty first-run form.
 */
const RESUME_KEY = 'ac.onboarding.resume';
export interface Resume { workspaceId: string; name: string; steps: StepView[] }

export function readResume(): Resume | null {
  try {
    const raw = window.localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Resume;
    return parsed && typeof parsed.workspaceId === 'string' && Array.isArray(parsed.steps) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeResume(resume: Resume | null): void {
  try {
    if (resume) window.localStorage.setItem(RESUME_KEY, JSON.stringify(resume));
    else window.localStorage.removeItem(RESUME_KEY);
  } catch { /* private mode, a full quota: the flow still works, it just cannot resume */ }
}

export function slugOf(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function prefixOf(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const raw = words.length >= 2 ? words.map((w) => w[0]!).join('') : (words[0] ?? '').slice(0, 4);
  const up = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const withLetter = /^[A-Z]/.test(up) ? up : `X${up}`;
  return withLetter.slice(0, 5).padEnd(2, 'X');
}

export function slugFromGitUrl(url: string): string {
  const tail = url.trim().replace(/\/+$/, '').split(/[/:]/).pop() ?? '';
  return slugOf(tail.replace(/\.git$/, ''));
}

/**
 * One create step. A step with a job shows which sub-step is running and tails its output; a step
 * without one — creating the workspace, configuring the conductor — shows its state and how long it
 * took, which is all a single request has to say.
 */
export function StepRow({ step, now, workspaceId, onFinish, onRetry }: {
  step: StepView;
  now: number;
  workspaceId: string | null;
  onFinish: (state: 'done' | 'failed', detail?: string) => void;
  onRetry?: () => void;
}): React.ReactElement {
  const { job, status: jobStreamStatus, retryNow: retryJobStream } = useJobStream(workspaceId, step.jobId ?? null);

  // The job is the authority on whether a job-backed step ended.
  const jobState = job?.state;
  const jobMessage = job?.message ?? null;
  useEffect(() => {
    if (!step.jobId || !jobState || jobState === 'running') return;
    if (step.state === 'done' || step.state === 'failed') return;
    onFinish(jobState === 'done' ? 'done' : 'failed', jobMessage ?? undefined);
  }, [step.jobId, step.state, jobState, jobMessage, onFinish]);

  const elapsed = step.startedAt ? duration((step.endedAt ?? now) - step.startedAt) : null;
  const failed = step.state === 'failed';

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className={cx('ac-mono mt-0.5 w-14 flex-none text-nano uppercase', step.state === 'done' ? 'text-done' : failed ? 'text-failed' : step.state === 'running' ? 'text-accent-link' : 'text-text-3')}>
        {step.state}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="block text-meta text-text-1">{step.label}</span>
          {elapsed ? <span className="ac-mono flex-none text-nano text-text-3">{elapsed}</span> : null}
        </span>
        {step.detail ? <span className={cx('ac-mono block truncate text-micro', failed ? 'text-failed' : 'text-text-3')}>{step.detail}</span> : null}
        {job && job.steps.length ? (
          <JobProgress className="mt-2" steps={job.steps} log={job.log} failedStep={job.failedStep} message={failed ? job.message : null} now={now} />
        ) : null}
        {step.jobId ? <StreamStatusNotice className="mt-2" status={jobStreamStatus} onRetry={retryJobStream} /> : null}
        {failed && onRetry ? (
          <span className="mt-2 block">
            <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>
          </span>
        ) : null}
      </span>
    </li>
  );
}
