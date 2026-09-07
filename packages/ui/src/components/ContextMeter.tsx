/**
 * How full the conductor's context window is, beside the plan meter in the chat header. Prop-driven
 * — the view model comes from `contextStrip()` in `@agent-conductor/render`, and both the window and
 * the compaction point come from the runtime's own model list and capabilities, so nothing about a
 * particular CLI is decided here.
 *
 * The number is the last finished turn's `inputTokens + cachedInputTokens`: the conductor's session
 * is resumed, so everything the conversation holds is re-sent or read back from cache each turn.
 */
import type { ContextStripView } from '@agent-conductor/render';
import { cx } from '../lib/cx';

/** Amber past 80 %, red past 95 % — the thresholds the plan meter beside it uses. */
const TONE: Record<'ok' | 'warn' | 'over', string> = {
  ok: 'bg-accent-link',
  warn: 'bg-stalled',
  over: 'bg-failed',
};

export function ContextMeter({ view, className }: { view: ContextStripView | null; className?: string }): React.ReactElement | null {
  if (!view) return null;

  // The absolute count belongs on hover: the header carries the fraction, which is the part that
  // says whether to keep going or start a fresh thread.
  const title = view.meter
    ? `Context ${view.tokensLabel} of ${view.windowLabel} tokens${view.meter.toCompaction === null ? '' : ` · ${view.meter.toCompaction}% of the way to this runtime's compaction point`}`
    : `${view.reason} — the last turn reported ${view.tokensLabel} tokens`;

  return (
    <span
      data-testid="context-meter"
      title={title}
      className={cx('flex min-w-0 flex-none items-center gap-1.5 whitespace-nowrap', className)}
    >
      {view.meter ? (
        <>
          <span className="hidden text-micro text-text-soft sm:inline">Context</span>
          <span className="ac-mono text-micro text-text-1">{view.meter.percent}%</span>
          <span className="hidden h-1.5 w-14 overflow-hidden rounded-pill bg-bg-2 sm:block" aria-hidden>
            <span className={cx('block h-full rounded-pill opacity-75', TONE[view.meter.tone])} style={{ width: `${view.meter.percent}%` }} />
          </span>
          {view.meter.toCompaction === null ? null : (
            // Off the phone header, where the two meters together would not fit on one line; the
            // hover title still carries it.
            <span className="ac-mono hidden text-nano text-text-4 sm:inline">· {view.meter.toCompaction}% to compaction</span>
          )}
        </>
      ) : (
        // One quiet reason, never a percentage of a window we had to invent.
        <span className="text-micro text-text-3">{view.reason}</span>
      )}
    </span>
  );
}
