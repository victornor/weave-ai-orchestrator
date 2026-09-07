import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapter } from '../src/adapter.js';
import { GET_USAGE_REQUEST, parseUsageControlResponse, probeAccount } from '../src/account.js';

const fixture = (name: string): string => readFileSync(join(import.meta.dirname, '..', 'fixtures', name), 'utf8').trim();

/** Rebuild a control response around a patched `response.response` body. */
function reply(body: Record<string, unknown>): string {
  return JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'ac_get_usage', response: body } });
}

/** A shell that prints the given lines on stdout and exits 0, so no real CLI is spawned. */
function stub(...lines: string[]): { cmd: string; args: string[] } {
  return { cmd: 'sh', args: ['-c', `printf '%s\\n' ${lines.map((l) => JSON.stringify(l)).join(' ')}`] };
}

describe('parseUsageControlResponse', () => {
  it('maps a subscription account onto the session, weekly and model-scoped windows', () => {
    const acc = parseUsageControlResponse(fixture('get-usage-subscription.json'));
    expect(acc).toMatchObject({ billingType: 'subscription_included', planLabel: 'max', limitsAvailable: true, note: null });
    expect(acc.limits).toEqual([
      { kind: 'session', label: 'Session', utilization: 42, resetsAt: '2026-09-05T18:09:59.639941+00:00', scopeLabel: null },
      { kind: 'weekly_all', label: 'Weekly', utilization: 23, resetsAt: '2026-09-10T01:59:59.639961+00:00', scopeLabel: null },
      { kind: 'weekly_scoped', label: 'Weekly', utilization: 25, resetsAt: '2026-09-10T01:59:59.640198+00:00', scopeLabel: 'Fable' },
    ]);
  });

  it('reads only the normalised limits array, not the codename-shaped keys beside it', () => {
    const acc = parseUsageControlResponse(fixture('get-usage-subscription.json'));
    // `nimbus_quill` sits in `rate_limits` at 0 % utilisation; it must not become a window.
    expect(acc.limits.map((l) => l.kind)).toEqual(['session', 'weekly_all', 'weekly_scoped']);
  });

  it('reports an account with no subscription type as billed per token', () => {
    const acc = parseUsageControlResponse(reply({ rate_limits_available: true, rate_limits: { limits: [] } }));
    expect(acc).toMatchObject({ billingType: 'metered_api', planLabel: null, limitsAvailable: false, limits: [] });
    expect(acc.note).toMatch(/billed per token/);
  });

  it('keeps the plan but reports no windows when the CLI says limits are unavailable', () => {
    const acc = parseUsageControlResponse(reply({ subscription_type: 'pro', rate_limits_available: false }));
    expect(acc).toMatchObject({ billingType: 'subscription_included', planLabel: 'pro', limitsAvailable: false, limits: [] });
    expect(acc.note).toMatch(/unavailable/);
  });

  it('omits a window the runtime did not quantify rather than drawing it at zero', () => {
    const acc = parseUsageControlResponse(reply({
      subscription_type: 'max',
      rate_limits_available: true,
      rate_limits: { limits: [{ kind: 'session', percent: null, resets_at: null }, { kind: 'weekly_all', percent: 12, resets_at: null }] },
    }));
    expect(acc.limits).toEqual([{ kind: 'weekly_all', label: 'Weekly', utilization: 12, resetsAt: null, scopeLabel: null }]);
  });

  it('ignores a window kind it does not know', () => {
    const acc = parseUsageControlResponse(reply({
      subscription_type: 'max',
      rate_limits_available: true,
      rate_limits: { limits: [{ kind: 'iguana_necktie', percent: 99 }, { kind: 'session', percent: 5 }] },
    }));
    expect(acc.limits.map((l) => l.kind)).toEqual(['session']);
  });

  it('falls back to unavailable when the limits array holds nothing usable', () => {
    const acc = parseUsageControlResponse(reply({ subscription_type: 'max', rate_limits_available: true, rate_limits: { limits: [] } }));
    expect(acc).toMatchObject({ billingType: 'subscription_included', planLabel: 'max', limitsAvailable: false, limits: [] });
    expect(acc.note).toMatch(/no usable limit windows/);
  });

  it('degrades to unknown with a reason on unparseable or unexpected output', () => {
    expect(parseUsageControlResponse('not json at all')).toMatchObject({ billingType: 'unknown', limitsAvailable: false, limits: [] });
    expect(parseUsageControlResponse('not json at all').note).toMatch(/not JSON/);
    expect(parseUsageControlResponse(JSON.stringify({ type: 'system', subtype: 'init' })).note).toMatch(/no get_usage control response/);
    expect(parseUsageControlResponse(JSON.stringify({ type: 'control_response', response: { subtype: 'error', error: 'nope' } })).note).toMatch(/get_usage failed \(nope\)/);
  });
});

describe('probeAccount', () => {
  const input = { env: {}, timeoutMs: 5_000 };

  it('sends one get_usage control request and parses the reply', async () => {
    const acc = await probeAccount(input, stub(fixture('get-usage-subscription.json')));
    expect(acc).toMatchObject({ billingType: 'subscription_included', planLabel: 'max', limitsAvailable: true });
    expect(acc.limits).toHaveLength(3);
  });

  it('asks for exactly one get_usage control request on stdin', () => {
    expect(JSON.parse(GET_USAGE_REQUEST)).toEqual({ type: 'control_request', request_id: 'ac_get_usage', request: { subtype: 'get_usage' } });
  });

  it('picks the control response out of a stream that also carries other lines', async () => {
    const stub2 = stub(JSON.stringify({ type: 'system', subtype: 'init' }), fixture('get-usage-subscription.json'));
    expect(await probeAccount(input, stub2)).toMatchObject({ planLabel: 'max', limitsAvailable: true });
  });

  it('resolves to unknown with the exit code when the CLI fails', async () => {
    const acc = await probeAccount(input, { cmd: 'sh', args: ['-c', 'echo "not logged in" >&2; exit 1'] });
    expect(acc).toMatchObject({ billingType: 'unknown', limitsAvailable: false, limits: [] });
    expect(acc.note).toMatch(/no control response \(exit 1: not logged in\)/);
  });

  it('resolves to unknown when the binary is missing rather than throwing', async () => {
    const acc = await probeAccount(input, { cmd: 'ac-no-such-binary-9f2a', args: [] });
    expect(acc.billingType).toBe('unknown');
    expect(acc.note).toMatch(/no control response/);
  });

  it('resolves to unknown when the probe times out', async () => {
    const acc = await probeAccount({ env: {}, timeoutMs: 150 }, { cmd: 'sh', args: ['-c', 'sleep 30'] });
    expect(acc.billingType).toBe('unknown');
    expect(acc.note).toMatch(/timed out after 150 ms/);
  });

  it('says how it tried to launch the CLI when it could not describe the account', async () => {
    const acc = await probeAccount(input, { cmd: 'sh', args: ['-c', 'exit 1'] });
    expect(acc.diagnostics).toMatchObject({ cmd: expect.stringMatching(/sh$/) as unknown as string, cwd: process.cwd() });
    expect(acc.diagnostics?.['path']).toContain('/bin');
  });
});

/**
 * The daemon runs under a systemd user unit and its PATH is not the interactive shell's; before
 * VS-73 the probe spawned with a bare environment and never found the CLI at all.
 */
describe('the probe finds the CLI without the parent shell', () => {
  const homes: string[] = [];
  afterEach(() => { vi.unstubAllEnvs(); for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true }); });

  /** A `claude` that answers the get_usage control request, installed where mise puts its shims. */
  function fakeCli(line: string): string {
    const home = mkdtempSync(join(tmpdir(), 'ac-probe-home-'));
    homes.push(home);
    const dir = join(home, '.local', 'share', 'mise', 'shims');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'claude');
    writeFileSync(path, `#!/bin/sh\ncat > /dev/null\nprintf '%s\\n' ${JSON.stringify(line)}\n`);
    chmodSync(path, 0o755);
    return home;
  }

  it('describes the account with an empty PATH, resolving the binary the way a turn does', async () => {
    const home = fakeCli(fixture('get-usage-subscription.json'));
    vi.stubEnv('PATH', '');
    vi.stubEnv('HOME', home);
    const acc = await probeAccount({ env: {}, timeoutMs: 5_000 });
    expect(acc).toMatchObject({ billingType: 'subscription_included', planLabel: 'max', limitsAvailable: true });
    expect(acc.limits).toHaveLength(3);
  });
});

describe('the adapter exposes the probe', () => {
  it('implements describeAccount', () => {
    expect(typeof adapter.describeAccount).toBe('function');
  });
});
