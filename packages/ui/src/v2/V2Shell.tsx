/**
 * The V2 shell: the 194px rail (or the 48px collapsed rail), the phone tab bar, and the More list
 * that reaches the destinations the rail and tabs leave out. All rows come from `nav.ts`, so the
 * highlighted row and the header cannot disagree (HANDOFF §4, §15).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { projectLabel, type Project, type Role } from '@weave-ai/shared';
import { A } from '../app/link';
import { cx } from '../lib/cx';
import { projectColorVar } from '../lib/projectColor';
import { FanInStreams } from '../api/context';
import { useDaemonUpdate, useDaemonUpgrade, useMe, useRolesMany, useWorkersMany, useWorkspacePlugins, useWorkspaceProjects, useWorkspaces, type WorkspaceProjectsState, type WorkerListItem } from '../api/hooks';
import { WeaveMark } from '../components/WeaveMark';
import type { WorkspaceListItem, WorkspacePlugin } from '../api/types';
import { V2Glyph } from './Glyph';
import { RoleChatRow, roleNavRows, workerFromRoleChatPath } from './roleChat';
import {
  activeNavKey,
  V2_EVERYWHERE,
  V2_KEPT,
  V2_RAIL_EVERYWHERE,
  V2_RAIL_WORKSPACE,
  V2_WORKSPACE,
  projectRowKey,
  v2Href,
  workspaceFromV2Path,
  type V2Dest,
  type V2Scope,
} from './nav';
import { useV2Counts, useV2WorkspaceName, type V2Counts } from './V2Page';
import { useDictationSession } from './DictationSession';
import { readRailCollapsed, writeRailCollapsed } from './prefs';
import { updateEntry, updateEntryLabel, type UpdateEntry } from '../lib/upgrade';
import type { V2Theme } from './theme';

/**
 * A loaded plugin as a `V2Dest` (VS-385), so `RailRow`/`CollapsedRow`/`MoreRow` render it unchanged
 * — it needs no rendering path of its own, the same way a plugin's V1 nav entry needed no
 * build-time array entry (VS-334's precedent).
 */
function pluginDest(p: WorkspacePlugin): V2Dest {
  return { key: `plugin:${p.id}`, label: p.name ?? p.id, glyph: 'plugin', scopeKind: 'workspace', path: `/w/$ws/plugins/${p.id}` };
}

/**
 * The top-level section of a V2 path (VS-427). The outlet is keyed by this for the route cross-fade:
 * a change of section replays the fade, while a param change inside one section (another chat thread,
 * run, ticket or plugin) keeps the outlet mounted so state and scroll are not thrown away.
 */
function routeSection(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'v2') return path;
  if (parts[1] === 'w') return parts[3] ?? 'workspace';
  return parts[1] ?? 'root';
}

function countOf(dest: V2Dest, scope: V2Scope, counts: V2Counts): number {
  // An Everywhere row carries the global figure; a workspace row its own workspace's. The row's
  // own `scope` names the workspace for the latter, so the global and workspace Needs rows never
  // have to agree (HANDOFF §15).
  if (dest.count === 'needs') {
    if (dest.scopeKind === 'workspace') return scope.kind === 'workspace' ? (counts.needsByWs[scope.ws] ?? 0) : 0;
    return counts.needsGlobal;
  }
  if (dest.count === 'live') {
    if (dest.scopeKind === 'workspace') return scope.kind === 'workspace' ? (counts.liveByWs[scope.ws] ?? 0) : 0;
    return counts.live;
  }
  if (dest.count === 'incidents') return counts.incidents;
  return 0;
}

function RailRow({
  dest,
  scope,
  fallbackWs,
  activeKey,
  counts,
  onNavigate,
}: {
  dest: V2Dest;
  scope: V2Scope;
  fallbackWs: string;
  activeKey: string | null;
  counts: V2Counts;
  onNavigate?: () => void;
}): React.ReactElement {
  const on = activeKey === dest.key;
  const count = countOf(dest, scope, counts);
  return (
    <A
      to={v2Href(dest, scope, fallbackWs)}
      aria-current={on ? 'page' : undefined}
      className="v2-row"
      onClick={onNavigate}
    >
      <V2Glyph name={dest.glyph} />
      <span className="min-w-0 flex-1 truncate">{dest.label}</span>
      {count > 0 ? (
        <span
          className={cx('ac-mono flex-none text-nano', dest.count === 'needs' ? 'text-needs-you' : 'text-text-3')}
          aria-label={`${count} waiting`}
        >
          {count}
        </span>
      ) : null}
    </A>
  );
}

function CollapsedRow({
  dest,
  scope,
  fallbackWs,
  activeKey,
  counts,
}: {
  dest: V2Dest;
  scope: V2Scope;
  fallbackWs: string;
  activeKey: string | null;
  counts: V2Counts;
}): React.ReactElement {
  const on = activeKey === dest.key;
  const showDot = dest.count === 'needs' && countOf(dest, scope, counts) > 0;
  return (
    <A
      to={v2Href(dest, scope, fallbackWs)}
      title={dest.label}
      aria-label={dest.label}
      aria-current={on ? 'page' : undefined}
      className={cx(
        'relative flex size-[30px] flex-none items-center justify-center rounded-r4',
        on ? 'bg-bg-3 text-text-1' : 'text-text-3 hover:bg-bg-2 hover:text-text-1',
      )}
    >
      <V2Glyph name={dest.glyph} />
      {showDot ? (
        <span className="absolute right-[3px] top-[3px] size-[5px] rounded-pill bg-needs-you" aria-hidden />
      ) : null}
    </A>
  );
}

/**
 * The daemon's release, as the rail says it (VS-421): the same `lib/upgrade` derivation and the same
 * content V1's sidebar uses — a state dot, a title, the target or stage, and "Open Updates" — so the
 * two shells cannot disagree about one fact. The block opens V2 Settings → Updates.
 */
function UpdateRailEntry({ update, onNavigate }: { update: UpdateEntry; onNavigate?: () => void }): React.ReactElement {
  return (
    <A
      to="/settings"
      search={{ section: 'updates' }}
      aria-label={updateEntryLabel(update)}
      onClick={onNavigate}
      className="flex flex-none flex-col gap-1 rounded-r6 border border-accent-edge bg-accent-tint px-2.5 py-2"
    >
      <span className="flex items-center gap-2">
        <span className={cx('size-1.5 flex-none rounded-pill', update.state === 'upgrading' ? 'bg-merging' : 'bg-needs-you')} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-meta font-medium text-text-1">{update.title}</span>
      </span>
      <span className="ac-mono truncate text-nano text-text-3">{update.detail}</span>
      <span className="text-micro font-medium text-accent-link">Open Updates</span>
    </A>
  );
}

/** The same fact on the 48px rail: the update mark and its state dot, with the entry's accessible name. */
function CollapsedUpdateEntry({ update }: { update: UpdateEntry }): React.ReactElement {
  return (
    <A
      to="/settings"
      search={{ section: 'updates' }}
      title={`${update.title} · ${update.detail}`}
      aria-label={updateEntryLabel(update)}
      className="relative flex size-[30px] flex-none items-center justify-center rounded-r4 text-text-3 hover:bg-bg-2 hover:text-text-1"
    >
      <V2Glyph name="update" />
      <span className={cx('absolute right-[3px] top-[3px] size-[5px] rounded-pill', update.state === 'upgrading' ? 'bg-merging' : 'bg-needs-you')} aria-hidden />
    </A>
  );
}

export function ThemeSwitch({
  theme,
  onTheme,
  variant,
}: {
  theme: V2Theme;
  onTheme: (t: V2Theme) => void;
  variant: 'expanded' | 'collapsed';
}): React.ReactElement {
  if (variant === 'collapsed') {
    const next: V2Theme = theme === 'dark' ? 'light' : 'dark';
    return (
      <button
        type="button"
        onClick={() => onTheme(next)}
        aria-label={`Switch to ${next} theme`}
        className="flex size-[30px] items-center justify-center rounded-r4 text-text-3 hover:bg-bg-2 hover:text-text-1"
      >
        <span
          className={cx('block size-3 rounded-pill bg-current', theme === 'dark' && 'shadow-[inset_4px_-4px_0_0_var(--bg-1)]')}
          aria-hidden
        />
      </button>
    );
  }
  return (
    <div className="flex flex-none gap-px rounded-r4 border border-line-1 bg-bg-2 p-px">
      <button
        type="button"
        onClick={() => onTheme('dark')}
        aria-label="Dark theme"
        aria-pressed={theme === 'dark'}
        className={cx(
          'flex size-[18px] items-center justify-center rounded-[3px]',
          theme === 'dark' ? 'bg-bg-0 text-text-1' : 'text-text-3',
        )}
      >
        <span className="block size-[10px] rounded-pill bg-current shadow-[inset_3px_-3px_0_0_var(--bg-2)]" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onTheme('light')}
        aria-label="Light theme"
        aria-pressed={theme === 'light'}
        className={cx(
          'flex size-[18px] items-center justify-center rounded-[3px]',
          theme === 'light' ? 'bg-bg-0 text-text-1' : 'text-text-3',
        )}
      >
        <span className="block size-[10px] rounded-pill bg-current" aria-hidden />
      </button>
    </div>
  );
}

function RailFooter({
  theme,
  onTheme,
  username,
}: {
  theme: V2Theme;
  onTheme: (t: V2Theme) => void;
  username: string;
}): React.ReactElement {
  return (
    <div className="mt-auto flex flex-none items-center gap-2 p-2.5">
      <span className="ac-mono min-w-0 flex-1 truncate text-nano text-text-3">{username}</span>
      <ThemeSwitch theme={theme} onTheme={onTheme} variant="expanded" />
    </div>
  );
}

/**
 * A project's row and its secondary child rows (VS-478, VS-581): the **Roadmap** link, then one row
 * per role of that project, each opening that role's persistent chat. One component so the desktop
 * rail and the phone More list render the same rows. The project row is the highlighted row on
 * either its overview or its roadmap, because `activeNavKey` maps `p/<slug>` and `p/<slug>/roadmap`
 * to the same `project:<slug>` key.
 */
function ProjectRow({
  ws,
  project,
  siblingIds,
  roles,
  sessionByRole,
  activeRoleId,
  active,
  onNavigate,
  tall,
}: {
  ws: string;
  project: Project;
  siblingIds: string[];
  roles: readonly Role[];
  sessionByRole: Record<string, WorkerListItem>;
  activeRoleId: string | null;
  active: boolean;
  onNavigate?: () => void;
  tall?: boolean;
}): React.ReactElement {
  const base = `/w/${encodeURIComponent(ws)}/p/${encodeURIComponent(project.slug)}`;
  const row = cx('v2-row', tall && 'min-h-11');
  const { shown, hiddenCount } = roleNavRows(roles, { activeRoleId });
  return (
    <div className="flex flex-col">
      <A to={base} aria-current={active ? 'page' : undefined} className={row} onClick={onNavigate}>
        <span className="flex-1 truncate" style={{ color: projectColorVar(project.id, siblingIds) }} data-project-color>
          {projectLabel(project)}
        </span>
      </A>
      <A to={`${base}/roadmap`} className={cx(row, 'v2-row-child')} onClick={onNavigate}>
        <span className="flex-1 truncate">Roadmap</span>
      </A>
      {shown.map((role) => (
        <RoleChatRow
          key={role.id}
          role={role}
          session={sessionByRole[role.id] ?? null}
          ws={ws}
          onNavigate={onNavigate}
          tall={tall}
          current={role.id === activeRoleId}
        />
      ))}
      {hiddenCount > 0 ? (
        <A
          to={base}
          className={cx(row, 'v2-row-child')}
          onClick={onNavigate}
          title={`${hiddenCount} more role${hiddenCount === 1 ? '' : 's'}`}
        >
          <span className="flex-1 truncate">+{hiddenCount} more role{hiddenCount === 1 ? '' : 's'}</span>
        </A>
      ) : null}
    </div>
  );
}

function WorkspaceGroups({
  workspaces,
  scope,
  activeKey,
  counts,
  projectsByWs,
  pluginsByWs,
  rolesByProject,
  sessionByRole,
  activeRoleId,
  onNavigate,
}: {
  workspaces: WorkspaceListItem[];
  scope: V2Scope;
  activeKey: string | null;
  counts: V2Counts;
  projectsByWs: Record<string, WorkspaceProjectsState>;
  pluginsByWs: Record<string, WorkspacePlugin[]>;
  rolesByProject: Record<string, Role[]>;
  sessionByRole: Record<string, WorkerListItem>;
  activeRoleId: string | null;
  onNavigate?: () => void;
}): React.ReactElement {
  const [collapsedWs, setCollapsedWs] = useState<Record<string, boolean>>({});
  const activeWs = scope.kind === 'workspace' ? scope.ws : '';

  return (
    <div className="flex flex-col gap-1 px-2.5">
      {workspaces.map((w) => {
        const isActive = w.id === activeWs;
        const closed = !isActive && collapsedWs[w.id] === true;
        const wsScope: V2Scope = { kind: 'workspace', ws: w.id };
        const projects = projectsByWs[w.id]?.projects ?? [];
        const siblingIds = projects.map((p) => p.id);
        const wsNeed = counts.needsByWs[w.id] ?? w.needsYou;
        return (
          <div key={w.id} className="flex flex-col">
            <button
              type="button"
              onClick={() => setCollapsedWs((cur) => ({ ...cur, [w.id]: !closed }))}
              aria-expanded={!closed}
              className="flex items-center gap-2 rounded-r4 px-2 py-1 text-left hover:bg-bg-2"
            >
              <span
                className={cx(
                  'h-0 w-0 flex-none border-y-[3.5px] border-l-[4.5px] border-y-transparent border-l-text-3 transition-transform',
                  !closed && 'rotate-90',
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-ui font-semibold text-text-1">{w.name}</span>
              {wsNeed > 0 ? <span className="ac-mono flex-none text-nano text-needs-you">{wsNeed}</span> : null}
            </button>
            {!closed ? (
              <div className="v2-anim-fade flex flex-col">
                {V2_RAIL_WORKSPACE.map((d) => (
                  <RailRow
                    key={d.key}
                    dest={d}
                    scope={wsScope}
                    fallbackWs={w.id}
                    activeKey={isActive ? activeKey : null}
                    counts={counts}
                    onNavigate={onNavigate}
                  />
                ))}
                <div className="my-1 h-px bg-line-1" />
                {projects.map((p) => (
                  <ProjectRow
                    key={p.id}
                    ws={w.id}
                    project={p}
                    siblingIds={siblingIds}
                    roles={rolesByProject[p.id] ?? []}
                    sessionByRole={sessionByRole}
                    activeRoleId={activeRoleId}
                    active={isActive && activeKey === projectRowKey(p.slug)}
                    onNavigate={onNavigate}
                  />
                ))}
                {(pluginsByWs[w.id] ?? []).map((p) => (
                  <RailRow
                    key={p.id}
                    dest={pluginDest(p)}
                    scope={wsScope}
                    fallbackWs={w.id}
                    activeKey={isActive ? activeKey : null}
                    counts={counts}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function MoreList({
  scope,
  fallbackWs,
  activeKey,
  counts,
  workspaces,
  projects,
  plugins,
  rolesByProject,
  sessionByRole,
  activeRoleId,
  update,
  theme,
  onTheme,
  onNavigate,
}: {
  scope: V2Scope;
  fallbackWs: string;
  activeKey: string | null;
  counts: V2Counts;
  workspaces: WorkspaceListItem[];
  projects: Project[];
  plugins: WorkspacePlugin[];
  rolesByProject: Record<string, Role[]>;
  sessionByRole: Record<string, WorkerListItem>;
  activeRoleId: string | null;
  update: UpdateEntry | null;
  theme: V2Theme;
  onTheme: (t: V2Theme) => void;
  onNavigate: () => void;
}): React.ReactElement {
  const wsScope: V2Scope = scope.kind === 'workspace' ? scope : { kind: 'workspace', ws: fallbackWs };
  const projectWs = wsScope.kind === 'workspace' ? wsScope.ws : fallbackWs;
  const siblingIds = projects.map((p) => p.id);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        {update ? <UpdateRailEntry update={update} onNavigate={onNavigate} /> : null}
        <MoreGroup title="Everywhere">
          {[...V2_EVERYWHERE, ...V2_KEPT.filter((d) => d.scopeKind === 'everywhere')].map((d) => (
            <MoreRow key={d.key} dest={d} scope={scope} fallbackWs={fallbackWs} activeKey={activeKey} counts={counts} onNavigate={onNavigate} />
          ))}
        </MoreGroup>
        {/* The rail that switches workspace on desktop is hidden at phone width, so the More list is
            where another workspace is reached (VS-559). Every workspace, its open Needs-you count,
            the current one marked; tapping a row opens that workspace's Needs you. */}
        {workspaces.length > 0 ? (
          <MoreGroup title="Workspaces">
            {workspaces.map((w) => (
              <WorkspaceSwitchRow
                key={w.id}
                workspace={w}
                active={scope.kind === 'workspace' && scope.ws === w.id}
                count={counts.needsByWs[w.id] ?? w.needsYou}
                onNavigate={onNavigate}
              />
            ))}
          </MoreGroup>
        ) : null}
        <MoreGroup title={workspaces.find((w) => w.id === (scope.kind === 'workspace' ? scope.ws : ''))?.name ?? 'Workspace'}>
          {[...V2_WORKSPACE, ...V2_KEPT.filter((d) => d.scopeKind === 'workspace'), ...plugins.map(pluginDest)].map((d) => (
            <MoreRow key={d.key} dest={d} scope={wsScope} fallbackWs={fallbackWs} activeKey={activeKey} counts={counts} onNavigate={onNavigate} />
          ))}
        </MoreGroup>
        {/* The rail is hidden at phone width, so projects get their own group here (VS-478) — each with
            the same Roadmap child row the rail shows, so the page is reachable on a phone. */}
        {projects.length > 0 ? (
          <MoreGroup title="Projects">
            {projects.map((p) => (
              <ProjectRow
                key={p.id}
                ws={projectWs}
                project={p}
                siblingIds={siblingIds}
                roles={rolesByProject[p.id] ?? []}
                sessionByRole={sessionByRole}
                activeRoleId={activeRoleId}
                active={activeKey === projectRowKey(p.slug)}
                onNavigate={onNavigate}
                tall
              />
            ))}
          </MoreGroup>
        ) : null}
      </div>
      {/* The rail footer carries the in-app theme switch on desktop, but the rail is `md:`-only, so
          the More sheet carries the same switch on a phone (VS-490). It is the same component and the
          same `theme`/`onTheme`, so the two surfaces cannot disagree. It sits below the scroll region
          like the rail footer's `mt-auto` block, so it is visible without scrolling the groups. */}
      <div className="flex-none border-t border-line-1 p-3">
        <div className="flex h-12 items-center justify-between px-3">
          <span className="text-ui text-text-2">Theme</span>
          <ThemeSwitch theme={theme} onTheme={onTheme} variant="expanded" />
        </div>
      </div>
    </div>
  );
}

function MoreGroup({ title, children }: { title: string; children: ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-col">
      <div className="ac-label px-3 pb-1.5">{title}</div>
      {children}
    </div>
  );
}

/**
 * A workspace in the phone More list's **Workspaces** group (VS-559): the phone's way to change
 * workspace, since the rail that switches on desktop is `md:`-only. It carries the workspace's
 * initial, its name and its open Needs-you count, marks the workspace being shown, and opens that
 * workspace's Needs you screen. Two taps from any screen: More, then this row.
 */
function WorkspaceSwitchRow({
  workspace,
  active,
  count,
  onNavigate,
}: {
  workspace: WorkspaceListItem;
  active: boolean;
  count: number;
  onNavigate: () => void;
}): React.ReactElement {
  return (
    <A
      to={`/w/${encodeURIComponent(workspace.id)}/needs`}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className="flex h-12 items-center gap-3 rounded-r4 px-3 text-ui text-text-2 hover:bg-bg-2"
    >
      <span
        className="ac-mono flex size-5 flex-none items-center justify-center rounded-r4 bg-bg-2 text-nano text-text-3"
        aria-hidden
      >
        {workspace.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
      {count > 0 ? <span className="ac-mono flex-none text-nano text-needs-you">{count}</span> : null}
      {active ? <span className="flex-none text-micro font-medium text-accent-link">current</span> : null}
      <span className="flex-none text-text-4" aria-hidden>
        ›
      </span>
    </A>
  );
}

function MoreRow({
  dest,
  scope,
  fallbackWs,
  activeKey,
  counts,
  onNavigate,
}: {
  dest: V2Dest;
  scope: V2Scope;
  fallbackWs: string;
  activeKey: string | null;
  counts: V2Counts;
  onNavigate: () => void;
}): React.ReactElement {
  const count = countOf(dest, scope, counts);
  return (
    <A
      to={v2Href(dest, scope, fallbackWs)}
      aria-current={activeKey === dest.key ? 'page' : undefined}
      onClick={onNavigate}
      className="flex h-12 items-center gap-3 rounded-r4 px-3 text-ui text-text-2 hover:bg-bg-2"
    >
      <V2Glyph name={dest.glyph} />
      <span className="min-w-0 flex-1 truncate">{dest.label}</span>
      {count > 0 ? <span className="ac-mono flex-none text-nano text-text-3">{count}</span> : null}
      <span className="flex-none text-text-4" aria-hidden>
        ›
      </span>
    </A>
  );
}

export function V2Shell({ theme, onTheme }: { theme: V2Theme; onTheme: (t: V2Theme) => void }): React.ReactElement {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const ws = workspaceFromV2Path(path);
  const scope: V2Scope = ws ? { kind: 'workspace', ws } : { kind: 'everywhere' };
  const activeKey = activeNavKey(path);
  const workspaces = useWorkspaces();
  const list = workspaces.data ?? [];
  const fallbackWs = (ws ?? list[0]?.id) ?? '';
  // Every group is open by default, so every listed workspace's projects are needed — each group
  // renders only its own (VS-366). `useWorkspaceProjects` keeps a fetched result cached.
  const ids = useMemo(() => list.map((w) => w.id), [list]);
  const projectsByWs = useWorkspaceProjects(ids);
  const pluginsByWs = useWorkspacePlugins(ids);
  // VS-581: each listed workspace's roles and persistent-session agents, so a project row can offer
  // its roles' chats. Read per workspace like the project and plugin reads above; a role row under a
  // non-current workspace opens against that workspace, never the one being shown.
  const roleQueries = useRolesMany(ids);
  const sessionQueries = useWorkersMany(ids, { kind: 'session' });
  const rolesByProject: Record<string, Role[]> = {};
  const sessionByRole: Record<string, WorkerListItem> = {};
  const sessionById: Record<string, WorkerListItem> = {};
  list.forEach((_w, i) => {
    for (const role of roleQueries[i]?.data ?? []) (rolesByProject[role.projectId] ??= []).push(role);
    for (const session of sessionQueries[i]?.data ?? []) {
      sessionById[session.id] = session;
      if (session.roleId) sessionByRole[session.roleId] = session;
    }
  });
  const workerOnPath = workerFromRoleChatPath(path);
  const activeRoleId = workerOnPath ? (sessionById[workerOnPath]?.roleId ?? null) : null;
  const counts = useV2Counts(scope);
  const me = useMe();
  // The rail's update entry is one derivation of the daemon's release state, shared with V1 (VS-421).
  const daemonUpdate = useDaemonUpdate();
  const daemonUpgrade = useDaemonUpgrade();
  const update = updateEntry(daemonUpdate.data, daemonUpgrade.data?.upgrade ?? null);
  const username = me.data?.operator.username ? `${me.data.operator.username} · weave` : 'weave';
  const [collapsed, setCollapsed] = useState(readRailCollapsed);
  const [moreOpen, setMoreOpen] = useState(false);
  // The floating dictation bar is fixed, so the routed page reserves room for it (VS-450): content
  // scrolls clear of the bar instead of under it, on top of the phone tab bar's own clearance.
  const barVisible = useDictationSession()?.barVisible ?? false;

  const toggleCollapse = (): void => {
    setCollapsed((cur) => {
      const next = !cur;
      writeRailCollapsed(next);
      return next;
    });
  };
  const activeWsName = useV2WorkspaceName(scope);
  const initial = (ws ? activeWsName : (list[0]?.name ?? 'A')).slice(0, 1).toUpperCase();
  // A V2 global page has no `WorkspaceProvider`, so nothing updates its cross-workspace decisions
  // (a card created, answered, superseded or reviewed while it is open) until a stream is
  // subscribed. Workspace pages get theirs from `V2Workspace`, and Global Chats opens one per pane,
  // so neither fans in here (VS-369).
  const fanIn = !ws && !path.startsWith('/chats');

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* One fan-in mount only: a global V2 page has no `WorkspaceProvider`, so it holds no stream
          of its own — fan in one daemon-wide stream so decisions and the rail's counts update live
          (VS-366, VS-369, VS-509). `fanIn` also excludes Global Chats, whose panes open one each. */}
      {fanIn ? <FanInStreams ids={ids} /> : null}
      {collapsed ? (
        <aside className="v2-anim-fade hidden w-[48px] flex-none flex-col items-center border-r border-line-1 bg-bg-1 py-2 md:flex">
          <button
            type="button"
            onClick={toggleCollapse}
            aria-label="Expand the sidebar"
            className="mb-1.5 flex size-[30px] items-center justify-center rounded-r4 text-text-2 hover:bg-bg-2"
          >
            <WeaveMark className="h-2 w-[36px]" />
          </button>
          <div className="mb-1.5 h-px w-[22px] bg-line-1" />
          <div className="flex flex-1 flex-col items-center gap-0.5 overflow-y-auto">
            {update ? <CollapsedUpdateEntry update={update} /> : null}
            {V2_RAIL_EVERYWHERE.map((d) => (
              <CollapsedRow key={d.key} dest={d} scope={scope} fallbackWs={fallbackWs} activeKey={activeKey} counts={counts} />
            ))}
            <div className="my-1 h-px w-[22px] bg-line-2" />
            <span className="ac-mono py-1 text-nano font-medium tracking-[0.06em] text-text-3">{initial}</span>
            {V2_RAIL_WORKSPACE.map((d) => (
              <CollapsedRow
                key={d.key}
                dest={d}
                scope={ws ? scope : { kind: 'workspace', ws: fallbackWs }}
                fallbackWs={fallbackWs}
                activeKey={activeKey}
                counts={counts}
              />
            ))}
            {(pluginsByWs[fallbackWs] ?? []).map((p) => (
              <CollapsedRow
                key={p.id}
                dest={pluginDest(p)}
                scope={ws ? scope : { kind: 'workspace', ws: fallbackWs }}
                fallbackWs={fallbackWs}
                activeKey={activeKey}
                counts={counts}
              />
            ))}
          </div>
          <div className="pt-2">
            <ThemeSwitch theme={theme} onTheme={onTheme} variant="collapsed" />
          </div>
        </aside>
      ) : (
        <aside className="v2-anim-fade v2-rail-scroll hidden w-[194px] flex-none flex-col border-r border-line-1 bg-bg-1 md:flex">
          <div className="flex items-center gap-2 px-3 pb-2 pt-3">
            <WeaveMark className="h-[13px] w-[58px]" />
            <span className="text-ui font-semibold tracking-[-0.01em] text-text-strong">WeaveAI</span>
            <button
              type="button"
              onClick={toggleCollapse}
              aria-label="Collapse the sidebar"
              className="ml-auto flex size-[22px] items-center justify-center rounded-[3px] text-text-3 hover:bg-bg-2 hover:text-text-1"
            >
              <span className="block size-[11px] rounded-[2px] border-[1.5px] border-l-4 border-current" aria-hidden />
            </button>
          </div>
          {update ? (
            <div className="px-2.5 pb-1 pt-1.5">
              <UpdateRailEntry update={update} />
            </div>
          ) : null}
          <div className="flex flex-col gap-0.5 px-2.5">
            <div className="ac-label px-2 pb-1.5">Everywhere</div>
            {V2_RAIL_EVERYWHERE.map((d) => (
              <RailRow key={d.key} dest={d} scope={scope} fallbackWs={fallbackWs} activeKey={activeKey} counts={counts} />
            ))}
          </div>
          <div className="my-1.5 h-px bg-line-1" />
          <WorkspaceGroups
            workspaces={list}
            scope={scope}
            activeKey={activeKey}
            counts={counts}
            projectsByWs={projectsByWs}
            pluginsByWs={pluginsByWs}
            rolesByProject={rolesByProject}
            sessionByRole={sessionByRole}
            activeRoleId={activeRoleId}
          />
          <RailFooter theme={theme} onTheme={onTheme} username={username} />
        </aside>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          key={routeSection(path)}
          className={cx(
            'v2-anim-route flex min-h-0 flex-1 flex-col',
            barVisible ? 'pb-[8.5rem] md:pb-20' : 'pb-14 md:pb-0',
          )}
        >
          <Outlet />
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex h-14 items-stretch border-t border-line-1 bg-bg-1 pb-[env(safe-area-inset-bottom)] md:hidden">
        <PhoneTab dest={V2_WORKSPACE[0]!} scope={ws ? scope : { kind: 'workspace', ws: fallbackWs }} fallbackWs={fallbackWs} activeKey={activeKey} />
        <PhoneTab dest={V2_EVERYWHERE[0]!} scope={{ kind: 'everywhere' }} fallbackWs={fallbackWs} activeKey={activeKey} />
        <PhoneTab dest={V2_WORKSPACE[2]!} scope={ws ? scope : { kind: 'workspace', ws: fallbackWs }} fallbackWs={fallbackWs} activeKey={activeKey} />
        <PhoneTab dest={V2_EVERYWHERE[1]!} scope={{ kind: 'everywhere' }} fallbackWs={fallbackWs} activeKey={activeKey} />
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex min-w-[44px] flex-1 flex-col items-center justify-center gap-1 text-text-nav"
        >
          <V2Glyph name="more" />
          <span className="text-nano font-medium">More</span>
        </button>
      </nav>

      {moreOpen ? (
        <div
          className="v2-anim-fade fixed inset-0 z-30 flex flex-col md:items-center md:justify-center md:p-6"
          role="dialog"
          aria-label="More"
          style={{ background: 'var(--overlay)' }}
        >
          <button type="button" className="flex-1 md:hidden" aria-label="Close" onClick={() => setMoreOpen(false)} />
          <div className="v2-anim-sheet flex max-h-[75vh] flex-col overflow-hidden rounded-t-r8 border border-line-1 bg-bg-1 md:max-h-[80vh] md:w-[360px] md:rounded-r8 md:shadow-sheet">
            <MoreList
              scope={scope}
              fallbackWs={fallbackWs}
              activeKey={activeKey}
              counts={counts}
              workspaces={list}
              projects={projectsByWs[fallbackWs]?.projects ?? []}
              plugins={pluginsByWs[fallbackWs] ?? []}
              rolesByProject={rolesByProject}
              sessionByRole={sessionByRole}
              activeRoleId={activeRoleId}
              update={update}
              theme={theme}
              onTheme={onTheme}
              onNavigate={() => setMoreOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PhoneTab({
  dest,
  scope,
  fallbackWs,
  activeKey,
}: {
  dest: V2Dest;
  scope: V2Scope;
  fallbackWs: string;
  activeKey: string | null;
}): React.ReactElement {
  const on = activeKey === dest.key;
  return (
    <A
      to={v2Href(dest, scope, fallbackWs)}
      aria-current={on ? 'page' : undefined}
      className={cx(
        'flex min-w-[44px] flex-1 flex-col items-center justify-center gap-1',
        on ? 'text-accent-link' : 'text-text-nav',
      )}
    >
      <V2Glyph name={dest.glyph} />
      <span className="text-nano font-medium">{dest.label}</span>
    </A>
  );
}
