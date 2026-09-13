/**
 * The V2 shell: the 194px rail (or the 48px collapsed rail), the phone tab bar, and the More list
 * that reaches the destinations the rail and tabs leave out. All rows come from `nav.ts`, so the
 * highlighted row and the header cannot disagree (HANDOFF §4, §15).
 */
import { useState, type ReactNode } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { projectLabel } from '@weave-ai/shared';
import { A } from '../app/link';
import { cx } from '../lib/cx';
import { projectColorVar } from '../lib/projectColor';
import { useMe, useWorkspaceProjects, useWorkspaces } from '../api/hooks';
import { WeaveMark } from '../components/WeaveMark';
import type { Project, WorkspaceListItem } from '../api/types';
import { V2Glyph } from './Glyph';
import {
  activeNavKey,
  V2_EVERYWHERE,
  V2_KEPT,
  V2_WORKSPACE,
  projectRowKey,
  v2Href,
  workspaceFromV2Path,
  type V2Dest,
  type V2Scope,
} from './nav';
import { useV2Counts, useV2WorkspaceName, type V2Counts } from './V2Page';
import { readRailCollapsed, writeRailCollapsed } from './prefs';
import type { V2Theme } from './theme';

function countOf(dest: V2Dest, counts: V2Counts): number {
  if (dest.count === 'needs') return counts.needs;
  if (dest.count === 'live') return counts.live;
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
  const count = countOf(dest, counts);
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
  const showDot = dest.count === 'needs' && counts.needs > 0;
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
  projects,
  onNavigate,
}: {
  workspaces: WorkspaceListItem[];
  scope: V2Scope;
  activeKey: string | null;
  counts: V2Counts;
  projects: Project[];
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
        const siblingIds = projects.map((p) => p.id);
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
              {w.needsYou > 0 ? <span className="ac-mono flex-none text-nano text-needs-you">{w.needsYou}</span> : null}
            </button>
            {!closed ? (
              <div className="flex flex-col">
                {V2_WORKSPACE.map((d) => (
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
                  const key = projectRowKey(p.name);
                  const href = `/v2/w/${encodeURIComponent(w.id)}/p/${encodeURIComponent(p.name)}`;
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
  onNavigate,
}: {
  scope: V2Scope;
  fallbackWs: string;
  activeKey: string | null;
  counts: V2Counts;
  workspaces: WorkspaceListItem[];
  onNavigate: () => void;
}): React.ReactElement {
  const wsScope: V2Scope = scope.kind === 'workspace' ? scope : { kind: 'workspace', ws: fallbackWs };
  return (
    <div className="flex flex-col gap-4">
      <MoreGroup title="Everywhere">
        {[...V2_EVERYWHERE, ...V2_KEPT.filter((d) => d.scopeKind === 'everywhere')].map((d) => (
          <MoreRow key={d.key} dest={d} scope={scope} fallbackWs={fallbackWs} activeKey={activeKey} counts={counts} onNavigate={onNavigate} />
        ))}
      </MoreGroup>
      <MoreGroup title={workspaces.find((w) => w.id === (scope.kind === 'workspace' ? scope.ws : ''))?.name ?? 'Workspace'}>
        {[...V2_WORKSPACE, ...V2_KEPT.filter((d) => d.scopeKind === 'workspace')].map((d) => (
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
  const count = countOf(dest, counts);
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
  const projectsByWs = useWorkspaceProjects(ws ? [ws] : []);
  const projects = ws ? (projectsByWs[ws]?.projects ?? []) : [];
  const counts = useV2Counts(scope);
  const me = useMe();
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

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {collapsed ? (
        <aside className="hidden w-[48px] flex-none flex-col items-center border-r border-line-1 bg-bg-1 py-2 md:flex">
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
            {V2_EVERYWHERE.map((d) => (
              <CollapsedRow key={d.key} dest={d} scope={scope} fallbackWs={fallbackWs} activeKey={activeKey} counts={counts} />
            ))}
            <div className="my-1 h-px w-[22px] bg-line-2" />
            <span className="ac-mono py-1 text-[9.5px] font-medium tracking-[0.06em] text-text-3">{initial}</span>
            {V2_WORKSPACE.map((d) => (
              <CollapsedRow
                key={d.key}
                dest={d}
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
        <aside className="v2-rail-scroll hidden w-[194px] flex-none flex-col border-r border-line-1 bg-bg-1 md:flex">
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
          <div className="flex flex-col gap-0.5 px-2.5">
            <div className="ac-label px-2 pb-1.5">Everywhere</div>
            {V2_EVERYWHERE.map((d) => (
              <RailRow key={d.key} dest={d} scope={scope} fallbackWs={fallbackWs} activeKey={activeKey} counts={counts} />
            ))}
          </div>
          <div className="my-1.5 h-px bg-line-1" />
          <WorkspaceGroups
            workspaces={list}
            scope={scope}
            activeKey={activeKey}
            counts={counts}
            projects={projects}
          />
          <div className="px-2.5 pb-2 pt-1">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="v2-row"
            >
              <span className="flex-1">More…</span>
            </button>
          </div>
          <RailFooter theme={theme} onTheme={onTheme} username={username} />
        </aside>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col pb-14 md:pb-0">
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
          <V2Glyph name="settings" />
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>

      {moreOpen ? (
        <div
          className="fixed inset-0 z-30 flex flex-col md:items-center md:justify-center md:p-6"
          role="dialog"
          aria-label="More"
          style={{ background: 'var(--overlay)' }}
        >
          <button type="button" className="flex-1 md:hidden" aria-label="Close" onClick={() => setMoreOpen(false)} />
          <div className="max-h-[75vh] overflow-y-auto rounded-t-r8 border border-line-1 bg-bg-1 p-3 md:max-h-[80vh] md:w-[360px] md:rounded-r8 md:shadow-sheet">
            <MoreList
              scope={scope}
              fallbackWs={fallbackWs}
              activeKey={activeKey}
              counts={counts}
              workspaces={list}
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
