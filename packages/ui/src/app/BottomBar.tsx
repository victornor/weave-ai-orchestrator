import { A } from './link';
import { BAR } from './barGeometry';
import type { NavItem } from './nav';
import { MORE_ITEMS, MORE_TAB_KEY, href } from './nav';
import { NavGlyph } from './NavGlyph';
import { updateEntryLabel } from '../lib/upgrade';
import type { UpdateEntry } from '../lib/upgrade';
import { cx } from '../lib/cx';

export interface BottomBarProps {
  ws: string;
  items: NavItem[];
  needsCount: number;
  /** The daemon's release state, when there is something to say about it; badged on More. */
  update?: UpdateEntry | null;
  /** What the other workspaces are waiting on — reachable only through the More menu, so badged there. */
  otherWorkspacesNeed?: number;
  isActive: (to: string) => boolean;
  /** More opens the menu of everything the bar leaves out; it does not navigate. */
  onMore: () => void;
  moreOpen?: boolean;
}

/**
 * Phone bottom bar: five tabs, and nothing floating over them — DESIGN-CONTRACT.md §3.
 *
 * The top padding still comes from `barGeometry` rather than a utility class: the test reads it
 * off the DOM to check every tab is left a thumb-sized target.
 *
 * Four tabs are links; More is the button that opens `MoreSheet`. Both render the same glyph,
 * label and badge slot, so the bar's geometry does not depend on which one a tab is.
 */
export function BottomBar({
  ws, items, needsCount, update, otherWorkspacesNeed = 0, isActive, onMore, moreOpen,
}: BottomBarProps): React.ReactElement {
  return (
    <nav
      aria-label="Sections"
      style={{ paddingTop: `${BAR.tabTop}rem` }}
      className="ac-bar fixed inset-x-0 z-30 flex border-t border-line-1 bg-bg-input px-1.5 md:hidden"
    >
      {items.map((item) => {
        const more = item.key === MORE_TAB_KEY;
        // More is active for whatever its menu leads to, so the bar still says where you are on a
        // page that has no tab of its own.
        const active = more ? MORE_ITEMS.some((m) => isActive(href(m, ws))) : isActive(href(item, ws));
        const body = (
          <>
            <NavGlyph glyph={item.glyph} active={active} />
            <span className={cx('text-nano font-medium', active ? 'text-text-1' : 'text-text-nav')}>{item.label}</span>
            {item.key === 'needs' && needsCount > 0 ? (
              <span className="ac-mono absolute -top-1 right-1/4 rounded-pill bg-needs-you px-1 text-nano text-bg-0">{needsCount}</span>
            ) : null}
            {/* Absolutely positioned, like the Needs-you count: the bar's geometry is unchanged.
                One badge slot, and the update wins it — it is the more time-bound of the two. */}
            {more && update ? (
              <span
                aria-label={updateEntryLabel(update)}
                className={cx('absolute -top-1 right-1/4 size-1.5 rounded-pill', update.state === 'upgrading' ? 'bg-merging' : 'bg-needs-you')}
              />
            ) : more && otherWorkspacesNeed > 0 ? (
              <span
                aria-label={`${otherWorkspacesNeed} waiting for you in other workspaces`}
                className="ac-mono absolute -top-1 right-1/4 rounded-pill bg-needs-you px-1 text-nano text-bg-0"
              >
                {otherWorkspacesNeed}
              </span>
            ) : null}
          </>
        );
        // Centred rather than top-aligned: VS-81 removed the button that used to sit above the
        // row, so the entry is centred in the chrome instead of hanging below its lower edge.
        const tabCx = 'relative flex flex-1 flex-col items-center justify-center gap-1.5';
        return more ? (
          <button key={item.key} type="button" onClick={onMore} aria-haspopup="dialog" aria-expanded={moreOpen ?? false} className={tabCx}>
            {body}
          </button>
        ) : (
          <A key={item.key} to={href(item, ws)} className={tabCx}>
            {body}
          </A>
        );
      })}
    </nav>
  );
}
