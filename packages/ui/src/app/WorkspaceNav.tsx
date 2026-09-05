import { A } from './link';
import { RAIL, href } from './nav';
import { PlusGlyph } from './PlusGlyph';
import type { WorkspaceListItem } from '../api/types';
import type { Project } from '../api/types';
import { cx } from '../lib/cx';

export interface WorkspaceNavProps {
  workspaces: WorkspaceListItem[];
  /** The workspace the app is showing, in the daemon's canonical id — never the raw URL param. */
  activeWs: string;
  activePath: string;
  expanded: readonly string[];
  onToggle: (key: string) => void;
  /**
   * The active workspace's live Needs-you count. The listed `needsYou` is up to a refetch interval
   * old, so where the two disagree for the workspace being shown, this one is the truth.
   */
  needsCount: number;
  /** The active workspace's projects. A non-active workspace's are not loaded, so none are shown. */
  projects: Project[];
  onNewWorkspace: () => void;
}

const PROJECT_DOT = ['needs-you', 'done', 'working', 'merging', 'blocked'] as const;

function Chevron({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg viewBox="0 0 8 8" className={cx('size-2 transition-transform duration-(--dur-fast) ease-ac', open && 'rotate-90')} aria-hidden>
      <path d="M2.5 1 6 4 2.5 7Z" fill="currentColor" />
    </svg>
  );
}

/**
 * The rail's workspace list: every workspace the daemon reports, each expanding into its own
 * sections. Purely presentational — `AppShell` owns every hook — so this can be rendered in a test
 * with plain data instead of the wholesale `api/hooks` mock the shell's own test needs.
 */
export function WorkspaceNav({
  workspaces, activeWs, activePath, expanded, onToggle, needsCount, projects, onNewWorkspace,
}: WorkspaceNavProps): React.ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="ac-label mb-2 px-2.5">Workspaces</div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {workspaces.map((w) => {
          const active = w.id === activeWs;
          // The active workspace is always open: the section being viewed can never be hidden.
          const open = active || expanded.includes(w.id);
          const count = active ? needsCount : w.needsYou;
          return (
            <div key={w.id} className="flex flex-col">
              <WorkspaceHeader
                name={w.name}
                ticketPrefix={w.ticketPrefix}
                count={count}
                active={active}
                open={open}
                onToggle={() => onToggle(w.id)}
              />
              {open ? (
                <nav className="flex flex-col gap-px" aria-label={`${w.name} sections`}>
                  {RAIL.map((item) => {
                    const to = href(item, w.id);
                    const current = active && activePath.startsWith(to);
                    return (
                      <A
                        key={item.key}
                        to={to}
                        aria-current={current ? 'page' : undefined}
                        className={cx('flex h-7 items-center gap-2.5 rounded-r4 pl-5 pr-2.5', current ? 'bg-bg-3 text-text-1' : 'text-text-3 hover:bg-bg-2')}
                      >
                        <span className={cx('size-1.5 rounded-r4', current ? 'bg-needs-you' : 'bg-line-3')} aria-hidden />
                        <span className="flex-1 text-meta">{item.label}</span>
                        {item.key === 'needs' && count > 0 ? <span className="ac-mono text-nano text-needs-you">{count}</span> : null}
                        {/* The number keys reach the active workspace only, so only it is hinted. */}
                        {active ? <span className="ac-mono text-nano text-text-4">{item.kbd}</span> : null}
                      </A>
                    );
                  })}
                </nav>
              ) : null}
              {active && projects.length > 0 ? (
                <div className="mt-2 flex flex-col gap-px" aria-label={`${w.name} projects`}>
                  {projects.map((p, i) => (
                    <A
                      key={p.id}
                      to="/w/$ws/board"
                      params={{ ws: w.id }}
                      search={{ project: p.id }}
                      className="flex h-7 items-center gap-2.5 rounded-r4 pl-5 pr-2.5 hover:bg-bg-2"
                    >
                      <span className="size-1.5 rounded-r4" style={{ background: `var(--status-${PROJECT_DOT[i % PROJECT_DOT.length] ?? 'done'})` }} aria-hidden />
                      <span className="ac-mono flex-1 truncate text-meta text-text-2">{p.slug}</span>
                    </A>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onNewWorkspace}
        className="mt-1.5 flex h-7 flex-none items-center gap-2.5 rounded-r4 px-2.5 text-left text-meta text-text-3 hover:bg-bg-2"
      >
        <PlusGlyph className="size-2" />
        <span>New workspace</span>
      </button>
    </div>
  );
}

interface HeaderProps {
  name: string;
  ticketPrefix: string;
  count: number;
  active: boolean;
  open: boolean;
  onToggle: () => void;
}

/**
 * The active workspace's header is not a button: there is no control that could collapse the group
 * the human is currently inside.
 */
function WorkspaceHeader({ name, ticketPrefix, count, active, open, onToggle }: HeaderProps): React.ReactElement {
  const badge = count > 0
    ? <span className="ac-mono text-nano text-needs-you" aria-label={`${count} waiting for you`}>{count}</span>
    : null;
  const label = (
    <>
      <span className={cx('flex-1 truncate text-meta', active ? 'font-semibold text-text-1' : 'text-text-2')}>{name}</span>
      {badge}
      <span className="ac-mono text-nano text-text-4">{ticketPrefix}</span>
    </>
  );

  if (active) {
    return (
      <div className="flex h-7 items-center gap-2 rounded-r4 px-2.5">
        <span className="size-2 flex-none rounded-r4 bg-accent" aria-hidden />
        {label}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex h-7 items-center gap-2 rounded-r4 px-2.5 text-left text-text-nav hover:bg-bg-2"
    >
      <Chevron open={open} />
      {label}
    </button>
  );
}
