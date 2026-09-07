import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeAccount } from '@agent-conductor/shared';
import { COUNTDOWN_TICK_MS, SessionLimit } from '../components/SessionLimit';

const NOW = new Date('2026-09-05T17:35:00.000Z');

const subscription: RuntimeAccount = {
  workspaceId: 'ws', runtimeId: 'claude', billingType: 'subscription_included', planLabel: 'max',
  limitsAvailable: true,
  limits: [
    { kind: 'session', label: 'Session', utilization: 33, resetsAt: '2026-09-05T19:45:00.000Z', scopeLabel: null },
    { kind: 'weekly_all', label: 'Weekly', utilization: 23, resetsAt: '2026-09-10T01:59:59.000Z', scopeLabel: null },
    { kind: 'weekly_scoped', label: 'Weekly', utilization: 25, resetsAt: '2026-09-10T01:59:59.000Z', scopeLabel: 'Fable' },
  ],
  note: null, capturedAt: '2026-09-05T17:33:00.000Z',
};

const metered: RuntimeAccount = {
  ...subscription, runtimeId: 'codex', billingType: 'metered_api', planLabel: null, limitsAvailable: false, limits: [],
  note: 'codex: billed per token',
};

const noLimits: RuntimeAccount = {
  ...subscription, limitsAvailable: false, limits: [],
  note: 'claude: the CLI keeps plan limits in its session rollout file',
};

const probeFailed: RuntimeAccount = {
  ...subscription, billingType: 'unknown', planLabel: null, limitsAvailable: false, limits: [],
  note: 'claude: the get_usage probe returned no control response (exit -1: spawn error)',
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SessionLimit', () => {
  it('meters the session window with the time left before it resets', () => {
    render(<SessionLimit accounts={[subscription]} runtimeId="claude" />);
    expect(screen.getByText('Session')).toBeTruthy();
    expect(screen.getByText('33%')).toBeTruthy();
    expect(screen.getByText('· 2h 10m')).toBeTruthy();
  });

  it('puts the runtime, the plan and the capture time on hover, so a stale snapshot looks stale', () => {
    render(<SessionLimit accounts={[subscription]} runtimeId="claude" />);
    expect(screen.getByTestId('session-limit').getAttribute('title')).toContain('claude · max · captured 2m ago');
  });

  it('ticks the countdown down between refreshes, without a new snapshot', () => {
    render(<SessionLimit accounts={[subscription]} runtimeId="claude" />);
    expect(screen.getByText('· 2h 10m')).toBeTruthy();
    // The tick itself advances the mocked clock, so the time is set to one tick short of the
    // moment the interval is meant to fire at.
    act(() => {
      vi.setSystemTime(new Date('2026-09-05T18:58:00.000Z').getTime() - COUNTDOWN_TICK_MS);
      vi.advanceTimersByTime(COUNTDOWN_TICK_MS);
    });
    expect(screen.getByText('· 47m')).toBeTruthy();
    act(() => {
      vi.setSystemTime(new Date('2026-09-05T19:46:00.000Z').getTime() - COUNTDOWN_TICK_MS);
      vi.advanceTimersByTime(COUNTDOWN_TICK_MS);
    });
    expect(screen.getByText('· now')).toBeTruthy();
  });

  it('shows the conductor runtime, never another runtime that happens to be probed', () => {
    const { container } = render(<SessionLimit accounts={[metered, subscription]} runtimeId="codex" />);
    expect(container.innerHTML).toBe('');
  });

  it('shows nothing on a metered account rather than a bar at zero', () => {
    const { container } = render(<SessionLimit accounts={[metered]} runtimeId="codex" />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('shows nothing before that runtime has been probed', () => {
    const { container } = render(<SessionLimit accounts={[]} runtimeId="claude" />);
    expect(container.innerHTML).toBe('');
  });

  it('says the limits are unavailable, quietly and without a number', () => {
    render(<SessionLimit accounts={[noLimits]} runtimeId="claude" />);
    expect(screen.getByText('Limits unavailable')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('says the probe failed rather than blaming the plan', () => {
    render(<SessionLimit accounts={[probeFailed]} runtimeId="claude" />);
    expect(screen.getByText('Account probe failed')).toBeTruthy();
    expect(screen.queryByText('Limits unavailable')).toBeNull();
  });

  it('opens the weekly and per-model windows on tap, without spending header width on them', () => {
    render(<SessionLimit accounts={[subscription]} runtimeId="claude" />);
    expect(screen.queryByText('Weekly · Fable')).toBeNull();
    fireEvent.click(screen.getByTestId('session-limit'));
    const sheet = screen.getByRole('dialog');
    expect(sheet.textContent).toContain('Weekly · Fable');
    expect(sheet.textContent).toContain('resets in 4d');
    expect(sheet.textContent).toContain('synced 2m ago');
  });

  // The detail is the usage page's own block (VS-84), so the sync it offers is the same one.
  it('offers the same sync in the detail, for the conductor\'s runtime', () => {
    const sync = { pendingRuntimeId: null, messages: {}, onSync: vi.fn() };
    render(<SessionLimit accounts={[subscription]} runtimeId="claude" sync={sync} />);
    fireEvent.click(screen.getByTestId('session-limit'));

    expect(screen.getByRole('dialog').textContent).toContain('every 5 minutes');
    fireEvent.click(screen.getByTestId('sync-claude'));
    expect(sync.onSync).toHaveBeenCalledWith('claude');
  });

  it('offers no sync in the detail when the header was given none', () => {
    render(<SessionLimit accounts={[subscription]} runtimeId="claude" />);
    fireEvent.click(screen.getByTestId('session-limit'));
    expect(screen.queryByTestId('sync-claude')).toBeNull();
  });
});
