import { A } from './link';
import { GLOBAL_NAV, MORE_ITEMS, href } from './nav';
import { NavGlyph } from './NavGlyph';
import { PlusGlyph } from './PlusGlyph';
import { Sheet } from '../components/Sheet';
import { Badge } from '../components/StatusGlyph';
import { updateEntryLabel } from '../lib/upgrade';
import type { UpdateEntry } from '../lib/upgrade';
import type { WorkspaceListItem } from '../api/types';
import { projectLabel, type Project } from '@weave-ai/shared';
import { cx } from '../lib/cx';

export interface MoreSheetProps {
  open: boolean;
  onClose: () => void;
  /** The workspace the destinations address, as the route names it. */
  ws: string;
  /** The daemon's canonical id for that workspace, which is what a listed workspace is compared against. */
  activeWs: string;
  workspaces: WorkspaceListItem[];
  /**
   * The active workspace's projects, each opening its overview (VS-95). They are not a rail
   * destination, so they are not in `MORE_ITEMS` — that list is the rail's leftovers and a test
   * pins it against `RAIL` and `TABS`.
   */
  projects: Project[];
  /** The active workspace's live Needs-you count; the listed one is a refetch behind. */
  needsCount: number;
  update?: UpdateEntry | null;
  isActive: (to: string) => boolean;
  onNewWorkspace: () => void;
}

/**
 * What the phone's More tab opens: every destination the five tabs leave out, the other workspaces,
 * and the daemon's release state when there is something to say about it.
 *
 * Purely presentational — `AppShell` owns every hook — so it renders in a test from plain data,
 * like `WorkspaceNav`. Dismissal, Escape, the focus trap and the grab handle come from `Sheet`.
 */
export function MoreSheet({
  open, onClose, ws, activeWs, workspaces, projects, needsCount, update, isActive, onNewWorkspace,
}: MoreSheetProps): React.ReactElement {
  return (
    <Sheet open={open} onClose={onClose} title="More" swipeToClose>
      <div className="ac-safe-bottom flex flex-col gap-5">
        {/* The same fact the rail carries in its own block and the More tab badges — opening the
            Updates section of the daemon's settings. */}
        {update ? (
          <A
            to="/settings"
            search={{ section: 'updates' }}
            aria-label={updateEntryLabel(update)}
            onClick={onClose}
            className="flex items-center gap-2.5 rounded-r6 border border-accent-edge bg-accent-tint px-3.5 py-2.5"
          >
            <span className={cx('size-1.5 flex-none rounded-pill', update.state === 'upgrading' ? 'bg-merging' : 'bg-needs-you')} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-meta font-medium text-text-1">{update.title}</span>
              <span className="ac-mono block truncate text-nano text-text-3">{update.detail}</span>
            </span>
            <span className="flex-none text-micro font-medium text-accent-link">Open Updates</span>
          </A>
        ) : null}

        <nav aria-label="Global" className="flex flex-col gap-px">
          {GLOBAL_NAV.map((item) => {
            const current = isActive(item.to);
            return (
              <A
                key={item.key}
                to={item.to}
                aria-current={current ? 'page' : undefined}
                onClick={onClose}
                className={cx('flex items-center gap-3 rounded-r6 px-2.5 py-2.5', current ? 'bg-bg-3' : 'hover:bg-bg-2')}
              >
                <NavGlyph glyph={item.glyph} active={current} />
                <span className="min-w-0 flex-1">
                  <span className={cx('block text-body font-medium', current ? 'text-text-1' : 'text-text-2')}>{item.label}</span>
                  {item.hint ? <span className="block truncate text-micro text-text-3">{item.hint}</span> : null}
                </span>
              </A>
            );
          })}
        </nav>

        <nav aria-label="More sections" className="flex flex-col gap-px">
          {MORE_ITEMS.map((item) => {
            const to = href(item, ws);
            const current = isActive(to);
            return (
              <A
                key={item.key}
                to={to}
                aria-current={current ? 'page' : undefined}
                onClick={onClose}
                className={cx('flex items-center gap-3 rounded-r6 px-2.5 py-2.5', current ? 'bg-bg-3' : 'hover:bg-bg-2')}
              >
                <NavGlyph glyph={item.glyph} active={current} />
                <span className="min-w-0 flex-1">
                  <span className={cx('block text-body font-medium', current ? 'text-text-1' : 'text-text-2')}>{item.label}</span>
                  {item.hint ? <span className="block truncate text-micro text-text-3">{item.hint}</span> : null}
                </span>
              </A>
            );
          })}
        </nav>

        {/* The sidebar is desktop-only, so this is the phone's way to a project's overview and
            to add one (VS-158). The block stays even when there are no projects yet. */}
        <section aria-label="Projects">
          <div className="ac-label mb-2">Projects</div>
          {projects.length > 0 ? (
            <div className="ac-card divide-y divide-line-1">
              {projects.map((p) => (
                <A
                  key={p.id}
                  to="/w/$ws/p/$project"
                  params={{ ws, project: p.slug }}
                  onClick={onClose}
                  className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-bg-2"
                >
                  <span className="min-w-0 flex-1 truncate text-meta text-text-1">{projectLabel(p)}</span>
                  <span className="ac-mono text-nano text-text-4">{p.defaultBranch}</span>
                </A>
              ))}
            </div>
          ) : null}
          <A
            to="/w/$ws/settings"
            params={{ ws }}
            search={{ section: 'projects' }}
            onClick={onClose}
            className="mt-1.5 flex h-9 w-full items-center gap-2.5 rounded-r6 px-2.5 text-left text-meta text-text-3 hover:bg-bg-2"
          >
            <PlusGlyph className="size-2.5" />
            <span>New project</span>
          </A>
        </section>

        {/* The bottom bar addresses the active workspace only, so this is where the others are
            reached on a phone. It stays at the top of Settings as well — the same list, one tap
            further in — so a link into Settings is not a dead end. */}
        <section aria-label="Workspaces">
          <div className="ac-label mb-2">Workspaces</div>
          <div className="ac-card divide-y divide-line-1">
            {workspaces.map((w) => {
              const count = w.id === activeWs ? needsCount : w.needsYou;
              return (
                <A
                  key={w.id}
                  to={`/w/${encodeURIComponent(w.id)}/needs`}
                  onClick={onClose}
                  className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-bg-2"
                >
                  <span className="min-w-0 flex-1 truncate text-meta text-text-1">{w.name}</span>
                  {count > 0 ? (
                    <span className="ac-mono text-nano text-needs-you" aria-label={`${count} waiting for you`}>{count}</span>
                  ) : null}
                  <span className="ac-mono text-micro text-text-3">{w.ticketPrefix}</span>
                  {w.id === activeWs ? <Badge tone="accent">current</Badge> : null}
                </A>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              onClose();
              onNewWorkspace();
            }}
            className="mt-1.5 flex h-9 w-full items-center gap-2.5 rounded-r6 px-2.5 text-left text-meta text-text-3 hover:bg-bg-2"
          >
            <PlusGlyph className="size-2.5" />
            <span>New workspace</span>
          </button>
        </section>

      </div>
    </Sheet>
  );
}
