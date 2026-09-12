import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRuntime, type AccountDescription } from '@weave-ai/runtime-sdk';
import { newId, nowIso } from '@weave-ai/db';
import type { AccountsService } from '../api.js';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createAccountsService, MANUAL_SYNC_INTERVAL_MS } from './accounts.js';

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
    // The harness seeds a project, a role and a weave agent, all on `claude`.
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

  it('probes a runtime named only by a worker option (VS-162)', async () => {
    const gemini = new AccountRuntime(subscription);
    h.ctx.registries.runtimes.set('gemini', gemini);
    h.ctx.config.models.workerOptions = [
      { id: 'cheap', description: 'Scouts.', runtime: 'gemini', model: null },
    ];
    await accounts.refresh();
    expect(gemini.calls).toBe(1);
  });

  it('probes a runtime named only by a daemon overlay (VS-185)', async () => {
    const gemini = new AccountRuntime(subscription);
    h.ctx.registries.runtimes.set('gemini', gemini);
    h.ctx.daemon.models = { workers: { runtime: 'gemini', model: null } };
    await accounts.refresh();
    expect(gemini.calls).toBe(1);
    h.ctx.daemon.models = {};
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

/**
 * The on-demand sync (VS-84): the same probe the poll runs, asked for by a human, rate limited so
 * that asking twice cannot become a way to spawn a coding CLI in a loop.
 */
describe('on-demand account sync', () => {
  let h: TestHarness;
  let accounts: AccountsService;
  beforeEach(() => { h = makeHarness(); accounts = createAccountsService(h.ctx); });
  afterEach(() => { vi.useRealTimers(); h.cleanup(); });

  it('probes the named runtime and answers with the fresh snapshot', async () => {
    const claude = new AccountRuntime(subscription);
    h.ctx.registries.runtimes.set('claude', claude);

    const out = await accounts.sync(['claude']);
    expect(claude.calls).toBe(1);
    expect(out.synced).toEqual(['claude']);
    expect(out.throttled).toEqual([]);
    expect(out.failed).toEqual([]);
    expect(out.accounts.map((a) => a.runtimeId)).toEqual(['claude']);
    expect(out.accounts[0]).toMatchObject({ planLabel: 'max', limitsAvailable: true });
  });

  it('syncs every runtime the workspace spends on when none is named', async () => {
    const claude = new AccountRuntime(subscription);
    const idle = new AccountRuntime(subscription);
    h.ctx.registries.runtimes.set('claude', claude);
    h.ctx.registries.runtimes.set('gemini', idle);

    const out = await accounts.sync();
    expect(claude.calls).toBe(1);
    expect(idle.calls).toBe(0);
    expect(out.synced).toEqual(['claude']);
  });

  it('refuses a second sync of the same runtime inside the window, with the current snapshot and the wait', async () => {
    const claude = new AccountRuntime(subscription);
    h.ctx.registries.runtimes.set('claude', claude);
    await accounts.sync(['claude']);

    const out = await accounts.sync(['claude']);
    expect(claude.calls).toBe(1);
    expect(out.synced).toEqual([]);
    expect(out.throttled).toHaveLength(1);
    expect(out.throttled[0]?.runtimeId).toBe('claude');
    expect(out.throttled[0]?.retryAfterMs).toBeGreaterThan(0);
    expect(out.throttled[0]?.retryAfterMs).toBeLessThanOrEqual(MANUAL_SYNC_INTERVAL_MS);
    expect(Date.parse(out.throttled[0]?.nextSyncAt ?? '')).toBeGreaterThan(Date.now());
    // The block on screen is drawn from this, so a throttled runtime still carries its snapshot.
    expect(out.accounts.map((a) => a.runtimeId)).toEqual(['claude']);
  });

  it('probes again once the window has passed', async () => {
    vi.useFakeTimers();
    const claude = new AccountRuntime(subscription);
    h.ctx.registries.runtimes.set('claude', claude);
    await accounts.sync(['claude']);

    vi.setSystemTime(new Date(Date.now() + MANUAL_SYNC_INTERVAL_MS + 1));
    const out = await accounts.sync(['claude']);
    expect(claude.calls).toBe(2);
    expect(out.synced).toEqual(['claude']);
  });

  it('holds the window per runtime, so one runtime does not hold up another', async () => {
    const claude = new AccountRuntime(subscription);
    const codex = new AccountRuntime(subscription);
    h.ctx.registries.runtimes.set('claude', claude);
    h.ctx.registries.runtimes.set('codex', codex);
    await accounts.sync(['claude']);

    const out = await accounts.sync(['claude', 'codex']);
    expect(claude.calls).toBe(1);
    expect(codex.calls).toBe(1);
    expect(out.synced).toEqual(['codex']);
    expect(out.throttled.map((t) => t.runtimeId)).toEqual(['claude']);
  });

  it('leaves the daemon poll alone: it neither consumes the window nor waits on it', async () => {
    const claude = new AccountRuntime(subscription);
    h.ctx.registries.runtimes.set('claude', claude);

    // A poll before the sync does not spend the window …
    await accounts.refresh(['claude']);
    expect((await accounts.sync(['claude'])).synced).toEqual(['claude']);
    // … and a sync does not stop the next poll.
    await accounts.refresh(['claude']);
    expect(claude.calls).toBe(3);
  });

  it('reports a probe that threw, and leaves the previous snapshot standing', async () => {
    h.ctx.registries.runtimes.set('claude', new AccountRuntime(subscription));
    await accounts.refresh(['claude']);
    const before = accounts.get('claude');

    h.ctx.registries.runtimes.set('claude', new AccountRuntime(new Error('the CLI is not logged in')));
    const out = await accounts.sync(['claude']);
    expect(out.synced).toEqual([]);
    expect(out.failed).toEqual([{ runtimeId: 'claude', message: 'the CLI is not logged in' }]);
    expect(out.accounts).toEqual([before]);
  });

  it('reports a runtime that does not describe its account rather than silently doing nothing', async () => {
    h.ctx.registries.runtimes.set('claude', new FakeRuntime());
    const out = await accounts.sync(['claude']);
    expect(out.synced).toEqual([]);
    expect(out.failed[0]?.runtimeId).toBe('claude');
    expect(out.failed[0]?.message).toContain('does not describe its account');
    expect(out.accounts).toEqual([]);
  });

  it('keeps the snapshot a failed probe wrote, so the note reaches the surfaces', async () => {
    const failedProbe: AccountDescription = { billingType: 'unknown', planLabel: null, limitsAvailable: false, limits: [], note: 'claude: the get_usage probe returned no control response' };
    h.ctx.registries.runtimes.set('claude', new AccountRuntime(failedProbe));

    const out = await accounts.sync(['claude']);
    expect(out.synced).toEqual(['claude']);
    expect(out.accounts[0]).toMatchObject({ billingType: 'unknown', note: failedProbe.note });
  });
});

/**
 * The credential state behind the login gate (VS-75). Never launches a CLI: `present` and
 * `expiresAt` come from the credential file, through the runtime's `readCredential` hook.
 */
describe('credential state', () => {
  let h: TestHarness;
  let accounts: AccountsService;

  /** A runtime that reads its credential file the way the claude adapter does. */
  class CredentialRuntime extends AccountRuntime {
    readCredential({ configHome }: { configHome: string }): { present: boolean; expiresAt: string | null } {
      try {
        const raw = readFileSync(join(configHome, '.credentials.json'), 'utf8');
        const at = (JSON.parse(raw) as { expiresAt?: number }).expiresAt;
        return { present: true, expiresAt: typeof at === 'number' ? new Date(at).toISOString() : null };
      } catch { return { present: false, expiresAt: null }; }
    }
  }

  const writeCredentialFile = (expiresAt: string | null): void => {
    const home = join(h.ctx.paths.runtimesHome, 'claude');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, '.credentials.json'), JSON.stringify(expiresAt ? { expiresAt: Date.parse(expiresAt) } : {}));
  };

  beforeEach(() => {
    h = makeHarness();
    accounts = createAccountsService(h.ctx);
    h.ctx.registries.runtimes.set('claude', new CredentialRuntime(subscription));
  });
  afterEach(() => h.cleanup());

  it('reports a credential that has never failed as valid and ungated', () => {
    writeCredentialFile('2026-09-08T10:00:00.000Z');
    const cred = accounts.credential('claude');
    expect(cred).toMatchObject({ present: true, expiresAt: '2026-09-08T10:00:00.000Z', needsLogin: false, refreshFailedAt: null });
    expect(accounts.gatedRuntimes()).toEqual([]);
  });

  it('reports a present credential whose expiry it cannot read, rather than an absent one', () => {
    writeCredentialFile(null);
    expect(accounts.credential('claude')).toMatchObject({ present: true, expiresAt: null });
  });

  it('round-trips a failure and a verification', () => {
    writeCredentialFile('2026-09-08T10:00:00.000Z');

    const failed = accounts.noteAuthFailure('claude', 'OAuth session expired');
    expect(failed.needsLogin).toBe(true);
    expect(failed.refreshFailedAt).not.toBeNull();
    expect(failed.detail).toBe('OAuth session expired');
    expect(accounts.gatedRuntimes()).toEqual(['claude']);

    const ok = accounts.noteVerified('claude');
    expect(ok.needsLogin).toBe(false);
    expect(ok.refreshFailedAt).toBeNull();
    expect(ok.lastVerifiedAt).not.toBeNull();
    expect(accounts.gatedRuntimes()).toEqual([]);
  });

  it('re-reads the expiry from the file rather than caching it', () => {
    writeCredentialFile('2026-09-08T10:00:00.000Z');
    accounts.noteAuthFailure('claude', null);
    expect(accounts.credential('claude').expiresAt).toBe('2026-09-08T10:00:00.000Z');

    // The owner logs in again: the file moves and the state must move with it, uncached.
    writeCredentialFile('2026-09-20T10:00:00.000Z');
    expect(accounts.credential('claude').expiresAt).toBe('2026-09-20T10:00:00.000Z');
  });

  it('strips anything token-shaped from the detail it stores', () => {
    writeCredentialFile('2026-09-08T10:00:00.000Z');
    const failed = accounts.noteAuthFailure('claude', 'could not refresh sk-ant-oat01-AAAAAAAAAAAAAAAAAAAA');
    expect(failed.detail).not.toContain('sk-ant-oat01-AAAAAAAAAAAAAAAAAAAA');
    expect(JSON.stringify(accounts.credentials())).not.toContain('AAAAAAAAAAAAAAAAAAAA');
  });

  it('records the last verified time when a probe describes the account', async () => {
    writeCredentialFile('2026-09-08T10:00:00.000Z');
    await accounts.refresh(['claude']);
    expect(accounts.credential('claude').lastVerifiedAt).not.toBeNull();
  });

  it('does not lower the gate as a side effect of a probe', async () => {
    writeCredentialFile('2026-09-08T10:00:00.000Z');
    accounts.noteAuthFailure('claude', 'expired');
    await accounts.refresh(['claude']);
    // Lowering the gate also has to release the agents it paused, which is `ungateRuntime`'s job.
    expect(accounts.gatedRuntimes()).toEqual(['claude']);
  });

  it('never returns a token in the credential state', () => {
    const home = join(h.ctx.paths.runtimesHome, 'claude');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, '.credentials.json'), JSON.stringify({ expiresAt: Date.parse('2026-09-08T10:00:00Z'), accessToken: 'sk-ant-oat01-SECRET' }));
    const state = JSON.stringify(accounts.credentials().concat(accounts.credential('claude')));
    expect(state).not.toContain('sk-ant-oat01-SECRET');
    expect(state).not.toContain('accessToken');
  });

  /**
   * VS-285: a billing/plan probe has no business repairing a credential — that stays on the
   * turn-spawn path only. Run entirely against a scratch `HOME`, never the real one.
   */
  it('does not reconcile a forked credential as a side effect of a probe', async () => {
    const previousHome = process.env.HOME;
    const scratchHome = mkdtempSync(join(tmpdir(), 'ac-accounts-home-'));
    process.env.HOME = scratchHome;
    try {
      const hostPath = join(scratchHome, '.claude', '.credentials.json');
      const wsPath = join(h.ctx.paths.runtimesHome, 'claude', '.credentials.json');
      mkdirSync(dirname(hostPath), { recursive: true });
      mkdirSync(dirname(wsPath), { recursive: true });
      // A genuine fork: the workspace side is a real file (not a symlink) with a later expiry —
      // exactly the shape `reconcileRuntimeCredential` would repair if it were still called here.
      writeFileSync(hostPath, JSON.stringify({ expiresAt: Date.parse('2026-09-08T10:00:00Z'), marker: 'host' }));
      writeFileSync(wsPath, JSON.stringify({ expiresAt: Date.parse('2026-09-09T10:00:00Z'), marker: 'workspace-newer' }));
      const hostBefore = readFileSync(hostPath, 'utf8');

      await accounts.refresh(['claude']);

      expect(readFileSync(hostPath, 'utf8')).toBe(hostBefore);
      expect((JSON.parse(readFileSync(wsPath, 'utf8')) as { marker: string }).marker).toBe('workspace-newer');
    } finally {
      if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
      rmSync(scratchHome, { recursive: true, force: true });
    }
  });
});
