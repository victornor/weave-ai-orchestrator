/** The Updates section in Settings and the rail's update indicator (PLAN §20). */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus, Upgrade, UpgradeState, WaitingRun } from '../api/types';
import { upgradePollInterval } from '../lib/upgrade';

const state = vi.hoisted(() => ({
  update: null as UpdateStatus | null,
  updateLoading: false,
  updateError: false,
  upgrade: null as Upgrade | null,
  waitingFor: [] as WaitingRun[],
  upgradeQueryError: false,
  requested: [] as unknown[],
  cancelled: 0,
  refreshed: 0,
  toasts: [] as Array<Record<string, unknown>>,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../app/link', () => ({ useGo: () => vi.fn() }));
vi.mock('../lib/theme', () => ({ useTheme: () => ['dark', vi.fn()] }));
vi.mock('../components/Toast', () => ({
  useToast: () => ({ push: (t: Record<string, unknown>) => { state.toasts.push(t); return 't1'; }, dismiss: vi.fn() }),
}));
vi.mock('../api/hooks', () => ({
  useDaemonUpdate: () => ({ data: state.update ?? undefined, isLoading: state.updateLoading, isError: state.updateError, refetch: vi.fn() }),
  useDaemonUpgrade: () => ({ data: { upgrade: state.upgrade, waitingFor: state.waitingFor }, isError: state.upgradeQueryError }),
  useRefreshDaemonUpdate: () => ({ mutate: () => { state.refreshed += 1; }, isPending: false }),
  // react-query's `mutate` takes per-call callbacks; the component relies on onSuccess for its toast.
  useRequestUpgrade: () => ({
    mutate: (body: unknown, opts?: { onSuccess?: (d: unknown) => void; onError?: (e: Error) => void }) => {
      state.requested.push(body);
      opts?.onSuccess?.({ id: 'u1' });
    },
    isPending: false,
  }),
  useCancelUpgrade: () => ({ mutate: () => { state.cancelled += 1; }, isPending: false }),
  useWorkspaceSummary: () => ({ data: undefined, isLoading: false }),
  useWorkspaces: () => ({ data: [] }),
  usePatchConfig: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { SettingsRoute } = await import('../routes/Settings');

const RUNNING = { version: '1.0.0', path: '/rel/20260101-120000-aaaaaaaaaa', sha: 'a'.repeat(40) };

const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  configured: true, running: RUNNING, source: '/src/agent-conductor', ref: 'main',
  targetSha: 'b'.repeat(40), updateAvailable: true, checkedAt: '2026-09-05T10:00:00.000Z', error: null, ...over,
});

const record = (over: Partial<Upgrade> = {}): Upgrade => ({
  id: 'u1', state: 'queued', source: '/src/agent-conductor', ref: 'main', targetSha: 'b'.repeat(40),
  fromRelease: RUNNING.path, toRelease: null, toSha: null, requestedBy: 'op1',
  requestedAt: '2026-09-05T10:00:00.000Z', startedAt: null, finishedAt: null, reason: null, message: null,
  log: [], backups: [], cameBackVersion: null, ...over,
});

/** Render Settings and switch to the Updates tab, the way the operator gets there. */
function openUpdates(): void {
  render(<SettingsRoute />);
  fireEvent.click(screen.getByText('Updates'));
}

beforeEach(() => {
  state.update = status();
  state.updateLoading = false;
  state.updateError = false;
  state.upgrade = null;
  state.waitingFor = [];
  state.upgradeQueryError = false;
  state.requested = [];
  state.cancelled = 0;
  state.refreshed = 0;
  state.toasts = [];
});

describe('Updates: the release state', () => {
  it('shows the running version, commit and release directory', () => {
    openUpdates();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    expect(screen.getByText('aaaaaaaaaa')).toBeInTheDocument();
    expect(screen.getByText(RUNNING.path)).toBeInTheDocument();
  });

  it('shows the target and an Upgrade action when an update is available', () => {
    openUpdates();
    expect(screen.getByText('/src/agent-conductor @ main')).toBeInTheDocument();
    expect(screen.getByText('bbbbbbbbbb')).toBeInTheDocument();
    expect(screen.getByText('Update available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeInTheDocument();
  });

  it('offers no Upgrade action when the daemon is up to date', () => {
    state.update = status({ updateAvailable: false, targetSha: 'a'.repeat(40) });
    openUpdates();
    expect(screen.getByText('Up to date')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument();
  });

  it('names what has to be configured, and offers nothing, when checking is not set up', () => {
    state.update = status({ configured: false, source: null, ref: null, targetSha: null, updateAvailable: false, checkedAt: null });
    openUpdates();
    expect(screen.getByText('Update checking is not configured')).toBeInTheDocument();
    expect(screen.getByText(/upgrade\.source/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument();
    expect(screen.queryByText('Update available')).not.toBeInTheDocument();
  });

  it('shows the check failure and offers no upgrade', () => {
    state.update = status({ updateAvailable: false, targetSha: null, error: 'Could not resolve hostname' });
    openUpdates();
    expect(screen.getByText('Could not resolve hostname')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument();
  });

  it('re-checks on demand', () => {
    openUpdates();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(state.refreshed).toBe(1);
  });
});

describe('Updates: requesting the upgrade', () => {
  it('requests it and reports it as queued rather than done', () => {
    openUpdates();
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }));
    expect(state.requested).toHaveLength(1);
    expect(state.toasts[0]).toMatchObject({ title: 'Upgrade queued' });
  });

  it('offers no Upgrade action while one is already in flight', () => {
    state.upgrade = record({ state: 'waiting' });
    openUpdates();
    expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument();
  });
});

describe('Updates: following an upgrade', () => {
  it('shows what a waiting upgrade is holding for, and offers to cancel it', () => {
    state.upgrade = record({ state: 'waiting' });
    state.waitingFor = [{ workspace: 'ws1', running: 2, runIds: ['r1', 'r2'] }];
    openUpdates();
    expect(screen.getByText(/Waiting for 2 runs in ws1/)).toBeInTheDocument();
    expect(screen.getByText(/No new run starts/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel upgrade' })).toBeInTheDocument();
  });

  it('cancels a pending upgrade', () => {
    state.upgrade = record({ state: 'queued' });
    openUpdates();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel upgrade' }));
    expect(state.cancelled).toBe(1);
  });

  it('shows the build stage and its log tail, and stops offering to cancel', () => {
    state.upgrade = record({ state: 'building', log: ['$ pnpm install', '$ pnpm build'] });
    openUpdates();
    expect(screen.getByText('Building the new release')).toBeInTheDocument();
    expect(screen.getByText(/\$ pnpm build/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel upgrade' })).not.toBeInTheDocument();
  });

  it('says the daemon is restarting while it is unreachable', () => {
    state.upgrade = record({ state: 'restarting', toRelease: '/rel/new', toSha: 'b'.repeat(40) });
    state.upgradeQueryError = true;
    openUpdates();
    expect(screen.getByText('Restarting the daemon…')).toBeInTheDocument();
    expect(screen.getByText(/reconnects on its own/)).toBeInTheDocument();
  });

  it('shows the outcome and the version the daemon came back on', () => {
    state.upgrade = record({ state: 'completed', cameBackVersion: '1.1.0', toRelease: '/rel/new', finishedAt: '2026-09-05T10:10:00.000Z' });
    openUpdates();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('v1.1.0')).toBeInTheDocument();
  });

  it('shows the failure reason, the log tail and the version still running', () => {
    state.upgrade = record({ state: 'failed', reason: 'build_failed', message: 'pnpm build exited 1', log: ['error TS1005'] });
    openUpdates();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('build_failed')).toBeInTheDocument();
    expect(screen.getByText('pnpm build exited 1')).toBeInTheDocument();
    expect(screen.getByText(/error TS1005/)).toBeInTheDocument();
    // The previous release is still the one running.
    expect(screen.getAllByText('v1.0.0').length).toBeGreaterThan(0);
  });
});

describe('polling', () => {
  it('polls while the upgrade is in flight and stops once it is terminal', () => {
    for (const s of ['queued', 'waiting', 'building', 'switching', 'restarting'] as UpgradeState[]) {
      expect(upgradePollInterval(s)).toBe(2000);
    }
    for (const s of ['completed', 'failed', 'cancelled'] as UpgradeState[]) {
      expect(upgradePollInterval(s)).toBe(false);
    }
    expect(upgradePollInterval(undefined)).toBe(false);
  });
});
