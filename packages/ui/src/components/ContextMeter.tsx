/**
 * The one renderer of a `contextStrip` view-model (`@weave-ai/render`): a compact context bar
 * showing the last completed turn's context size over the model's window, with the runtime's
 * compaction point marked on the track.
 *
 * It draws only what `contextStrip` computed, so a surface using it cannot disagree with another
 * about the same turn — the Live floor (VS-554) and any later surface share one meter. A `null`
 * view (no completed turn) renders nothing, and a view with no meter (an unknown window) renders
 * the count and the view's reason without inventing a proportion.
 */
import type { ContextStripView } from '@weave-ai/render';
import { cx } from '../lib/cx';

/** The fill colour for each of the view-model's tones — the app's 80 %/95 % threshold idiom. */
const TONE_FILL: Record<'ok' | 'warn' | 'over', string> = { ok: 'bg-accent-link', warn: 'bg-stalled', over: 'bg-failed' };

export interface ContextMeterProps {
  /** The shared view-model, or null when there is no completed turn to measure. */
  view: ContextStripView | null;
  /** The runtime's compaction point as a fraction of the window (its `contextCompactionAt` capability). */
  compactionAt?: number | null;
  className?: string;
}

export function ContextMeter({ view, compactionAt, className }: ContextMeterProps): React.ReactElement | null {
  if (!view) return null;
  const meter = view.meter;
  const fill = meter ? Math.min(100, Math.max(0, meter.percent)) : 0;
  const marker = compactionAt && compactionAt > 0 ? Math.min(100, Math.max(0, compactionAt * 100)) : null;
  return (
    <div data-context-meter data-context-tone={meter?.tone ?? 'none'} className={cx('flex min-w-0 items-center gap-2', className)}>
      {meter ? (
        <div
          className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-bg-3"
          role="meter"
          aria-valuenow={fill}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Context ${view.tokensLabel} of ${view.windowLabel}`}
        >
          <div className={cx('h-full rounded-pill', TONE_FILL[meter.tone])} style={{ width: `${fill}%` }} data-context-fill />
          {marker !== null ? <div className="absolute top-0 h-full w-px bg-text-3" style={{ left: `${marker}%` }} data-context-compaction /> : null}
        </div>
      ) : null}
      <span className="ac-mono min-w-0 flex-none truncate text-nano text-text-3" data-context-label>
        {meter ? `${view.tokensLabel} / ${view.windowLabel}` : `${view.tokensLabel} ctx · ${view.reason ?? 'Context window unknown'}`}
      </span>
      <span className="ac-mono flex-none text-nano text-text-4">last turn</span>
    </div>
  );
}
