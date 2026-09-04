import type { UiStatus } from '@openconductor/shared';
import type { NavItem } from './nav';
import { STATUS_GLYPH } from '../lib/status';
import { cx } from '../lib/cx';

/**
 * Nav icons reuse the status glyph shapes so the chrome is one system, but
 * they stay greyscale — colour in the chrome always means state.
 */
export function NavGlyph({ glyph, active, className }: { glyph: NavItem['glyph']; active?: boolean; className?: string }): React.ReactElement {
  const colour = active ? 'var(--text-1)' : 'var(--text-nav)';
  const box = cx('size-4', className);

  if (glyph === 'chat') {
    return (
      <svg viewBox="0 0 16 16" className={box} aria-hidden>
        <path d="M0.8 1.4h14.4v9.6H5.4L2.4 14.4V11H0.8z" fill={colour} />
      </svg>
    );
  }
  if (glyph === 'board') {
    return (
      <svg viewBox="0 0 16 16" className={box} aria-hidden>
        <rect x="0.8" y="1.6" width="4" height="12.8" rx="1" fill={colour} />
        <rect x="6" y="1.6" width="4" height="9" rx="1" fill={colour} />
        <rect x="11.2" y="1.6" width="4" height="6.4" rx="1" fill={colour} />
      </svg>
    );
  }
  if (glyph === 'more') {
    return (
      <svg viewBox="0 0 16 16" className={box} aria-hidden>
        <rect x="0.8" y="5" width="14.4" height="1.8" rx="0.9" fill={colour} />
        <rect x="0.8" y="9.2" width="14.4" height="1.8" rx="0.9" fill={colour} />
      </svg>
    );
  }

  const g = STATUS_GLYPH[glyph as UiStatus];
  return (
    <svg viewBox="0 0 12 12" className={box} aria-hidden>
      {g.kind === 'circle' ? (
        <circle cx="6" cy="6" r="4.6" fill={colour} />
      ) : g.kind === 'bars' ? (
        <g fill={colour}>
          <rect x="1.6" y="1.4" width="3.2" height="9.2" rx="1" />
          <rect x="7.2" y="1.4" width="3.2" height="9.2" rx="1" />
        </g>
      ) : (
        <path d={g.d} fill={colour} />
      )}
    </svg>
  );
}
