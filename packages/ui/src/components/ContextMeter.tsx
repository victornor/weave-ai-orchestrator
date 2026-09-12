/**
 * How full the conductor's context window is, beside the plan meter in the chat header. Prop-driven
 * — the view model comes from `contextStrip()` in `@weave-ai/render`, and both the window and
 * the compaction point come from the runtime's own model list and capabilities, so nothing about a
 * particular CLI is decided here.
 *
 * The number is the last finished turn's `inputTokens + cachedInputTokens`: the conductor's session
 * is resumed, so everything the conversation holds is re-sent or read back from cache each turn.
 */
import type { ContextStripView } from '@weave-ai/render';
import { cx } from '../lib/cx';

/** Amber past 80 %, red past 95 % — the thresholds the plan meter beside it uses. */
const TONE: Record<'ok' | 'warn' | 'over', string> = {
  ok: 'bg-accent-link',
  warn: 'bg-stalled',
  over: 'bg-failed',
};

export function ContextMeter({ view, className }: { view: ContextStripView | null; className?: string }): React.ReactElement | null {
  if (!view) return null;

  const title = view.meter
    ? `Context ${view.tokensLabel} of ${view.windowLabel} tokens${view.meter.toCompaction === null ? '' : ` · ${view.meter.toCompaction}% of the way to this runtime's compaction point`}`
    : `${view.reason} — the last turn reported ${view.tokensLabel} tokens`;

  // A percentage is only as trustworthy as its denominator, and that denominator has been wrong
  // twice (VS-129) — so the headline is the raw count, which a human can check against reality on
  // sight, never a fraction. The bar still carries the proportion visually; the one percentage left
  // in words is the distance to compaction, which is exactly where an over-window reading now shows
  // up as visibly impossible (>100%) beside a headline count that is not.
  const showBareSize = !view.meter && view.reason === 'Context window unknown';

  return (
    <span
      data-testid="context-meter"
      title={title}
      className={cx('flex min-w-0 flex-none items-center gap-1.5 whitespace-nowrap', className)}
    >
      {view.meter ? (
        <>
          <span className="hidden text-micro text-text-soft sm:inline">Context</span>
          <span className="ac-mono text-micro text-text-1">{view.tokensLabel}</span>
          <span className="hidden h-1.5 w-14 overflow-hidden rounded-pill bg-bg-2 sm:block" aria-hidden>
            {/* The bar cannot be drawn past its own track; `view.meter.percent` itself is left
                uncapped so the tone and the compaction percentage beside it can still say a true
                reading past 100 %. */}
            <span className={cx('block h-full rounded-pill opacity-75', TONE[view.meter.tone])} style={{ width: `${Math.min(100, view.meter.percent)}%` }} />
          </span>
          {view.meter.toCompaction === null ? null : (
            // Off the phone header, where the two meters together would not fit on one line; the
            // hover title still carries it.
            <span className="ac-mono hidden text-nano text-text-4 sm:inline">· {view.meter.toCompaction}% to compaction</span>
          )}
        </>
      ) : showBareSize ? (
        // The window is unknown, but the size is not: showing it beats the quiet reason line, which
        // is exactly what a human wants to sanity-check when the denominator cannot be trusted.
        <>
          <span className="hidden text-micro text-text-soft sm:inline">Context</span>
          <span className="ac-mono text-micro text-text-1">{view.tokensLabel}</span>
        </>
      ) : (
        // Nothing measured at all — no size to fall back to either.
        <span className="text-micro text-text-3">{view.reason}</span>
      )}
    </span>
  );
}
