import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { A, useGo } from './link';
import { TICKET_STATUSES, ticketUiStatus } from '@agent-conductor/shared';
import { RAIL, TABS, href } from './nav';
import { WorkspaceNav } from './WorkspaceNav';
import { MoreSheet } from './MoreSheet';
import { BottomBar } from './BottomBar';
import { CommandPalette } from '../components/CommandPalette';
import type { Command } from '../components/CommandPalette';
import { ConnectionBanner, UnreachableScreen } from '../components/ConnectionBanner';
import { useConnection, useWorkspaceEvents, useWs } from '../api/context';
import { useDaemonUpdate, useDaemonUpgrade, useDecisions, useProjects, useTickets, useTransitionTicket, useWorkspaceSummary, useWorkspaces } from '../api/hooks';
import { useToast } from '../components/Toast';
import { useHotkeys } from '../lib/hotkeys';
import { flushQueue, useQueueCount } from '../lib/queue';
import { readExpanded, toggleExpanded } from '../lib/wsExpansion';
import { readBarHidden, writeBarHidden } from '../lib/barVisibility';
import { updateEntry, updateEntryLabel } from '../lib/upgrade';
import type { QueuedWrite } from '../lib/queue';
import type { WorkspaceListItem } from '../api/types';
import { api, ApiError, NetworkError } from '../api/client';
import { cx } from '../lib/cx';
import { workspaceYolo } from '../lib/yolo';

export function AppShell(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const conn = useConnection();
  const toast = useToast();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [scopeIndex, setScopeIndex] = useState(-1);
  /** Which workspace groups the rail has open, seeded from what this device remembered. */
  const [expanded, setExpanded] = useState<string[]>(() => readExpanded());
  /** Whether the phone tab bar is folded away to its handle, likewise remembered per device. */
  const [barHidden, setBarHidden] = useState<boolean>(readBarHidden);

  const summary = useWorkspaceSummary();
  const decisions = useDecisions({ status: 'open', owner: 'human' });
  const projects = useProjects();
  const tickets = useTickets({ limit: 100 });
  const workspaces = useWorkspaces();
  const daemonUpdate = useDaemonUpdate();
  const daemonUpgrade = useDaemonUpgrade();
  const transition = useTransitionTicket();
  const queuedCount = useQueueCount();

  const needsCount = decisions.data?.length ?? 0;
  /**
   * The daemon answers `/w/:ws` with the workspace's canonical id whichever form the URL used, so
   * this — not the raw route param — is what a listed workspace is compared against.
   */
  const activeWs = summary.data?.workspace.id ?? ws;
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
  useEffect(() => {
    if (conn.state !== 'connected' || queuedCount === 0) return;
    void flushQueue((q: QueuedWrite) => api.ws(ws, q.path, { method: 'POST', body: q.body })).then((r) => {
      if (r.sent) toast.push({ title: `${r.sent} queued ${r.sent === 1 ? 'message' : 'messages'} sent`, status: 'done', ttl: 4000 });
    });
  }, [conn.state, queuedCount, ws, toast]);
  const scope = scopeIndex >= 0 ? projects.data?.[scopeIndex]?.slug ?? null : null;

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
    if (data.some((w) => w.id === activeWs)) return data;
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

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];
    for (const t of tickets.data ?? []) {
      cmds.push({
        id: `open-${t.id}`,
        label: 'Open',
        sub: `${t.identifier} ${t.title}`,
        kbd: '⏎',
        status: ticketUiStatus(t.status),
        run: () => go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: t.identifier } }),
      });
    }
    // Everything is asked for in one place, so this goes where the board's empty state goes.
    cmds.push({ id: 'create', label: 'Create ticket', sub: scope ? `in ${scope}` : 'in the conductor chat', kbd: 'C', run: () => go('/w/$ws/chat', { params: { ws } }) });
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
    cmds.push({ id: 'filter', label: 'Filter board', sub: scope ? `project: ${scope}` : 'project · kind · priority', kbd: 'F', run: () => go('/w/$ws/board', { params: { ws } }) });
    for (const w of workspaces.data ?? []) {
      if (w.id === ws) continue;
      cmds.push({ id: `ws-${w.id}`, label: 'Switch workspace', sub: w.name, kbd: '⌘⇧O', run: () => go('/w/$ws/needs', { params: { ws: w.id } }) });
    }
    for (const item of RAIL) {
      cmds.push({ id: `go-${item.key}`, label: `Go to ${item.label}`, ...(item.kbd ? { kbd: item.kbd } : {}), run: () => go(href(item, ws)) });
    }
    return cmds;
  }, [tickets.data, workspaces.data, scope, ws, go, transition]);

  useHotkeys(
    [
      { key: 'k', meta: true, inFields: true, run: () => setPaletteOpen((v) => !v) },
      ...RAIL.flatMap((item) => (item.kbd ? [{ key: item.kbd, run: () => go(href(item, ws)) }] : [])),
    ],
    true,
  );

  // A remembered workspace that no longer exists (deleted, or a different daemon):
  // forget it and let `/` decide between the first workspace and onboarding.
  useEffect(() => {
    if (summary.isError && summary.error instanceof ApiError && summary.error.status === 404) {
      try { localStorage.removeItem('conductor.ws'); } catch { /* ignore */ }
      go('/', { replace: true });
    }
  }, [summary.isError, summary.error, go]);

  // NET_DAEMON_UNREACHABLE is full-screen at load only; mid-session it
  // degrades to the offline banner.
  if (summary.isError && summary.error instanceof NetworkError && !summary.data) {
    return <UnreachableScreen host={window.location.host} onRetry={() => void summary.refetch()} />;
  }

  const isActive = (to: string): boolean => path.startsWith(to);

  return (
    // `data-bar` is what the stylesheet reads to hand the bar's space back to the content above it.
    <div className="ac-app flex overflow-hidden bg-bg-0" data-bar={barHidden ? 'hidden' : 'shown'}>
      {/* desktop rail — the only place all projects appear at once */}
      <aside className="hidden w-rail flex-none flex-col border-r border-line-1 bg-bg-input p-2.5 md:flex">
        {/* Self-contained block at the top of the rail: it is about the daemon, not any one
            workspace, and it routes to the Updates section by key so a settings reshuffle cannot
            strand it. It replaces the dot the Settings entry used to carry — one fact, one entry. */}
        {update ? (
          <A
            to="/w/$ws/settings"
            params={{ ws }}
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
          projects={projects.data ?? []}
          onNewWorkspace={() => go('/onboarding')}
        />

        <button type="button" onClick={() => setPaletteOpen(true)} className="flex items-center gap-2 border-t border-line-1 px-2.5 py-2.5 text-left">
          <span className="ac-mono text-micro text-text-nav">⌘K</span>
          <span className="text-micro text-text-nav">everything</span>
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <ConnectionBanner state={conn.state} capturedAt={conn.capturedAt} queuedCount={queuedCount} />
        {workspaceYolo(summary.data?.config) ? (
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
          <Outlet />
        </main>

        <BottomBar
          ws={ws}
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
        onScopeCycle={() => setScopeIndex((i) => (i + 1 >= (projects.data?.length ?? 0) ? -1 : i + 1))}
      />
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        ws={ws}
        activeWs={activeWs}
        workspaces={listed}
        projects={projects.data ?? []}
        needsCount={needsCount}
        update={update}
        isActive={isActive}
        onNewWorkspace={() => go('/onboarding')}
      />
    </div>
  );
}
