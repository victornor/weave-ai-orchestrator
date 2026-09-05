import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { adapter } from '../src/adapter.js';
import { describeCodexAccount } from '../src/account.js';

const dirs: string[] = [];
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'ac-codex-home-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('describeCodexAccount', () => {
  it('reports an API key as metered, with no limits and a reason', () => {
    const acc = describeCodexAccount({ env: { OPENAI_API_KEY: 'sk-test' }, timeoutMs: 1000 });
    expect(acc).toMatchObject({ billingType: 'metered_api', planLabel: null, limitsAvailable: false, limits: [] });
    expect(acc.note).toMatch(/rollout file/);
  });

  it('reports an OAuth login in the runtime home as a subscription, without reading the file', () => {
    const home = tmp();
    writeFileSync(join(home, 'auth.json'), '{"do-not-read":"me"}');
    const acc = describeCodexAccount({ configHome: home, env: {}, timeoutMs: 1000 });
    expect(acc).toMatchObject({ billingType: 'subscription_included', limitsAvailable: false, limits: [] });
    expect(acc.note).toMatch(/rollout file/);
  });

  it('prefers the API key when both are present', () => {
    const home = tmp();
    writeFileSync(join(home, 'auth.json'), '{}');
    expect(describeCodexAccount({ configHome: home, env: { OPENAI_API_KEY: 'sk-test' }, timeoutMs: 1000 }).billingType).toBe('metered_api');
  });

  it('reports unknown when the runtime home holds no credentials', () => {
    const acc = describeCodexAccount({ configHome: tmp(), env: {}, timeoutMs: 1000 });
    expect(acc).toMatchObject({ billingType: 'unknown', limitsAvailable: false, limits: [] });
    expect(acc.note).toMatch(/no credentials/);
  });

  it('is reachable through the adapter', async () => {
    expect(await adapter.describeAccount?.({ env: {}, timeoutMs: 1000 })).toMatchObject({ limitsAvailable: false });
  });
});
