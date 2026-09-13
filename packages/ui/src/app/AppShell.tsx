import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { A, useGo } from './link';
import { TICKET_STATUSES, ticketUiStatus } from '@weave-ai/shared';
import { RAIL, TABS, href } from './nav';
import { WorkspaceNav } from './WorkspaceNav';
import { MoreSheet } from './MoreSheet';
import { BottomBar } from './BottomBar';
import { CommandPalette } from '../components/CommandPalette';
import type { Command } from '../components/CommandPalette';
import { ConnectionBanner, UnreachableScreen } from '../components/ConnectionBanner';
import { FanInStreams, useConnection, useOptionalWorkspace, useWorkspaceEvents } from '../api/context';
import { useDaemonModels, useDaemonHostTools, useDaemonUpdate, useDaemonUpgrade, useDecisions, useTickets, useTransitionTicket, useWorkspaceProjects, useWorkspaceSummary, useWorkspaces } from '../api/hooks';
import { useToast } from '../components/Toast';
import { useHotkeys } from '../lib/hotkeys';
import { flushQueue, useQueueCount } from '../lib/queue';
import { readExpanded, toggleExpanded } from '../lib/wsExpansion';
import { readBarHidden, writeBarHidden } from '../lib/barVisibility';
import { updateEntry, updateEntryLabel } from '../lib/upgrade';
import type { QueuedWrite } from '../lib/queue';
import type { WorkspaceListItem } from '../api/types';
import { api, ApiError, getWorkspaceId, NetworkError } from '../api/client';
import { cx } from '../lib/cx';
import { workspaceYolo } from '../lib/yolo';

export function AppShell({ children }: { children?: ReactNode } = {}): React.ReactElement {
  const ctx = useOptionalWorkspace();
  const remembered = getWorkspaceId();
  const ws = ctx?.ws ?? remembered ?? '';
  const go = useGo();
  const conn = useConnection();
  const toast = useToast();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const onGlobalPage = path === '/needs' || path === '/live' || path === '/chats' || path === '/incidents' || path === '/map' || path === '/scheduled' || path === '/settings';
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [scopeIndex, setScopeIndex] = useState(-1);
  /** Which workspace groups the rail has open, seeded from what this device remembered. */
  const [expanded, setExpanded] = useState<string[]>(() => readExpanded());
  /** Whether the phone tab bar is folded away to its handle, likewise remembered per device. */
  const [barHidden, setBarHidden] = useState<boolean>(readBarHidden);

  const summary = useWorkspaceSummary();
  const decisions = useDecisions({ status: 'open', owner: 'human' });
  const tickets = useTickets({ limit: 100 });
  const workspaces = useWorkspaces();
  const daemonUpdate = useDaemonUpdate();
  const daemonUpgrade = useDaemonUpgrade();
  const transition = useTransitionTicket();
  const queuedCount = useQueueCount();

  const needsCount = onGlobalPage ? 0 : (decisions.data?.length ?? 0);
  /**
   * The daemon answers `/w/:ws` with the workspace's canonical id whichever form the URL used, so
   * this — not the raw route param — is what a listed workspace is compared against.
   * Empty on a global page: no workspace group is marked active.
   */
  const activeWs = onGlobalPage ? '' : (summary.data?.workspace.id ?? ctx?.ws ?? '');
  /**
   * The workspaces whose projects are needed: the active one, always, since its rail group is always
   * open, plus every group the human has expanded (VS-128). A workspace outside this set has never
   * had its projects fetched, and `useWorkspaceProjects` keeps a previously fetched one cached even
   * once its group collapses back out of this set.
   */
  const projectIds = useMemo(() => Array.from(new Set([...(activeWs ? [activeWs] : []), ...expanded])), [activeWs, expanded]);
  const projectsByWs = useWorkspaceProjects(projectIds);
  const activeProjects = projectsByWs[activeWs]?.projects ?? [];
  // Nothing is shown when the daemon is up to date, when checking is not configured, or when it failed.
  // One fact, one entry: the rail block on desktop, the More badge on a phone (PLAN §20).
  const update = updateEntry(daemonUpdate.data, daemonUpgrade.data?.upgrade ?? null);
  /**
   * What the other workspaces are waiting on. The tabs address the active workspace only, so on a
   * phone this count is reachable through the More menu alone — which is why More carries it.
   */
  const otherWorkspacesNeed = (workspaces.data ?? []).reduce((n, w) => (w.id === activeWs ? n : n + w.needsYou), 0);

  // Queued writes (offline, or taken while the conductor was mid-turn) are
  // flushed in order as soon as the stream is back.
  const workspaceIds = useMemo(() => (workspaces.data ?? []).map((w) => w.id), [workspaces.data]);

  useEffect(() => {
    if (!ws || conn.state !== 'connected' || queuedCount === 0) return;
    void flushQueue((q: QueuedWrite) => api.ws(ws, q.path, { method: 'POST', body: q.body })).then((r) => {
      if (r.sent) toast.push({ title: `${r.sent} queued ${r.sent === 1 ? 'message' : 'messages'} sent`, status: 'done', ttl: 4000 });
    });
  }, [conn.state, queuedCount, ws, toast]);
  const scope = scopeIndex >= 0 ? activeProjects[scopeIndex]?.slug ?? null : null;

  // Arrival: a toast plus the Needs-you badge is the primary notification path.
  useWorkspaceEvents(
    useCallback(
      (e) => {
        if (e.type === 'decision.created') {
          const p = e.payload as { title?: string; ticketIdentifier?: string } | null;
          toast.push({ title: p?.title ?? 'Something needs you', detail: p?.ticketIdentifier ?? undefined, status: 'needs-you', ttl: 8000 });
        }
        if (e.type === 'ticket.merged') {
          const p = e.payload as { identifier?: string; title?: string } | null;
          toast.push({ title: `${p?.identifier ?? 'A ticket'} landed`, detail: p?.title, status: 'done', ttl: 8000 });
        }
      },
      [toast],
    ),
  );

  /**
   * Until the workspace list answers, the rail still shows the workspace the route names: the
   * sections being displayed must not vanish while a request is in flight.
   */
  const listed = useMemo<WorkspaceListItem[]>(() => {
    const data = workspaces.data ?? [];
    if (!activeWs || data.some((w) => w.id === activeWs)) return data;
    return [
      {
        id: activeWs,
        name: summary.data?.workspace.name ?? activeWs,
        ticketPrefix: summary.data?.workspace.ticketPrefix ?? '',
        root: '', projects: [], needsYou: 0,
      },
      ...data,
    ];
  }, [workspaces.data, activeWs, summary.data]);

  const chromeWs = ws || listed[0]?.id || '';
  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];
    if (!chromeWs) return cmds;
    for (const t of tickets.data ?? []) {
      cmds.push({
        id: `open-${t.id}`,
        label: 'Open',
        sub: `${t.identifier} ${t.title}`,
        kbd: '⏎',
        status: ticketUiStatus(t.status),
        run: () => go('/w/$ws/tickets/$ticketId', { params: { ws: chromeWs, ticketId: t.identifier } }),
      });
    }
    // Everything is asked for in one place, so this goes where the board's empty state goes.
    cmds.push({ id: 'create', label: 'Create ticket', sub: scope ? `in ${scope}` : 'in the weave chat', kbd: 'C', run: () => go('/w/$ws/chat', { params: { ws: chromeWs } }) });
    const first = tickets.data?.[0];
    if (first) {
      for (const s of TICKET_STATUSES) {
        cmds.push({
          id: `status-${s}`,
          label: 'Set status',
          sub: `${first.identifier} → ${s}`,
          kbd: 'S',
          run: () => transition.mutate({ id: first.id, to: s }),
        });
      }
    }
    cmds.push({ id: 'filter', label: 'Filter board', sub: scope ? `project: ${scope}` : 'project · kind · priority', kbd: 'F', run: () => go('/w/$ws/board', { params: { ws: chromeWs } }) });
    for (const w of workspaces.data ?? []) {
      if (w.id === chromeWs) continue;
      cmds.push({ id: `ws-${w.id}`, label: 'Switch workspace', sub: w.name, kbd: '⌘⇧O', run: () => go('/w/$ws/needs', { params: { ws: w.id } }) });
    }
    for (const item of RAIL) {
      cmds.push({ id: `go-${item.key}`, label: `Go to ${item.label}`, ...(item.kbd ? { kbd: item.kbd } : {}), run: () => go(href(item, chromeWs)) });
    }
    return cmds;
  }, [tickets.data, workspaces.data, scope, chromeWs, go, transition]);

  useHotkeys(
    [
      { key: 'k', meta: true, inFields: true, run: () => setPaletteOpen((v) => !v) },
      ...RAIL.flatMap((item) => (item.kbd && chromeWs ? [{ key: item.kbd, run: () => go(href(item, chromeWs)) }] : [])),
    ],
    true,
  );

  // A remembered workspace that no longer exists (deleted, or a different daemon):
  // forget it and let `/` decide between the first workspace and onboarding.
  useEffect(() => {
    if (onGlobalPage) return;
    if (summary.isError && summary.error instanceof ApiError && summary.error.status === 404) {
      try { localStorage.removeItem('conductor.ws'); } catch { /* ignore */ }
      go('/', { replace: true });
    }
  }, [onGlobalPage, summary.isError, summary.error, go]);

  // NET_DAEMON_UNREACHABLE is full-screen at load only; mid-session it
  // degrades to the offline banner.
  if (!onGlobalPage && summary.isError && summary.error instanceof NetworkError && !summary.data) {
    return <UnreachableScreen host={window.location.host} onRetry={() => void summary.refetch()} />;
  }
  if (onGlobalPage && workspaces.isError && workspaces.error instanceof NetworkError && !workspaces.data) {
    return <UnreachableScreen host={window.location.host} onRetry={() => void workspaces.refetch()} />;
  }

  const isActive = (to: string): boolean => path.startsWith(to);

  return (
    // `data-bar` is what the stylesheet reads to hand the bar's space back to the content above it.
    <div className="ac-app flex overflow-hidden bg-bg-0" data-bar={barHidden ? 'hidden' : 'shown'}>
      {/* Chats manages its own per-pane subscriptions (one focused pane, VS-199) — fanning in
          every workspace here too would reopen the same one-connection-per-workspace growth
          this page's own fix removes. */}
      {onGlobalPage && path !== '/chats' ? <FanInStreams ids={workspaceIds} /> : null}
      {/* desktop rail — the only place all projects appear at once */}
      <aside className="hidden w-rail flex-none flex-col border-r border-line-1 bg-bg-input p-2.5 md:flex">
        {/* Self-contained block at the top of the rail: it is about the daemon, not any one
            workspace, and it routes to the Updates section by key on the daemon's settings page, so
            a settings reshuffle cannot strand it. It replaces the dot the Settings entry used to
            carry — one fact, one entry. */}
        {update ? (
          <A
            to="/settings"
            search={{ section: 'updates' }}
            aria-label={updateEntryLabel(update)}
            className="mb-3.5 flex flex-none flex-col gap-1 rounded-r6 border border-accent-edge bg-accent-tint px-2.5 py-2"
          >
            <span className="flex items-center gap-2">
              <span className={cx('size-1.5 flex-none rounded-pill', update.state === 'upgrading' ? 'bg-merging' : 'bg-needs-you')} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-meta font-medium text-text-1">{update.title}</span>
            </span>
            <span className="ac-mono truncate text-nano text-text-3">{update.detail}</span>
            <span className="text-micro font-medium text-accent-link">Open Updates</span>
          </A>
        ) : null}

        <WorkspaceNav
          workspaces={listed}
          activeWs={activeWs}
          activePath={path}
          expanded={expanded}
          onToggle={(key) => setExpanded((cur) => toggleExpanded(cur, key))}
          needsCount={needsCount}
          projectsByWs={projectsByWs}
          onNewWorkspace={() => go('/onboarding')}
        />

        <button type="button" onClick={() => setPaletteOpen(true)} className="flex items-center gap-2 border-t border-line-1 px-2.5 py-2.5 text-left">
          <span className="ac-mono text-micro text-text-nav">⌘K</span>
          <span className="text-micro text-text-nav">everything</span>
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <ConnectionBanner state={conn.state} capturedAt={conn.capturedAt} queuedCount={queuedCount} />
        <ModelsUnconfiguredBanner />
        <HostToolsUnavailableBanner />
        {!onGlobalPage && workspaceYolo(summary.data?.config) ? (
          <div
            role="status"
            aria-label="YOLO mode is on"
            className="flex items-center gap-2 border-b border-needs-you/30 bg-needs-you/10 px-3 py-1.5 md:px-4"
          >
            <span className="size-1.5 rounded-pill bg-needs-you" aria-hidden />
            <span className="text-micro font-medium text-needs-you">YOLO mode</span>
            <span className="text-micro text-text-3">plans and merges are approved for you</span>
          </div>
        ) : null}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden ac-bar-pad md:pb-0">
          {children ?? <Outlet />}
        </main>

        <BottomBar
          ws={chromeWs}
          items={TABS}
          needsCount={needsCount}
          update={update}
          otherWorkspacesNeed={otherWorkspacesNeed}
          isActive={isActive}
          onMore={() => setMoreOpen(true)}
          moreOpen={moreOpen}
          hidden={barHidden}
          onToggleHidden={(h) => {
            setBarHidden(h);
            writeBarHidden(h);
          }}
        />
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
        scope={scope}
        onScopeCycle={() => setScopeIndex((i) => (i + 1 >= activeProjects.length ? -1 : i + 1))}
      />
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        ws={chromeWs}
        activeWs={activeWs}
        workspaces={listed}
        projects={activeProjects}
        needsCount={needsCount}
        update={update}
        isActive={isActive}
        onNewWorkspace={() => go('/onboarding')}
      />
    </div>
  );
}

/**
 * VS-318: a required or recommended host tool the daemon cannot find is unmissable here, and the
 * link goes to the section that shows which one and where to add a directory.
 */
function HostToolsUnavailableBanner(): React.ReactElement | null {
  const hostTools = useDaemonHostTools();
  const missing = (hostTools.data?.tools ?? []).filter((t) => !t.available);
  if (missing.length === 0) return null;
  return (
    <div
      role="status"
      aria-label="Host tools are missing"
      className="flex h-banner items-center gap-2 bg-failed/10 px-4 text-micro text-failed"
    >
      <span className="size-1.5 rounded-pill bg-current" aria-hidden />
      <span>{`The daemon cannot find host tools it needs: ${missing.map((t) => t.id).join(', ')}. Check daemon Settings → Host tools.`}</span>
      <A to="/settings" search={{ section: 'host-tools' }} className="ml-auto font-medium">
        Open Host tools
      </A>
    </div>
  );
}

function ModelsUnconfiguredBanner(): React.ReactElement | null {
  const overlays = useDaemonModels();
  const unconfigured = (overlays.data?.workerOptions ?? []).some((o) => o.runtime == null);
  if (!unconfigured) return null;
  return (
    <div
      role="status"
      aria-label="Worker adapters are not chosen"
      className="flex h-banner items-center gap-2 bg-failed/10 px-4 text-micro text-failed"
    >
      <span className="size-1.5 rounded-pill bg-current" aria-hidden />
      <span>Worker adapters are not chosen yet. Finish them in daemon Settings → Models before running workers.</span>
      <A to="/settings" search={{ section: 'daemon-models' }} className="ml-auto font-medium">
        Open Models
      </A>
    </div>
  );
}
