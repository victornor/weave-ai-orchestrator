import type { UiStatus } from '@openconductor/shared';
import { STATUS_GLYPH, STATUS_LABEL, STATUS_TEXT, STATUS_VAR } from '../lib/status';
import { cx } from '../lib/cx';

export interface StatusGlyphProps {
  status: UiStatus;
  /** rem size of the glyph box; defaults to the 11px card size. */
  size?: 'xs' | 'sm' | 'md';
  pulse?: boolean;
  className?: string;
  title?: string;
}

const BOX = { xs: 'size-2', sm: 'size-2.5', md: 'size-3' } as const;

/**
 * One glyph per status, identical in badges, rows, cards, charts and
 * transcript lines (DESIGN-CONTRACT §2). Drawn as SVG so `stalled` can be the
 * working triangle, hollow and dashed.
 */
export function StatusGlyph({ status, size = 'sm', pulse, className, title }: StatusGlyphProps): React.ReactElement {
  const g = STATUS_GLYPH[status];
  const colour = STATUS_VAR[status];
  return (
    <svg
      viewBox="0 0 12 12"
      role="img"
      aria-label={title ?? STATUS_LABEL[status]}
      className={cx('flex-none', BOX[size], pulse && 'motion-safe:animate-[oc-pulse_1.6s_ease-in-out_infinite]', className)}
    >
      {g.kind === 'circle' ? (
        <circle cx="6" cy="6" r={g.filled ? 4.6 : 4.2} fill={g.filled ? colour : 'none'} stroke={colour} strokeWidth={g.filled ? 0 : 1.5} />
      ) : g.kind === 'bars' ? (
        <g fill={colour}>
          <rect x="1.6" y="1.4" width="3.2" height="9.2" rx="1" />
          <rect x="7.2" y="1.4" width="3.2" height="9.2" rx="1" />
        </g>
      ) : (
        <path
          d={g.d}
          fill={g.filled ? colour : 'none'}
          stroke={colour}
          strokeWidth={g.filled ? 0 : 1.4}
          strokeLinejoin="round"
          {...(g.dashed ? { strokeDasharray: '2.4 1.8' } : {})}
        />
      )}
    </svg>
  );
}

export function StatusBadge({ status, label, className }: { status: UiStatus; label?: string; className?: string }): React.ReactElement {
  return (
    <span className={cx('inline-flex items-center gap-1.5', STATUS_TEXT[status], className)}>
      <StatusGlyph status={status} size="xs" pulse={status === 'working'} />
      <span className="text-micro font-medium">{label ?? STATUS_LABEL[status]}</span>
    </span>
  );
}

/** micro/11 uppercase pill for kinds, delta words and exact sub-statuses. */
export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'added' | 'modified' | 'removed';
  className?: string;
}): React.ReactElement {
  const tones = {
    neutral: 'bg-bg-3 text-text-3 border-transparent',
    accent: 'bg-accent-tint text-accent-link border-accent-edge',
    added: 'bg-done/10 text-done border-done/30',
    modified: 'bg-working/10 text-working border-working/35',
    removed: 'bg-failed/10 text-failed border-failed/30',
  } as const;
  return (
    <span className={cx('oc-mono inline-flex items-center rounded-r4 border px-1.5 py-0.5 text-nano font-medium tracking-micro uppercase', tones[tone], className)}>
      {children}
    </span>
  );
}
