/**
 * The V2 shell: the 194px rail (or the 48px collapsed rail), the phone tab bar, and the More list
 * that reaches the destinations the rail and tabs leave out. All rows come from `nav.ts`, so the
 * highlighted row and the header cannot disagree (HANDOFF §4, §15).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { projectLabel } from '@weave-ai/shared';
import { A } from '../app/link';
import { cx } from '../lib/cx';
import { projectColorVar } from '../lib/projectColor';
import { FanInStreams } from '../api/context';
import { useDaemonUpdate, useDaemonUpgrade, useMe, useWorkspacePlugins, useWorkspaceProjects, useWorkspaces, type WorkspaceProjectsState } from '../api/hooks';
import { WeaveMark } from '../components/WeaveMark';
import type { WorkspaceListItem, WorkspacePlugin } from '../api/types';
import { V2Glyph } from './Glyph';
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
      to="/v2/settings"
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
      to="/v2/settings"
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
      <A to="/" className="flex-none text-nano text-text-3 hover:text-text-1">
        V1
      </A>
      <ThemeSwitch theme={theme} onTheme={onTheme} variant="expanded" />
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
  onNavigate,
}: {
  workspaces: WorkspaceListItem[];
  scope: V2Scope;
  activeKey: string | null;
  counts: V2Counts;
  projectsByWs: Record<string, WorkspaceProjectsState>;
  pluginsByWs: Record<string, WorkspacePlugin[]>;
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
                {projects.map((p) => {
                  const key = projectRowKey(p.slug);
                  const href = `/v2/w/${encodeURIComponent(w.id)}/p/${encodeURIComponent(p.slug)}`;
                  return (
                    <A
                      key={p.id}
                      to={href}
                      aria-current={isActive && activeKey === key ? 'page' : undefined}
                      className="v2-row"
                      onClick={onNavigate}
                    >
                      <span className="flex-1 truncate" style={{ color: projectColorVar(p.id, siblingIds) }} data-project-color>
                        {projectLabel(p)}
                      </span>
                    </A>
                  );
                })}
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
  plugins,
  update,
  onNavigate,
}: {
  scope: V2Scope;
  fallbackWs: string;
  activeKey: string | null;
  counts: V2Counts;
  workspaces: WorkspaceListItem[];
  plugins: WorkspacePlugin[];
  update: UpdateEntry | null;
  onNavigate: () => void;
}): React.ReactElement {
  const wsScope: V2Scope = scope.kind === 'workspace' ? scope : { kind: 'workspace', ws: fallbackWs };
  return (
    <div className="flex flex-col gap-4">
      {update ? <UpdateRailEntry update={update} onNavigate={onNavigate} /> : null}
      <MoreGroup title="Everywhere">
        {[...V2_EVERYWHERE, ...V2_KEPT.filter((d) => d.scopeKind === 'everywhere')].map((d) => (
          <MoreRow key={d.key} dest={d} scope={scope} fallbackWs={fallbackWs} activeKey={activeKey} counts={counts} onNavigate={onNavigate} />
        ))}
      </MoreGroup>
      <MoreGroup title={workspaces.find((w) => w.id === (scope.kind === 'workspace' ? scope.ws : ''))?.name ?? 'Workspace'}>
        {[...V2_WORKSPACE, ...V2_KEPT.filter((d) => d.scopeKind === 'workspace'), ...plugins.map(pluginDest)].map((d) => (
          <MoreRow key={d.key} dest={d} scope={wsScope} fallbackWs={fallbackWs} activeKey={activeKey} counts={counts} onNavigate={onNavigate} />
        ))}
      </MoreGroup>
      <div className="border-t border-line-1 pt-3">
        <A to="/" onClick={onNavigate} className="flex h-12 items-center px-3 text-ui text-text-2 hover:bg-bg-2">
          Open V1
        </A>
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
  const counts = useV2Counts(scope);
  const me = useMe();
  // The rail's update entry is one derivation of the daemon's release state, shared with V1 (VS-421).
  const daemonUpdate = useDaemonUpdate();
  const daemonUpgrade = useDaemonUpgrade();
  const update = updateEntry(daemonUpdate.data, daemonUpgrade.data?.upgrade ?? null);
  const username = me.data?.operator.username ? `${me.data.operator.username} · weave` : 'weave';
  const [collapsed, setCollapsed] = useState(readRailCollapsed);
  const [moreOpen, setMoreOpen] = useState(false);

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
  const fanIn = !ws && !path.startsWith('/v2/chats');

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* One fan-in mount only: a global V2 page has no `WorkspaceProvider`, so it holds no stream
          of its own — fan in one per listed workspace so decisions and the rail's counts update live
          (VS-366, VS-369). `fanIn` also excludes Global Chats, whose panes open one each. */}
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
            <span className="ac-mono py-1 text-[9.5px] font-medium tracking-[0.06em] text-text-3">{initial}</span>
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
          />
          <RailFooter theme={theme} onTheme={onTheme} username={username} />
        </aside>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div key={routeSection(path)} className="v2-anim-route flex min-h-0 flex-1 flex-col pb-14 md:pb-0">
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
          <span className="text-[10px] font-medium">More</span>
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
          <div className="v2-anim-sheet max-h-[75vh] overflow-y-auto rounded-t-r8 border border-line-1 bg-bg-1 p-3 md:max-h-[80vh] md:w-[360px] md:rounded-r8 md:shadow-sheet">
            <MoreList
              scope={scope}
              fallbackWs={fallbackWs}
              activeKey={activeKey}
              counts={counts}
              workspaces={list}
              plugins={pluginsByWs[fallbackWs] ?? []}
              update={update}
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
      <span className="text-[10px] font-medium">{dest.label}</span>
    </A>
  );
}
