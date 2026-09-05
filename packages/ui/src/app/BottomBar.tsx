import { A } from './link';
import { BAR } from './barGeometry';
import type { NavItem } from './nav';
import { href } from './nav';
import { NavGlyph } from './NavGlyph';
import { PlusGlyph } from './PlusGlyph';
import { updateEntryLabel } from '../lib/upgrade';
import type { UpdateEntry } from '../lib/upgrade';
import { cx } from '../lib/cx';

export interface BottomBarProps {
  ws: string;
  items: NavItem[];
  needsCount: number;
  /** The daemon's release state, when there is something to say about it; badged on More. */
  update?: UpdateEntry | null;
  isActive: (to: string) => boolean;
  onStartWork: () => void;
}

/**
 * Phone bottom bar: five tabs plus a floating Start Work — DESIGN-CONTRACT.md §3.
 *
 * The geometry comes from `barGeometry` rather than utility classes because the
 * button's lower half and the tab row share one column at the bar centre; the
 * two offsets have to be read together, and the test reads them off the DOM.
 */
export function BottomBar({ ws, items, needsCount, update, isActive, onStartWork }: BottomBarProps): React.ReactElement {
  return (
    <nav
      aria-label="Sections"
      style={{ paddingTop: `${BAR.tabTop}rem` }}
      className="ac-bar fixed inset-x-0 bottom-0 z-30 flex border-t border-line-1 bg-bg-input px-1.5 md:hidden"
    >
      {items.map((item) => {
        const active = isActive(href(item, ws));
        return (
          <A key={item.key} to={href(item, ws)} className="relative flex flex-1 flex-col items-center gap-1.5">
            <NavGlyph glyph={item.glyph} active={active} />
            <span className={cx('text-nano font-medium', active ? 'text-text-1' : 'text-text-nav')}>{item.label}</span>
            {item.key === 'needs' && needsCount > 0 ? (
              <span className="ac-mono absolute -top-1 right-1/4 rounded-pill bg-needs-you px-1 text-nano text-bg-0">{needsCount}</span>
            ) : null}
            {/* Absolutely positioned, like the Needs-you count: the bar's geometry is unchanged. */}
            {item.key === 'more' && update ? (
              <span
                aria-label={updateEntryLabel(update)}
                className={cx('absolute -top-1 right-1/4 size-1.5 rounded-pill', update.state === 'upgrading' ? 'bg-merging' : 'bg-needs-you')}
              />
            ) : null}
          </A>
        );
      })}
      <button
        type="button"
        aria-label="Start work"
        onClick={onStartWork}
        style={{ top: `${BAR.fabTop}rem`, width: `${BAR.fabSize}rem`, height: `${BAR.fabSize}rem` }}
        className="absolute left-1/2 flex -translate-x-1/2 items-center justify-center rounded-pill border-[3px] border-bg-0 bg-accent text-accent-on shadow-float"
      >
        <PlusGlyph className="size-4" />
      </button>
    </nav>
  );
}
