import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountLimits } from '@agent-conductor/render';
import type { RuntimeAccount, UsageBillingMix } from '@agent-conductor/shared';
import { PlanLimits } from '../components/PlanLimits';

const NOW = new Date('2026-09-05T17:35:00.000Z');

const subscription: RuntimeAccount = {
  workspaceId: 'ws', runtimeId: 'claude', billingType: 'subscription_included', planLabel: 'max',
  limitsAvailable: true,
  limits: [
    { kind: 'session', label: 'Session', utilization: 42, resetsAt: '2026-09-05T18:09:59.000Z', scopeLabel: null },
    { kind: 'weekly_all', label: 'Weekly', utilization: 23, resetsAt: '2026-09-10T01:59:59.000Z', scopeLabel: null },
    { kind: 'weekly_scoped', label: 'Weekly', utilization: 25, resetsAt: '2026-09-10T01:59:59.000Z', scopeLabel: 'Fable' },
  ],
  note: null, capturedAt: '2026-09-05T17:33:00.000Z',
};

const noLimits: RuntimeAccount = {
  ...subscription, runtimeId: 'codex', planLabel: null, limitsAvailable: false, limits: [],
  note: 'codex: the CLI keeps plan limits in its session rollout file',
};

describe('PlanLimits', () => {
  it('shows the plan, every window with its utilisation and reset, and the snapshot age', () => {
    render(<PlanLimits accounts={accountLimits([subscription], NOW)} />);
    expect(screen.getByText('max')).toBeTruthy();
    expect(screen.getByText('Session')).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByText('resets in 35m')).toBeTruthy();
    expect(screen.getByText('Weekly · Fable')).toBeTruthy();
    expect(screen.getByText('2m ago')).toBeTruthy();
  });

  it('says limits are unavailable with the reason, and draws no bar', () => {
    const { container } = render(<PlanLimits accounts={accountLimits([noLimits], NOW)} />);
    expect(screen.getByText(/Limits unavailable/)).toBeTruthy();
    expect(screen.getByText(/session rollout file/)).toBeTruthy();
    expect(container.querySelectorAll('.rounded-pill')).toHaveLength(0);
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('renders one block per account', () => {
    const { container } = render(<PlanLimits accounts={accountLimits([subscription, noLimits], NOW)} />);
    expect(container.querySelector('[data-testid="plan-claude"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="plan-codex"]')).toBeTruthy();
  });

  it('renders nothing at all when no account has been probed', () => {
    const { container } = render(<PlanLimits accounts={accountLimits([], NOW)} />);
    expect(container.innerHTML).toBe('');
  });
});

/* ------------------------------------------------------ the Usage route */

const totals = { tokensIn: 900, tokensOut: 100, tokensCached: 0, runs: 3, workerTurns: 3, durationMs: 0, costCents: 250, costStatus: 'estimated' as const };

function mockHooks(billingMix: UsageBillingMix | undefined, accounts: RuntimeAccount[]): void {
  vi.doMock('../api/hooks', () => ({
    useProjects: () => ({ data: [] }),
    useUsage: () => ({ data: { scope: 'workspace', window: 'week', grain: 'day', start: '', end: '', series: [{ ...totals, bucket: '2026-09-05' }], total: totals, billingMix }, isLoading: false, isError: false, refetch: () => undefined }),
    useUsageTop: () => ({ data: [] }),
    useUsageModels: () => ({ data: [] }),
    useUsageAccounts: () => ({ data: accounts.map((a) => ({ ...a, displayName: a.runtimeId })) }),
  }));
}

async function renderUsage(): Promise<void> {
  const { UsageRoute } = await import('../routes/Usage');
  render(<UsageRoute />);
}

describe('the usage route decides cost from the window it is showing', () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock('../api/hooks'); });

  it('hides the dollar figure and shows the plan when the window was all subscription', async () => {
    mockHooks({ subscription: 1000, metered: 0, unknown: 0 }, [subscription]);
    await renderUsage();
    expect(screen.getByText('Plan limits')).toBeTruthy();
    expect(screen.queryByText(/^cost · /)).toBeNull();
    expect(screen.getByText('Session')).toBeTruthy();
  });

  it('keeps the dollar figure when any of the window was metered', async () => {
    mockHooks({ subscription: 1000, metered: 5, unknown: 0 }, [subscription]);
    await renderUsage();
    expect(screen.getByText(/^cost · /)).toBeTruthy();
  });

  it('keeps the dollar figure when the window has unattributed tokens', async () => {
    mockHooks({ subscription: 1000, metered: 0, unknown: 5 }, [subscription]);
    await renderUsage();
    expect(screen.getByText(/^cost · /)).toBeTruthy();
  });

  it('is unchanged when nothing has been probed and no mix is reported', async () => {
    mockHooks(undefined, []);
    await renderUsage();
    expect(screen.getByText(/^cost · /)).toBeTruthy();
    expect(screen.queryByText('Plan limits')).toBeNull();
  });
});
