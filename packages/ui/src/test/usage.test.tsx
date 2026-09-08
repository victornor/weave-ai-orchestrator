import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountLimits, MIXED_BILLING_NOTE } from '@agent-conductor/render';
import type { RuntimeAccount, RuntimeCredential, UsageBillingMix } from '@agent-conductor/shared';
import { PlanLimits, type PlanSync } from '../components/PlanLimits';
import { RuntimeCredentials } from '../components/RuntimeCredentials';

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

const probeFailed: RuntimeAccount = {
  ...subscription, billingType: 'unknown', planLabel: null, limitsAvailable: false, limits: [],
  note: 'claude: the get_usage probe returned no control response (exit -1: spawn error)',
};

describe('PlanLimits', () => {
  it('shows the plan, every window with its utilisation and reset, and the snapshot age', () => {
    render(<PlanLimits accounts={accountLimits([subscription], NOW)} />);
    expect(screen.getByText('max')).toBeTruthy();
    expect(screen.getByText('Session')).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByText('resets in 35m')).toBeTruthy();
    expect(screen.getByText('Weekly · Fable')).toBeTruthy();
    expect(screen.getByText('synced 2m ago')).toBeTruthy();
  });

  it('says limits are unavailable with the reason, and draws no bar', () => {
    const { container } = render(<PlanLimits accounts={accountLimits([noLimits], NOW)} />);
    expect(screen.getByText(/Limits unavailable/)).toBeTruthy();
    expect(screen.getByText(/session rollout file/)).toBeTruthy();
    expect(container.querySelectorAll('.rounded-pill')).toHaveLength(0);
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('says the probe failed, with its reason and the capture time, rather than blaming the plan', () => {
    render(<PlanLimits accounts={accountLimits([probeFailed], NOW)} />);
    expect(screen.getByText(/Account probe failed/)).toBeTruthy();
    expect(screen.getByText(/spawn error/)).toBeTruthy();
    expect(screen.getByText('synced 2m ago')).toBeTruthy();
    expect(screen.queryByText(/Limits unavailable/)).toBeNull();
  });

  it('explains a cost figure that survives because the window mixes billing types', () => {
    render(<PlanLimits accounts={accountLimits([subscription], NOW)} mixedNote={MIXED_BILLING_NOTE} />);
    expect(screen.getByText(MIXED_BILLING_NOTE)).toBeTruthy();
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

  /* ------------------------------------------- the on-demand sync (VS-84) */

  const planSync = (over: Partial<PlanSync> = {}): PlanSync => ({ pendingRuntimeId: null, messages: {}, onSync: vi.fn(), ...over });

  it('offers no sync at all when the caller hands down none', () => {
    const { container } = render(<PlanLimits accounts={accountLimits([subscription], NOW)} />);
    expect(container.querySelector('[data-testid="sync-claude"]')).toBeNull();
    expect(screen.queryByText(/every 5 minutes/)).toBeNull();
  });

  it('syncs the runtime whose control was used, and says what the daemon does on its own', () => {
    const sync = planSync();
    render(<PlanLimits accounts={accountLimits([subscription, noLimits], NOW)} sync={sync} />);
    expect(screen.getByText(/every 5 minutes/)).toBeTruthy();

    fireEvent.click(screen.getByTestId('sync-codex'));
    expect(sync.onSync).toHaveBeenCalledWith('codex');
  });

  it('spins and refuses a second request while that runtime is in flight, leaving the others alone', () => {
    const sync = planSync({ pendingRuntimeId: 'claude' });
    render(<PlanLimits accounts={accountLimits([subscription, noLimits], NOW)} sync={sync} />);

    const claude = screen.getByTestId('sync-claude') as HTMLButtonElement;
    expect(claude.disabled).toBe(true);
    expect(claude.getAttribute('aria-busy')).toBe('true');
    expect(claude.textContent).toContain('Syncing');
    expect(claude.querySelector('.animate-spin')).toBeTruthy();
    expect((screen.getByTestId('sync-codex') as HTMLButtonElement).disabled).toBe(false);
  });

  it('says next to the runtime when its sync failed or was refused as too recent', () => {
    render(
      <PlanLimits
        accounts={accountLimits([subscription, noLimits], NOW)}
        sync={planSync({ messages: { claude: 'Sync failed — the CLI is not logged in', codex: 'Synced too recently — try again in 12s.' } })}
      />,
    );
    expect(screen.getByTestId('sync-note-claude').textContent).toContain('the CLI is not logged in');
    expect(screen.getByTestId('sync-note-codex').textContent).toContain('try again in 12s');
  });
});

/* ------------------------------------------------------ the Usage route */

const totals = { tokensIn: 900, tokensOut: 100, tokensCached: 0, runs: 3, workerTurns: 3, durationMs: 0, costCents: 250, costStatus: 'estimated' as const };

function mockHooks(billingMix: UsageBillingMix | undefined, accounts: RuntimeAccount[], credentials: RuntimeCredential[] = []): void {
  vi.doMock('../api/hooks', () => ({
    useProjects: () => ({ data: [] }),
    useUsage: () => ({ data: { scope: 'workspace', window: 'week', grain: 'day', start: '', end: '', series: [{ ...totals, bucket: '2026-09-05' }], total: totals, billingMix }, isLoading: false, isError: false, refetch: () => undefined }),
    useUsageTop: () => ({ data: [] }),
    useUsageModels: () => ({ data: [] }),
    useUsageAccounts: () => ({ data: accounts.map((a) => ({ ...a, displayName: a.runtimeId })) }),
    useSyncUsageAccounts: () => ({ mutate: vi.fn(), isPending: false }),
    useUsageCredentials: () => ({ data: credentials.map((c) => ({ ...c, displayName: c.runtimeId })) }),
    useKnowledgeUsageSummary: () => ({ data: { averageTokensPerRun: 0, runs: 0 } }),
    useKnowledgeUsageTop: () => ({ data: [] }),
    useKnowledgeUsageNeverRead: () => ({ data: [] }),
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

  it('keeps the dollar figure when any of the window was metered, and says why', async () => {
    mockHooks({ subscription: 1000, metered: 5, unknown: 0 }, [subscription]);
    await renderUsage();
    expect(screen.getByText(/^cost · /)).toBeTruthy();
    expect(screen.getByText(MIXED_BILLING_NOTE)).toBeTruthy();
  });

  it('keeps the dollar figure when the window has unattributed tokens', async () => {
    mockHooks({ subscription: 1000, metered: 0, unknown: 5 }, [subscription]);
    await renderUsage();
    expect(screen.getByText(/^cost · /)).toBeTruthy();
    expect(screen.getByText(MIXED_BILLING_NOTE)).toBeTruthy();
  });

  it('does not explain a mix when there is none', async () => {
    mockHooks({ subscription: 1000, metered: 0, unknown: 0 }, [subscription]);
    await renderUsage();
    expect(screen.queryByText(MIXED_BILLING_NOTE)).toBeNull();
  });

  it('is unchanged when nothing has been probed and no mix is reported', async () => {
    mockHooks(undefined, []);
    await renderUsage();
    expect(screen.getByText(/^cost · /)).toBeTruthy();
    expect(screen.queryByText('Plan limits')).toBeNull();
  });
});

describe('the usage route knowledge context section (VS-110)', () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock('../api/hooks'); });

  it('shows the average per run, the most-read documents and the never-read list, labelled apart from total context', async () => {
    vi.doMock('../api/hooks', () => ({
      useProjects: () => ({ data: [] }),
      useUsage: () => ({ data: { scope: 'workspace', window: 'week', grain: 'day', start: '', end: '', series: [], total: totals, billingMix: undefined }, isLoading: false, isError: false, refetch: () => undefined }),
      useUsageTop: () => ({ data: [] }),
      useUsageModels: () => ({ data: [] }),
      useUsageAccounts: () => ({ data: [] }),
      useSyncUsageAccounts: () => ({ mutate: vi.fn(), isPending: false }),
      useUsageCredentials: () => ({ data: [] }),
      useKnowledgeUsageSummary: () => ({ data: { averageTokensPerRun: 123, runs: 4 } }),
      useKnowledgeUsageTop: () => ({ data: [{ scope: 'project', projectId: 'p1', slug: 'payments-webhooks', title: 'Payments webhooks', reads: 3, tokens: 90 }] }),
      useKnowledgeUsageNeverRead: () => ({ data: [{ scope: 'project', projectId: 'p1', slug: 'stale-doc', title: 'Stale doc', tokenEstimate: 20 }] }),
    }));
    await renderUsage();
    expect(screen.getByText('Knowledge context')).toBeTruthy();
    expect(screen.getByText(/not the total-context figures above/)).toBeTruthy();
    expect(screen.getByText('Payments webhooks')).toBeTruthy();
    expect(screen.getByText('Stale doc')).toBeTruthy();
  });
});

/* --------------------------------------- runtime credentials (VS-75) */

const CREDENTIAL: RuntimeCredential = {
  workspaceId: 'ws1', runtimeId: 'claude', present: true, expiresAt: '2026-09-05T22:00:00.000Z',
  lastVerifiedAt: '2026-09-05T17:00:00.000Z', refreshFailedAt: null, needsLogin: false, detail: null,
  updatedAt: '2026-09-05T17:00:00.000Z',
};

describe('the runtime credential panel', () => {
  const view = (c: RuntimeCredential) => render(<RuntimeCredentials credentials={[{ ...c, displayName: c.runtimeId }]} />);

  it('shows a healthy credential with when it was last verified, never a countdown to its expiry', () => {
    const { container } = view(CREDENTIAL);
    const row = container.querySelector('[data-testid="credential-claude"]')!;
    expect(row.textContent).toContain('valid');
    expect(row.textContent).toContain('last verified');
    expect(row.textContent).not.toContain('expires');
  });

  it('shows an expired login with when the refresh failed and what to run', () => {
    const { container } = view({ ...CREDENTIAL, needsLogin: true, refreshFailedAt: '2026-09-05T16:07:00.000Z' });
    const row = container.querySelector('[data-testid="credential-claude"]')!;
    expect(row.textContent).toContain('login expired');
    expect(row.textContent).toContain('2026-09-05 16:07 UTC');
    expect(row.textContent).toContain('claude /login');
    expect(row.textContent).toContain('resumes on its own');
  });

  it('shows a healthy credential with no last-verified moment as just healthy', () => {
    const { container } = view({ ...CREDENTIAL, lastVerifiedAt: null });
    const row = container.querySelector('[data-testid="credential-claude"]')!;
    expect(row.textContent).toContain('valid');
    expect(row.textContent).not.toContain('last verified');
    expect(row.textContent).not.toContain('expires');
  });

  it('renders nothing when no credential state is known', () => {
    const { container } = render(<RuntimeCredentials credentials={[]} />);
    expect(container.innerHTML).toBe('');
  });

  // The panel sits above the "no usage in this window" branch: a gated runtime has no usage
  // precisely because everything on it is stopped, which is exactly when it must be visible.
  it('is shown on the usage route even when the window has no usage at all', async () => {
    mockHooks(undefined, [], [{ ...CREDENTIAL, needsLogin: true }]);
    const { UsageRoute } = await import('../routes/Usage');
    const { container } = render(<UsageRoute />);
    expect(container.querySelector('[data-testid="runtime-credentials"]')).toBeTruthy();
    expect(container.textContent).toContain('login expired');
    vi.resetModules();
    vi.doUnmock('../api/hooks');
  });
});
