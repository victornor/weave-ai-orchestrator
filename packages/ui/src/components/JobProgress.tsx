/**
 * A job's sub-steps and the output of the one running (VS-37, `workspace-setup/setup-surfaces`).
 *
 * The job comes in as a prop rather than from a hook, so a test can drive it with data instead of
 * mocking the API layer.
 */
import { useEffect, useRef } from 'react';
import type { JobLogLine, JobStep } from '@agent-conductor/shared';
import { duration } from '../lib/format';
import { cx } from '../lib/cx';

export interface JobProgressProps {
  steps: JobStep[];
  log: JobLogLine[];
  /** Which sub-step failed, when one did — its lines are the ones worth showing after the fact. */
  failedStep?: string | null;
  message?: string | null;
  /** Advances the elapsed time of the running step; the caller ticks it. */
  now?: number;
  className?: string;
}

const GLYPH: Record<JobStep['state'], string> = { pending: '·', running: '▸', done: '✓', skipped: '–', failed: '✗' };

export function JobProgress({ steps, log, failedStep, message, now = Date.now(), className }: JobProgressProps): React.ReactElement | null {
  if (steps.length === 0) return null;
  const active = steps.find((s) => s.state === 'running') ?? null;
  // While it runs, the step being watched; once it failed, the one that failed. Both are "what matters now".
  const focus = active?.id ?? failedStep ?? null;
  const lines = focus ? log.filter((l) => l.step === focus) : log;

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <ol className="flex flex-col gap-0.5">
        {steps.map((step) => (
          <li key={step.id} className="flex items-baseline gap-2 text-micro">
            <span
              aria-hidden
              className={cx(
                'ac-mono w-3 flex-none',
                step.state === 'done' ? 'text-done' : step.state === 'failed' ? 'text-failed' : step.state === 'running' ? 'text-accent-link' : 'text-text-3',
              )}
            >
              {GLYPH[step.state]}
            </span>
            <span className={cx('min-w-0 flex-1 truncate', step.state === 'pending' ? 'text-text-3' : 'text-text-2')}>{step.label}</span>
            <span className="ac-mono flex-none text-nano text-text-3">{stepTiming(step, now)}</span>
          </li>
        ))}
      </ol>
      {lines.length ? (
        <pre className="ac-mono max-h-32 overflow-auto rounded-r6 bg-bg-2 px-2.5 py-1.5 text-nano leading-relaxed text-text-3">
          <LogTail lines={lines} />
        </pre>
      ) : null}
      {message ? <p className="text-nano text-failed">{message}</p> : null}
    </div>
  );
}

/** `skipped` for a step that had nothing to do, the span for one that ran, live seconds while it runs. */
function stepTiming(step: JobStep, now: number): string {
  if (step.state === 'skipped') return 'skipped';
  if (!step.startedAt) return '';
  const end = step.endedAt ? Date.parse(step.endedAt) : now;
  return duration(end - Date.parse(step.startedAt));
}

/** Keeps the newest line in view without fighting a human who has scrolled up to read. */
function LogTail({ lines }: { lines: JobLogLine[] }): React.ReactElement {
  const end = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = end.current?.parentElement;
    if (!node) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
    if (atBottom) node.scrollTop = node.scrollHeight;
  }, [lines.length]);
  return (
    <>
      {lines.map((l) => `${l.text}\n`).join('')}
      <span ref={end} />
    </>
  );
}
