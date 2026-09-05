import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeRuntime, type AccountDescription } from '@agent-conductor/runtime-sdk';
import { newId, nowIso } from '@agent-conductor/db';
import type { AccountsService } from '../api.js';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createAccountsService } from './accounts.js';

/** A fake runtime that answers `describeAccount` with whatever the test scripts. */
class AccountRuntime extends FakeRuntime {
  calls = 0;
  constructor(private readonly answer: AccountDescription | Error) { super(); }
  async describeAccount(): Promise<AccountDescription> {
    this.calls += 1;
    if (this.answer instanceof Error) throw this.answer;
    return this.answer;
  }
}

const subscription: AccountDescription = {
  billingType: 'subscription_included',
  planLabel: 'max',
  limitsAvailable: true,
  limits: [
    { kind: 'session', label: 'Session', utilization: 42, resetsAt: '2026-09-05T18:09:59.000Z', scopeLabel: null },
    { kind: 'weekly_scoped', label: 'Weekly', utilization: 25, resetsAt: '2026-09-10T01:59:59.000Z', scopeLabel: 'Fable' },
  ],
  note: null,
};

describe('accounts service', () => {
  let h: TestHarness;
  let accounts: AccountsService;
  beforeEach(() => { h = makeHarness(); accounts = createAccountsService(h.ctx); });
  afterEach(() => h.cleanup());

  it('has no snapshots before the first refresh', () => {
    expect(accounts.list()).toEqual([]);
    expect(accounts.get('claude')).toBeNull();
  });

  it('stores a snapshot with its windows and capture time', async () => {
    h.ctx.registries.runtimes.set('claude', new AccountRuntime(subscription));
    const refreshed = await accounts.refresh(['claude']);
    expect(refreshed).toHaveLength(1);

    const acc = accounts.get('claude');
    expect(acc).toMatchObject({ runtimeId: 'claude', billingType: 'subscription_included', planLabel: 'max', limitsAvailable: true, note: null });
    expect(acc?.limits).toEqual(subscription.limits);
    expect(Date.parse(acc?.capturedAt ?? '')).toBeGreaterThan(0);
  });

  it('replaces the previous snapshot rather than keeping history', async () => {
    h.ctx.registries.runtimes.set('claude', new AccountRuntime(subscription));
    await accounts.refresh(['claude']);
    h.ctx.registries.runtimes.set('claude', new AccountRuntime({ ...subscription, planLabel: 'pro', limits: [] , limitsAvailable: false, note: 'unavailable' }));
    await accounts.refresh(['claude']);

    expect(accounts.list()).toHaveLength(1);
    expect(accounts.get('claude')).toMatchObject({ planLabel: 'pro', limitsAvailable: false, note: 'unavailable' });
    expect(accounts.get('claude')?.limits).toEqual([]);
  });

  it('leaves the previous snapshot in place when a probe throws', async () => {
    h.ctx.registries.runtimes.set('claude', new AccountRuntime(subscription));
    await accounts.refresh(['claude']);
    const before = accounts.get('claude');

    h.ctx.registries.runtimes.set('claude', new AccountRuntime(new Error('the CLI is not logged in')));
    await expect(accounts.refresh(['claude'])).resolves.toEqual([]);
    expect(accounts.get('claude')).toEqual(before);
  });

  it('skips a runtime whose adapter cannot describe an account', async () => {
    h.ctx.registries.runtimes.set('claude', new FakeRuntime());
    await accounts.refresh(['claude']);
    expect(accounts.list()).toEqual([]);
  });

  it('skips a runtime that is not registered at all', async () => {
    await expect(accounts.refresh(['nosuch'])).resolves.toEqual([]);
    expect(accounts.list()).toEqual([]);
  });

  it('refreshes every runtime the workspace uses, and only those', async () => {
    // The harness seeds a project, a role and a conductor agent, all on `claude`.
    const codex = new AccountRuntime({ ...subscription, planLabel: null, limitsAvailable: false, limits: [], note: 'no limits' });
    const claude = new AccountRuntime(subscription);
    const idle = new AccountRuntime(subscription);
    h.ctx.registries.runtimes.set('claude', claude);
    h.ctx.registries.runtimes.set('codex', codex);
    h.ctx.registries.runtimes.set('gemini', idle);
    // One retired worker on codex still counts the runtime out; an active one counts it in.
    h.db.insert('agents', {
      id: newId(), workspaceId: h.workspaceId, kind: 'worker', name: 'W', runtimeId: 'codex', status: 'active',
      homePath: h.root, turnEpoch: 0, turnCount: 0, spawnedBy: 'system', briefRevision: 1, createdAt: nowIso(), updatedAt: nowIso(),
    });

    await accounts.refresh();

    expect(claude.calls).toBe(1);
    expect(codex.calls).toBe(1);
    expect(idle.calls).toBe(0);
    expect(accounts.list().map((a) => a.runtimeId)).toEqual(['claude', 'codex']);
  });

  it('does not probe a runtime only a retired worker used', async () => {
    const gemini = new AccountRuntime(subscription);
    h.ctx.registries.runtimes.set('gemini', gemini);
    h.db.insert('agents', {
      id: newId(), workspaceId: h.workspaceId, kind: 'worker', name: 'Retired', runtimeId: 'gemini', status: 'retired',
      homePath: h.root, turnEpoch: 0, turnCount: 0, spawnedBy: 'system', briefRevision: 1,
      retiredAt: nowIso(), createdAt: nowIso(), updatedAt: nowIso(),
    });

    await accounts.refresh();
    expect(gemini.calls).toBe(0);
  });
});
