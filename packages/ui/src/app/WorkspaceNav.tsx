import { A } from './link';
import { GLOBAL_NAV, RAIL, href } from './nav';
import { PlusGlyph } from './PlusGlyph';
import { Skeleton } from '../components/Skeleton';
import type { WorkspaceListItem } from '../api/types';
import type { WorkspaceProjectsState } from '../api/hooks';
import { cx } from '../lib/cx';
import { projectColorVar } from '../lib/projectColor';

export interface WorkspaceNavProps {
  workspaces: WorkspaceListItem[];
  /** The workspace the app is showing, in the daemon's canonical id — empty on a global page. */
  activeWs: string;
  activePath: string;
  expanded: readonly string[];
  onToggle: (key: string) => void;
  /**
   * The active workspace's live Needs-you count. The listed `needsYou` is up to a refetch interval
   * old, so where the two disagree for the workspace being shown, this one is the truth.
   */
  needsCount: number;
  /**
   * Each open group's own projects (VS-128) — keyed by workspace id, present for the active
   * workspace and every expanded one; absent for a workspace whose group has never been opened, since
   * nothing has fetched it. Each project opens its own overview (VS-95); the board's project filter
   * is one click on from it.
   */
  projectsByWs: Record<string, WorkspaceProjectsState>;
  onNewWorkspace: () => void;
}

/**
 * A project's sync marker (VS-131), read from `Project.syncState` — data the sidebar already
 * fetched, never a check made for the marker itself. `in_sync` shows nothing, so a fine project
 * never becomes permanent furniture; `diverged` gets the same severity the rail uses for something
 * that needs a human, `behind` the calmer weight already used for ordinary work in flight.
 */
const SYNC_DOT: Record<string, string | undefined> = { diverged: 'blocked', behind: 'working' };

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
  workspaces, activeWs, activePath, expanded, onToggle, needsCount, projectsByWs, onNewWorkspace,
}: WorkspaceNavProps): React.ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="mb-3 flex flex-col gap-px" aria-label="Global">
        {GLOBAL_NAV.map((item) => {
          const current = activePath === item.to || activePath.startsWith(`${item.to}/`);
          return (
            <A
              key={item.key}
              to={item.to}
              aria-current={current ? 'page' : undefined}
              className={cx('flex h-7 items-center rounded-r4 pl-6.5 pr-2.5', current ? 'bg-bg-3 text-text-1' : 'text-text-3 hover:bg-bg-2')}
            >
              <span className="flex-1 text-meta">{item.label}</span>
            </A>
          );
        })}
      </nav>
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
                        className={cx('flex h-7 items-center gap-2.5 rounded-r4 pl-9 pr-2.5', current ? 'bg-bg-3 text-text-1' : 'text-text-3 hover:bg-bg-2')}
                      >
                        <span className="flex-1 text-meta">{item.label}</span>
                        {item.key === 'needs' && count > 0 ? <span className="ac-mono text-nano text-needs-you">{count}</span> : null}
                        {/* The number keys reach the active workspace only, so only it is hinted. */}
                        {active ? <span className="ac-mono text-nano text-text-4">{item.kbd}</span> : null}
                      </A>
                    );
                  })}
                </nav>
              ) : null}
              {open ? <ProjectsGroup wsId={w.id} wsName={w.name} state={projectsByWs[w.id]} /> : null}
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

/**
 * An open group's own project list: loading, failed and ready-with-projects each render their own
 * row so loading is never mistaken for empty (VS-128). New project is always last, including when
 * the workspace has no projects yet (VS-158) — returning null here would hide it.
 */
function ProjectsGroup({ wsId, wsName, state }: { wsId: string; wsName: string; state: WorkspaceProjectsState | undefined }): React.ReactElement {
  const siblingIds = (state?.projects ?? []).map((p) => p.id);
  return (
    <div className="mt-2 flex flex-col gap-px" aria-label={`${wsName} projects`}>
      {state?.status === 'pending' ? (
        <div className="flex h-7 items-center gap-2.5 pl-5 pr-2.5" role="status" aria-label="Loading">
          <Skeleton className="h-2 w-16" />
        </div>
      ) : state?.status === 'error' ? (
        <div className="flex h-7 items-center gap-2.5 rounded-r4 pl-5 pr-2.5 text-micro text-failed" role="alert">
          Couldn&rsquo;t load projects
        </div>
      ) : (
        (state?.projects ?? []).filter((p) => p.status !== 'archived').map((p) => {
          const dot = SYNC_DOT[p.syncState];
          return (
            <A
              key={p.id}
              to="/w/$ws/p/$project"
              params={{ ws: wsId, project: p.slug }}
              className="flex h-7 items-center gap-2.5 rounded-r4 pl-5 pr-2.5 hover:bg-bg-2"
            >
              {dot ? <span className="size-1.5 rounded-r4" style={{ background: `var(--status-${dot})` }} aria-hidden /> : <span className="size-1.5" aria-hidden />}
              <span className="ac-mono flex-1 truncate text-meta" style={{ color: projectColorVar(p.id, siblingIds) }} data-project-color>{p.slug}</span>
            </A>
          );
        })
      )}
      <A
        to="/w/$ws/settings"
        params={{ ws: wsId }}
        search={{ section: 'projects' }}
        className="flex h-7 items-center gap-2.5 rounded-r4 pl-5 pr-2.5 text-meta text-text-3 hover:bg-bg-2"
      >
        <PlusGlyph className="size-2" />
        <span>New project</span>
      </A>
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
