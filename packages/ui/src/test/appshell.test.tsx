/** The rail's daemon-update indicator (PLAN §20). */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../api/types';

const state = vi.hoisted(() => ({ update: null as UpdateStatus | null, updateError: false }));

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useRouterState: () => '/w/ws1/chat',
}));
vi.mock('../app/link', () => ({
  A: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useGo: () => vi.fn(),
}));
vi.mock('../api/context', () => ({
  useWs: () => 'ws1',
  useConnection: () => ({ state: 'connected', capturedAt: null, lastSeq: 0, attempts: 0 }),
  useWorkspaceEvents: () => undefined,
}));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(), dismiss: vi.fn() }) }));
// Children with their own data hooks; none of them is what this file is about.
vi.mock('../app/StartWorkSheet', () => ({ StartWorkSheet: () => null }));
vi.mock('../components/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../app/BottomBar', () => ({ BottomBar: () => null }));
vi.mock('../lib/queue', () => ({ flushQueue: vi.fn(), useQueueCount: () => 0 }));
vi.mock('../lib/hotkeys', () => ({ useHotkeys: () => undefined }));
vi.mock('../api/hooks', () => ({
  useDaemonUpdate: () => ({ data: state.update ?? undefined, isError: state.updateError }),
  useDecisions: () => ({ data: [] }),
  useProjects: () => ({ data: [] }),
  useTickets: () => ({ data: [] }),
  useTransitionTicket: () => ({ mutate: vi.fn() }),
  useWorkspaceSummary: () => ({ data: { workspace: { id: 'ws1', name: 'Acme', ticketPrefix: 'ACME' } }, isError: false, error: null, refetch: vi.fn() }),
  useWorkspaces: () => ({ data: [] }),
}));

const { AppShell } = await import('../app/AppShell');

const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  configured: true,
  running: { version: '1.0.0', path: '/rel/a', sha: 'a'.repeat(40) },
  source: '/src', ref: 'main', targetSha: 'b'.repeat(40),
  updateAvailable: true, checkedAt: '2026-09-05T10:00:00.000Z', error: null, ...over,
});

const indicator = (): HTMLElement | null => screen.queryByLabelText('Daemon update available');

beforeEach(() => { state.update = null; state.updateError = false; });

describe('the rail update indicator', () => {
  it('is shown when the daemon reports an update', () => {
    state.update = status();
    render(<AppShell />);
    expect(indicator()).toBeInTheDocument();
  });

  it('is not shown when the daemon is up to date', () => {
    state.update = status({ updateAvailable: false });
    render(<AppShell />);
    expect(indicator()).not.toBeInTheDocument();
  });

  it('is not shown, and nothing is reported, when checking is not configured', () => {
    state.update = status({ configured: false, source: null, ref: null, targetSha: null, updateAvailable: false, checkedAt: null });
    render(<AppShell />);
    expect(indicator()).not.toBeInTheDocument();
    expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();
  });

  it('is not shown when the check itself failed', () => {
    state.update = status({ error: 'Could not resolve hostname' });
    render(<AppShell />);
    expect(indicator()).not.toBeInTheDocument();
  });

  it('is not shown before the first check has answered', () => {
    render(<AppShell />);
    expect(indicator()).not.toBeInTheDocument();
  });
});
