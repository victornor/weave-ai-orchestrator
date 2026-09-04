import type { UsageGrain, UsageWindow } from '@agent-conductor/shared';
import { Segmented } from './Tabs';
import { cx } from '../lib/cx';

export const WINDOW_OPTIONS: ReadonlyArray<{ value: UsageWindow; label: string }> = [
  { value: '24h', label: '24h' },
  { value: 'today', label: 'today' },
  { value: 'week', label: 'week' },
  { value: 'month', label: 'month' },
  { value: 'custom', label: 'custom' },
];

export const GRAIN_OPTIONS: ReadonlyArray<{ value: UsageGrain; label: string }> = [
  { value: 'hour', label: 'hour' },
  { value: 'day', label: 'day' },
  { value: 'week', label: 'week' },
];

/** Shared by every Usage panel and the ticket / worker usage tabs. */
export function WindowGrainPicker({
  window: w,
  grain,
  onWindow,
  onGrain,
  custom,
  onCustom,
  className,
}: {
  window: UsageWindow;
  grain: UsageGrain;
  onWindow: (w: UsageWindow) => void;
  onGrain: (g: UsageGrain) => void;
  custom?: { start: string; end: string };
  onCustom?: (r: { start: string; end: string }) => void;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cx('flex flex-wrap items-center gap-2', className)}>
      <Segmented ariaLabel="Window" options={WINDOW_OPTIONS} value={w} onChange={onWindow} />
      <Segmented ariaLabel="Grain" mono options={GRAIN_OPTIONS} value={grain} onChange={onGrain} />
      {w === 'custom' && onCustom ? (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            aria-label="Start date"
            value={custom?.start.slice(0, 10) ?? ''}
            onChange={(e) => onCustom({ start: new Date(e.target.value).toISOString(), end: custom?.end ?? new Date().toISOString() })}
            className="ac-mono h-7 rounded-r4 border border-line-2 bg-bg-1 px-2 text-micro text-text-1"
          />
          <span className="text-micro text-text-3">→</span>
          <input
            type="date"
            aria-label="End date"
            value={custom?.end.slice(0, 10) ?? ''}
            onChange={(e) => onCustom({ start: custom?.start ?? new Date().toISOString(), end: new Date(e.target.value).toISOString() })}
            className="ac-mono h-7 rounded-r4 border border-line-2 bg-bg-1 px-2 text-micro text-text-1"
          />
        </div>
      ) : null}
    </div>
  );
}
