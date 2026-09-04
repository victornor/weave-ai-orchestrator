import { useId } from 'react';
import { cx } from '../lib/cx';
import { tokens as fmtTokens } from '../lib/format';

/** Series colours come from the status token family so charts match badges. */
const SERIES_VARS = ['var(--status-needs-you)', 'var(--status-done)', 'var(--status-working)', 'var(--status-merging)', 'var(--status-blocked)', 'var(--status-idle)'];

export function seriesColor(i: number): string {
  return SERIES_VARS[i % SERIES_VARS.length]!;
}

export interface StackedBucket {
  label: string;
  parts: Array<{ key: string; value: number }>;
}

/** Tokens per bucket, stacked by project / model. Pure SVG, no chart library. */
export function StackedBars({
  buckets,
  keys,
  height = 180,
  className,
  onSelect,
}: {
  buckets: StackedBucket[];
  keys: Array<{ key: string; label: string }>;
  height?: number;
  className?: string;
  onSelect?: (key: string) => void;
}): React.ReactElement {
  const max = Math.max(1, ...buckets.map((b) => b.parts.reduce((s, p) => s + p.value, 0)));
  const colourOf = new Map(keys.map((k, i) => [k.key, seriesColor(i)]));

  return (
    <div className={cx('flex flex-col gap-3.5', className)}>
      <div className="flex flex-wrap items-center gap-3.5">
        {keys.map((k, i) => (
          <button key={k.key} type="button" onClick={() => onSelect?.(k.key)} className="flex items-center gap-1.5">
            <span className="size-2 rounded-r4" style={{ background: seriesColor(i) }} />
            <span className="oc-mono text-micro text-text-3">{k.label}</span>
          </button>
        ))}
      </div>
      <div className="flex items-end gap-2.5 overflow-x-auto" style={{ height }}>
        {buckets.map((b) => {
          const total = b.parts.reduce((s, p) => s + p.value, 0);
          return (
            <div key={b.label} className="flex min-w-6 flex-1 flex-col items-center gap-2">
              <span className="oc-mono text-nano text-text-4">{total ? fmtTokens(total) : ''}</span>
              <div className="flex w-full max-w-14 flex-1 flex-col justify-end overflow-hidden rounded-t-r4" title={`${b.label}: ${fmtTokens(total)}`}>
                {b.parts.map((p) => (
                  <div
                    key={p.key}
                    style={{ height: `${total ? (p.value / max) * 100 : 0}%`, background: colourOf.get(p.key) ?? seriesColor(0) }}
                    aria-hidden
                  />
                ))}
              </div>
              <span className="oc-mono text-nano text-text-3">{b.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One-line share bar: model mix, project share, cost provenance. */
export function ShareBar({ parts, className }: { parts: Array<{ key: string; value: number; colour?: string }>; className?: string }): React.ReactElement {
  const total = Math.max(1, parts.reduce((s, p) => s + p.value, 0));
  return (
    <div className={cx('flex h-2 overflow-hidden rounded-pill', className)} aria-hidden>
      {parts.map((p, i) => (
        <div key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.colour ?? seriesColor(i) }} />
      ))}
    </div>
  );
}

/** Ranked rows with a proportional bar: top tickets, top models, top roles. */
export function RankedBars({
  rows,
  className,
  onSelect,
}: {
  rows: Array<{ key: string; label: string; sublabel?: string | null; value: number; right?: string; colourIndex?: number }>;
  className?: string;
  onSelect?: (key: string) => void;
}): React.ReactElement {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className={cx('flex flex-col gap-2.5', className)}>
      {rows.map((r, i) => (
        <button key={r.key} type="button" onClick={() => onSelect?.(r.key)} className="flex items-center gap-3 text-left">
          <span className="oc-mono w-16 flex-none truncate text-micro text-text-3">{r.label}</span>
          {r.sublabel ? <span className="oc-truncate hidden w-56 flex-none text-meta text-text-soft sm:block">{r.sublabel}</span> : null}
          <span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-bg-2">
            <span className="block h-full rounded-pill opacity-75" style={{ width: `${(r.value / max) * 100}%`, background: seriesColor(r.colourIndex ?? i) }} />
          </span>
          <span className="oc-mono w-14 flex-none text-right text-micro text-text-1">{fmtTokens(r.value)}</span>
          {r.right ? <span className="oc-mono w-12 flex-none text-right text-micro text-text-3">{r.right}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Sparkline / line series over buckets — runs per day, model mix over time. */
export function LineSeries({
  points,
  height = 64,
  className,
  colour = 'var(--accent)',
  label,
}: {
  points: number[];
  height?: number;
  className?: string;
  colour?: string;
  label?: string;
}): React.ReactElement {
  const id = useId();
  const max = Math.max(1, ...points);
  const w = Math.max(1, points.length - 1);
  const d = points.map((p, i) => `${(i / w) * 100},${100 - (p / max) * 100}`).join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={cx('w-full', className)} style={{ height }} role="img" aria-label={label ?? 'series'}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colour} stopOpacity="0.28" />
          <stop offset="100%" stopColor={colour} stopOpacity="0" />
        </linearGradient>
      </defs>
      {points.length > 1 ? (
        <>
          <polyline points={`0,100 ${d} 100,100`} fill={`url(#${id})`} stroke="none" />
          <polyline points={d} fill="none" stroke={colour} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </>
      ) : null}
    </svg>
  );
}

/** Big number + caption; the tokens headline with cost as the secondary. */
export function StatTile({ value, caption, muted, className }: { value: string; caption: string; muted?: boolean; className?: string }): React.ReactElement {
  return (
    <div className={cx('flex-1 bg-bg-1 p-4', className)}>
      <div className={cx('oc-mono text-display font-medium tracking-display', muted ? 'text-text-2' : 'text-text-strong')}>{value}</div>
      <div className="mt-2 text-micro text-text-3">{caption}</div>
    </div>
  );
}
