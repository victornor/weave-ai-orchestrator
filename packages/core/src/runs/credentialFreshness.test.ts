import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRuntime, type AccountDescription, type AccountProbeInput, type CredentialFacts } from '@weave-ai/runtime-sdk';
import { ensureFreshCredential } from './credentialFreshness.js';
import { type CredentialReader, linkRuntimeCredentials, reconcileRuntimeCredential } from '../workspace/loader.js';

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const MIN_VALID_MS = 10 * 60 * 1000;

/**
 * Stands in for the credential endpoint: `describeAccount` is the only thing that can move
 * `expiresAt` into the future, exactly as the real CLI's own refresh is the only thing that can.
 */
class FakeCredentialRuntime extends FakeRuntime {
  calls = 0;
  facts: CredentialFacts;
  describeShouldFail = false;
  describeDelayMs = 0;
  constructor(facts: CredentialFacts) { super(); this.facts = facts; }
  readCredential(): CredentialFacts { return this.facts; }
  async describeAccount(): Promise<AccountDescription> {
    this.calls += 1;
    if (this.describeDelayMs) await new Promise((r) => setTimeout(r, this.describeDelayMs));
    if (this.describeShouldFail) return { billingType: 'unknown', planLabel: null, limitsAvailable: false, limits: [], note: 'refresh failed: the refresh token was already rotated' };
    this.facts = { present: true, expiresAt: FUTURE };
    return { billingType: 'subscription_included', planLabel: 'Max', limitsAvailable: false, limits: [], note: null };
  }
}

function input(adapter: FakeCredentialRuntime, reconcile = vi.fn()) {
  return { runtimeId: 'claude', configHome: '/fake/home', adapter, minValidMs: MIN_VALID_MS, probeTimeoutMs: 5000, reconcile };
}

describe('ensureFreshCredential', () => {
  it('is a no-op for an adapter that cannot report credential facts', async () => {
    const runtime = new FakeRuntime();
    const reconcile = vi.fn();
    const result = await ensureFreshCredential({ runtimeId: 'other', configHome: '/x', adapter: runtime, minValidMs: MIN_VALID_MS, probeTimeoutMs: 5000, reconcile });
    expect(result).toEqual({ ok: true });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('takes the fast path and never probes when the credential is already fresh', async () => {
    const runtime = new FakeCredentialRuntime({ present: true, expiresAt: FUTURE });
    const result = await ensureFreshCredential(input(runtime));
    expect(result).toEqual({ ok: true });
    expect(runtime.calls).toBe(0);
  });

  it('probes once and succeeds when the probe leaves a valid credential', async () => {
    const runtime = new FakeCredentialRuntime({ present: true, expiresAt: PAST });
    const result = await ensureFreshCredential(input(runtime));
    expect(result).toEqual({ ok: true });
    expect(runtime.calls).toBe(1);
  });

  it('fails when the probe cannot restore a valid credential, naming the probe\'s own reason', async () => {
    const runtime = new FakeCredentialRuntime({ present: true, expiresAt: PAST });
    runtime.describeShouldFail = true;
    const result = await ensureFreshCredential(input(runtime));
    expect(result).toEqual({ ok: false, message: 'refresh failed: the refresh token was already rotated' });
    expect(runtime.calls).toBe(1);
  });

  it('a stale expiry left behind by a failed probe is never mistaken for success', async () => {
    // The probe "succeeds" by its own account (no note) but the credential it left behind is
    // still expired — a probe's own report is never trusted over the credential it actually left.
    const runtime = new FakeCredentialRuntime({ present: true, expiresAt: PAST });
    runtime.describeAccount = async (): Promise<AccountDescription> => {
      runtime.calls += 1;
      return { billingType: 'subscription_included', planLabel: 'Max', limitsAvailable: false, limits: [], note: null };
    };
    const result = await ensureFreshCredential(input(runtime));
    expect(result.ok).toBe(false);
  });

  it('never reports a successfully described account\'s own note as the reason a refresh failed (VS-137)', async () => {
    // A metered/API-key account has no OAuth expiry `readCredential` can ever find, so the freshness
    // check always fails it — but `describeAccount` succeeded here and its note is about billing,
    // not about the credential, and must never stand in for the real reason.
    const runtime = new FakeCredentialRuntime({ present: false, expiresAt: null });
    runtime.describeAccount = async (): Promise<AccountDescription> => {
      runtime.calls += 1;
      return { billingType: 'metered_api', planLabel: null, limitsAvailable: false, limits: [], note: 'claude: this account is billed per token; it has no plan limits' };
    };
    const result = await ensureFreshCredential(input(runtime));
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).not.toContain('billed per token');
    expect((result as { message: string }).message).toContain('metered_api');
  });

  it('collapses a burst of concurrent callers into exactly one probe (acceptance criterion 3)', async () => {
    const runtime = new FakeCredentialRuntime({ present: true, expiresAt: PAST });
    runtime.describeDelayMs = 10;
    const N = 8;
    const results = await Promise.all(Array.from({ length: N }, () => ensureFreshCredential(input(runtime))));
    expect(runtime.calls).toBe(1);
    for (const r of results) expect(r).toEqual({ ok: true });
  });

  it('collapses a burst of concurrent callers into exactly one probe even when it fails', async () => {
    const runtime = new FakeCredentialRuntime({ present: true, expiresAt: PAST });
    runtime.describeShouldFail = true;
    runtime.describeDelayMs = 10;
    const N = 8;
    const results = await Promise.all(Array.from({ length: N }, () => ensureFreshCredential(input(runtime))));
    expect(runtime.calls).toBe(1);
    for (const r of results) expect(r.ok).toBe(false);
  });

  it('does not permanently gate a runtime on one stale outcome: a later burst probes again', async () => {
    const runtime = new FakeCredentialRuntime({ present: true, expiresAt: PAST });
    const first = await ensureFreshCredential(input(runtime));
    expect(first).toEqual({ ok: true });
    expect(runtime.calls).toBe(1);

    // The credential the first probe left behind has since expired again.
    runtime.facts = { present: true, expiresAt: PAST };
    const second = await Promise.all(Array.from({ length: 4 }, () => ensureFreshCredential(input(runtime))));
    expect(runtime.calls).toBe(2);
    for (const r of second) expect(r).toEqual({ ok: true });
  });

  it('reconciles before and after the probe', async () => {
    const runtime = new FakeCredentialRuntime({ present: true, expiresAt: PAST });
    const reconcile = vi.fn();
    await ensureFreshCredential(input(runtime, reconcile));
    // once before the fast-path check, once before the probe, once after
    expect(reconcile.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  // Acceptance criterion 4: a rotated-away token is never written back over a good one. This uses
  // the real `reconcileRuntimeCredential` (VS-75) against scratch directories, not a mock, because
  // the property being pinned is VS-75's own monotonic-by-expiry rule surviving the new call site
  // that invokes it (design.md Decision 4) — not a rule reimplemented here.
  describe('reconciliation after the probe (acceptance criterion 4)', () => {
    let home: string;
    let wsHome: string;
    const previousHome = process.env.HOME;
    const hostPath = (): string => join(home, '.claude', '.credentials.json');
    const wsPath = (): string => join(wsHome, '.credentials.json');
    const TOKEN = 'sk-ant-oat01-fixture';
    const cred = (expiresAt: string, marker: string): string =>
      JSON.stringify({ marker, claudeAiOauth: { accessToken: `${TOKEN}-${marker}`, refreshToken: `${TOKEN}-${marker}-r`, expiresAt: Date.parse(expiresAt) } });
    const read: CredentialReader = (configHome) => {
      try {
        const raw = readFileSync(join(configHome, '.credentials.json'), 'utf8');
        const at = (JSON.parse(raw) as { claudeAiOauth?: { expiresAt?: number } }).claudeAiOauth?.expiresAt;
        return { present: true, expiresAt: typeof at === 'number' ? new Date(at).toISOString() : null };
      } catch { return { present: false, expiresAt: null }; }
    };
    const markerOf = (path: string): string => (JSON.parse(readFileSync(path, 'utf8')) as { marker: string }).marker;
    const reconcile = (): void => reconcileRuntimeCredential('claude', wsHome, { readCredential: read });

    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), 'ac-cred-home-'));
      wsHome = join(mkdtempSync(join(tmpdir(), 'ac-cred-ws-')), 'claude');
      mkdirSync(wsHome, { recursive: true });
      process.env.HOME = home;
      mkdirSync(dirname(hostPath()), { recursive: true });
      writeFileSync(hostPath(), cred(PAST, 'stale-host'));
      linkRuntimeCredentials('claude', wsHome, { readCredential: read });
    });
    afterEach(() => {
      if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
      rmSync(dirname(wsHome), { recursive: true, force: true });
    });

    class DiskCredentialRuntime extends FakeRuntime {
      calls = 0;
      readCredential(probeInput: { configHome: string }): CredentialFacts { return read(probeInput.configHome); }
      async describeAccount(_probeInput: AccountProbeInput): Promise<AccountDescription> {
        this.calls += 1;
        // The owner's own CLI refreshes the host credential directly while this probe is in flight.
        writeFileSync(hostPath(), cred(FUTURE, 'owner-refreshed'));
        // This probe's own CLI writes a *stale* credential by renaming a temp file over the
        // workspace path — replacing the symlink rather than following it, VS-75's other write
        // style — so the two genuinely fork rather than one write simply following the other.
        const tmp = join(wsHome, '.credentials.json.tmp');
        writeFileSync(tmp, cred(PAST, 'probe-stale'));
        renameSync(tmp, wsPath());
        return { billingType: 'subscription_included', planLabel: 'Max', limitsAvailable: false, limits: [], note: null };
      }
    }

    it("never lets the probe's own stale write survive over a fresher one written mid-probe", async () => {
      const adapter = new DiskCredentialRuntime();
      const result = await ensureFreshCredential({
        runtimeId: 'claude', configHome: wsHome, adapter, minValidMs: MIN_VALID_MS, probeTimeoutMs: 5000, reconcile,
      });
      expect(result).toEqual({ ok: true });
      expect(markerOf(hostPath())).toBe('owner-refreshed');
      expect(markerOf(wsPath())).toBe('owner-refreshed');
    });
  });
});
