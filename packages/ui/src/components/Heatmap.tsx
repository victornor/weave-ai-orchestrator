/**
 * The changelog's activity heatmap (PLAN §13.6): a calendar grid of the last year, one cell per day,
 * shaded by that day's output. Pure SVG and design tokens, like `Chart.tsx` — no chart library.
 *
 * The grid is a column per week, Monday at the top, which is how a contribution graph reads. The
 * daemon returns a dense series (every day in the range, zeros included), so nothing here fills gaps;
 * it only has to decide which column and row a day belongs in.
 */
import { useMemo, useState } from 'react';
import type { ChangelogDay, ChangelogHeatmap } from '../api/types';
import { cx } from '../lib/cx';

const CELL = 11;
const GAP = 2;
const STEP = CELL + GAP;
const ROWS = 7;
/** Five buckets: none, then four quartiles of the days that had any activity. */
const SHADES = ['var(--bg-input)', 'var(--status-done-dim, var(--status-done))', 'var(--status-done)', 'var(--status-working)', 'var(--status-needs-you)'];

/** Monday is row 0, Sunday row 6 — the week the timeline separators also use. */
function rowOf(date: string): number {
  const d = new Date(`${date}T00:00:00Z`);
  return (d.getUTCDay() + 6) % 7;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (date: string): string => MONTHS[Number(date.slice(5, 7)) - 1] ?? '';

/**
 * The four thresholds that separate the shades, taken from the days that had any activity rather than
 * from the whole range: in a workspace that rests at weekends, most days are zero and a median over
 * everything would put every working day in the same bucket.
 */
function thresholds(values: number[]): number[] {
  const active = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!active.length) return [1, 2, 3, 4];
  const at = (q: number) => active[Math.min(active.length - 1, Math.floor(active.length * q))] ?? 1;
  // Strictly increasing, so two thresholds never collapse into an unreachable bucket.
  const raw = [1, at(0.5), at(0.75), at(0.9)];
  return raw.map((v, i) => Math.max(v, i === 0 ? 1 : (raw[i - 1] ?? 1) + (i > 0 ? 0 : 0)));
}

function shadeOf(value: number, steps: number[]): string {
  if (value <= 0) return SHADES[0]!;
  let level = 1;
  for (let i = 1; i < steps.length; i += 1) if (value >= (steps[i] ?? Infinity)) level = i + 1;
  return SHADES[Math.min(level, SHADES.length - 1)]!;
}

export interface HeatmapProps {
  heatmap: ChangelogHeatmap;
  /** Activating a cell: the timeline scrolls to that day. */
  onSelect?: (date: string) => void;
  className?: string;
}

export function ActivityHeatmap({ heatmap, onSelect, className }: HeatmapProps): React.ReactElement {
  const [active, setActive] = useState<ChangelogDay | null>(null);
  const days = heatmap.days;

  const { columns, steps, weeks } = useMemo(() => {
    const first = days[0];
    // The grid starts on the Monday of the first day's week, so every column is a whole week.
    const lead = first ? rowOf(first.date) : 0;
    const cols: Array<Array<ChangelogDay | null>> = [];
    let col: Array<ChangelogDay | null> = new Array<ChangelogDay | null>(lead).fill(null);
    for (const day of days) {
      col.push(day);
      if (col.length === ROWS) { cols.push(col); col = []; }
    }
    if (col.length) { while (col.length < ROWS) col.push(null); cols.push(col); }
    return { columns: cols, steps: thresholds(days.map((d) => d.landed)), weeks: cols.length };
  }, [days]);

  const measure = heatmap.measure;
  const width = weeks * STEP + GAP;
  const height = ROWS * STEP + GAP;

  // One label per month, on the first column whose Monday falls in a new month.
  const monthTicks = useMemo(() => {
    const ticks: Array<{ x: number; label: string }> = [];
    let last = '';
    columns.forEach((c, i) => {
      const day = c.find((d): d is ChangelogDay => d !== null);
      if (!day) return;
      const m = day.date.slice(0, 7);
      if (m !== last) { ticks.push({ x: i * STEP, label: monthLabel(day.date) }); last = m; }
    });
    return ticks;
  }, [columns]);

  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <span className="text-meta text-text-1">{measure.label}</span>
          {/* The spec requires the measure and its definition to be visible, not hidden in a tooltip. */}
          <span className="ml-2 text-micro text-text-3">{measure.definition}</span>
        </div>
        <span className="ac-mono text-nano text-text-4">{heatmap.timezone}</span>
      </div>

      <div className="overflow-x-auto">
        <svg width={width} height={height + 14} role="img" aria-label={`${measure.label} per day`} className="block">
          <g>
            {monthTicks.map((t) => (
              <text key={t.x} x={t.x} y={9} className="ac-mono" fontSize={8} fill="var(--text-4)">{t.label}</text>
            ))}
          </g>
          <g transform="translate(0, 14)">
            {columns.map((col, ci) =>
              col.map((day, ri) => {
                if (!day) return null;
                const label = `${day.date}: ${day.landed} landed, ${day.total} entries`;
                return (
                  <rect
                    key={day.date}
                    x={ci * STEP}
                    y={ri * STEP}
                    width={CELL}
                    height={CELL}
                    rx={2}
                    fill={shadeOf(day.landed, steps)}
                    stroke="var(--line-1)"
                    strokeWidth={0.5}
                    tabIndex={0}
                    role="button"
                    aria-label={label}
                    data-date={day.date}
                    className="cursor-pointer outline-none focus-visible:stroke-[var(--status-working)]"
                    onMouseEnter={() => setActive(day)}
                    onMouseLeave={() => setActive((a) => (a?.date === day.date ? null : a))}
                    onFocus={() => setActive(day)}
                    // A touch device has no hover: the first tap shows the day, and the button below commits it.
                    onClick={() => { setActive(day); onSelect?.(day.date); }}
                  >
                    <title>{label}</title>
                  </rect>
                );
              }),
            )}
          </g>
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div aria-live="polite" className="min-h-[1.25rem] text-micro text-text-2">
          {active ? (
            <span data-testid="heatmap-detail">
              <span className="ac-mono">{active.date}</span>
              {' · '}
              {active.landed} landed
              {' · '}
              {active.total} {active.total === 1 ? 'entry' : 'entries'}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="ac-mono text-nano text-text-4">less</span>
          {SHADES.map((s, i) => (
            <span key={i} className="size-2.5 rounded-[2px] border border-line-1" style={{ background: s }} aria-hidden />
          ))}
          <span className="ac-mono text-nano text-text-4">more</span>
        </div>
      </div>
    </div>
  );
}
