import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { A, useGo } from './link';
import { TICKET_STATUSES, ticketUiStatus } from '@agent-conductor/shared';
import { RAIL, TABS, href } from './nav';
import { NavGlyph } from './NavGlyph';
import { StartWorkSheet } from './StartWorkSheet';
import { CommandPalette } from '../components/CommandPalette';
import type { Command } from '../components/CommandPalette';
import { ConnectionBanner, UnreachableScreen } from '../components/ConnectionBanner';
import { useConnection, useWorkspaceEvents, useWs } from '../api/context';
import { useDecisions, useProjects, useTickets, useTransitionTicket, useWorkspaceSummary, useWorkspaces } from '../api/hooks';
import { useToast } from '../components/Toast';
import { useHotkeys } from '../lib/hotkeys';
import { flushQueue, useQueueCount } from '../lib/queue';
import type { QueuedWrite } from '../lib/queue';
import { api, ApiError, NetworkError, setWorkspaceId } from '../api/client';
import { cx } from '../lib/cx';

function PlusGlyph({ className }: { className?: string }): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      <path d="M7.2 0h1.6v7.2H16v1.6H8.8V16H7.2V8.8H0V7.2h7.2z" fill="currentColor" />
    </svg>
  );
}

export function AppShell(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const conn = useConnection();
  const toast = useToast();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [scopeIndex, setScopeIndex] = useState(-1);
  const [wsMenuOpen, setWsMenuOpen] = useState(false);

  const summary = useWorkspaceSummary();
  const decisions = useDecisions({ status: 'open', owner: 'human' });
  const projects = useProjects();
  const tickets = useTickets({ limit: 100 });
  const workspaces = useWorkspaces();
  const transition = useTransitionTicket();
  const queuedCount = useQueueCount();

  const needsCount = decisions.data?.length ?? 0;

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
    cmds.push({ id: 'create', label: 'Create ticket', sub: scope ? `in ${scope}` : 'in the conductor thread', kbd: 'C', run: () => setStartOpen(true) });
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
      if (w.slug === ws || w.id === ws) continue;
      cmds.push({ id: `ws-${w.id}`, label: 'Switch workspace', sub: w.name, kbd: '⌘⇧O', run: () => go('/w/$ws/needs', { params: { ws: w.slug || w.id } }) });
    }
    for (const item of RAIL) {
      cmds.push({ id: `go-${item.key}`, label: `Go to ${item.label}`, kbd: item.kbd, run: () => go(href(item, ws)) });
    }
    return cmds;
  }, [tickets.data, workspaces.data, scope, ws, go, transition]);

  useHotkeys(
    [
      { key: 'k', meta: true, inFields: true, run: () => setPaletteOpen((v) => !v) },
      { key: 'Space', meta: true, shift: true, inFields: true, run: () => setStartOpen(true) },
      ...RAIL.map((item) => ({ key: item.kbd, run: () => go(href(item, ws)) })),
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
    <div className="flex h-dvh overflow-hidden bg-bg-0">
      {/* desktop rail — the only place all projects appear at once */}
      <aside className="hidden w-rail flex-none flex-col border-r border-line-1 bg-bg-input p-2.5 md:flex">
        <div className="relative mb-3.5">
          <button
            type="button"
            onClick={() => setWsMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={wsMenuOpen}
            className="flex w-full items-center gap-2.5 rounded-r6 px-2 py-1.5 text-left hover:bg-bg-2"
          >
            <span className="flex size-5 items-center justify-center rounded-r4 bg-accent">
              <NavGlyph glyph="needs-you" active className="size-2.5" />
            </span>
            <span className="flex-1 truncate text-ui font-semibold text-text-1">{summary.data?.workspace?.name ?? ws}</span>
            <span className="ac-mono text-nano text-text-nav">⌄</span>
          </button>
          {wsMenuOpen ? (
            <div role="menu" className="ac-card absolute left-0 right-0 top-full z-20 mt-1 flex flex-col p-1 shadow-lg" onMouseLeave={() => setWsMenuOpen(false)}>
              {(workspaces.data ?? []).map((w) => {
                const key = w.slug || w.id;
                const active = key === ws || w.id === ws;
                return (
                  <button
                    key={w.id}
                    type="button"
                    role="menuitem"
                    onClick={() => { setWsMenuOpen(false); setWorkspaceId(key); go('/w/$ws/needs', { params: { ws: key } }); }}
                    className={cx('flex items-center gap-2 rounded-r4 px-2 py-1.5 text-left text-meta hover:bg-bg-2', active ? 'text-text-1' : 'text-text-2')}
                  >
                    <span className="flex-1 truncate">{w.name}</span>
                    <span className="ac-mono text-nano text-text-3">{w.ticketPrefix}</span>
                  </button>
                );
              })}
              <div className="my-1 h-px bg-line-1" />
              <button type="button" role="menuitem" onClick={() => { setWsMenuOpen(false); go('/onboarding'); }} className="flex items-center gap-2 rounded-r4 px-2 py-1.5 text-left text-meta text-text-2 hover:bg-bg-2">
                <PlusGlyph className="size-2" />
                <span>New workspace</span>
              </button>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setStartOpen(true)}
          className="mb-3.5 flex h-8 items-center gap-2 rounded-r6 bg-accent px-2.5 text-accent-on transition-colors duration-(--dur-fast) ease-ac hover:bg-accent-hover"
        >
          <PlusGlyph className="size-2.5" />
          <span className="flex-1 text-left text-meta font-medium">Start Work</span>
          <span className="ac-mono text-nano opacity-65">⌘⇧␣</span>
        </button>

        <nav className="flex flex-col gap-px" aria-label="Sections">
          {RAIL.map((item) => {
            const active = isActive(href(item, ws));
            return (
              <A
                key={item.key}
                to={href(item, ws)}
                className={cx('flex h-7 items-center gap-2.5 rounded-r4 px-2.5', active ? 'bg-bg-3 text-text-1' : 'text-text-3 hover:bg-bg-2')}
              >
                <span className={cx('size-1.5 rounded-r4', active ? 'bg-needs-you' : 'bg-line-3')} aria-hidden />
                <span className="flex-1 text-meta">{item.label}</span>
                {item.key === 'needs' && needsCount > 0 ? <span className="ac-mono text-nano text-needs-you">{needsCount}</span> : null}
                <span className="ac-mono text-nano text-text-4">{item.kbd}</span>
              </A>
            );
          })}
        </nav>

        <div className="ac-label mt-5 mb-2 px-2.5">Projects</div>
        <div className="flex flex-col gap-px">
          {(projects.data ?? []).map((p, i) => (
            <A
              key={p.id}
              to="/w/$ws/board"
              params={{ ws }}
              search={{ project: p.id }}
              className="flex h-7 items-center gap-2.5 rounded-r4 px-2.5 hover:bg-bg-2"
            >
              <span className="size-1.5 rounded-r4" style={{ background: `var(--status-${(['needs-you', 'done', 'working', 'merging', 'blocked'] as const)[i % 5]})` }} aria-hidden />
              <span className="ac-mono flex-1 truncate text-meta text-text-2">{p.slug}</span>
            </A>
          ))}
        </div>

        <div className="flex-1" />
        <button type="button" onClick={() => setPaletteOpen(true)} className="flex items-center gap-2 border-t border-line-1 px-2.5 py-2.5 text-left">
          <span className="ac-mono text-micro text-text-nav">⌘K</span>
          <span className="text-micro text-text-nav">everything</span>
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <ConnectionBanner state={conn.state} capturedAt={conn.capturedAt} queuedCount={queuedCount} />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden pb-bar md:pb-0">
          <Outlet />
        </main>

        {/* phone bottom bar: five tabs plus a floating Start Work */}
        <nav
          aria-label="Sections"
          className="ac-safe-bottom fixed inset-x-0 bottom-0 z-30 flex h-bar items-start border-t border-line-1 bg-bg-input px-1.5 pt-3 md:hidden"
        >
          {TABS.map((item) => {
            const active = isActive(href(item, ws));
            return (
              <A key={item.key} to={href(item, ws)} className="relative flex flex-1 flex-col items-center gap-1.5">
                <NavGlyph glyph={item.glyph} active={active} />
                <span className={cx('text-nano font-medium', active ? 'text-text-1' : 'text-text-nav')}>{item.label}</span>
                {item.key === 'needs' && needsCount > 0 ? (
                  <span className="ac-mono absolute -top-1 right-1/4 rounded-pill bg-needs-you px-1 text-nano text-bg-0">{needsCount}</span>
                ) : null}
              </A>
            );
          })}
          <button
            type="button"
            aria-label="Start work"
            onClick={() => setStartOpen(true)}
            className="absolute left-1/2 top-[-1.625rem] flex size-13 -translate-x-1/2 items-center justify-center rounded-pill border-[3px] border-bg-0 bg-accent text-accent-on shadow-float"
          >
            <PlusGlyph className="size-4" />
          </button>
        </nav>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
        scope={scope}
        onScopeCycle={() => setScopeIndex((i) => (i + 1 >= (projects.data?.length ?? 0) ? -1 : i + 1))}
      />
      <StartWorkSheet open={startOpen} onClose={() => setStartOpen(false)} />
    </div>
  );
}
