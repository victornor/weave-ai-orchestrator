import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { adapter } from '../src/adapter.js';
import { describeGeminiAccount } from '../src/account.js';

const dirs: string[] = [];
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'ac-gemini-home-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('describeGeminiAccount', () => {
  it.each(['GEMINI_API_KEY', 'GOOGLE_API_KEY'])('reports %s as metered, with no limits and a reason', (key) => {
    const acc = describeGeminiAccount({ env: { [key]: 'k' }, timeoutMs: 1000 });
    expect(acc).toMatchObject({ billingType: 'metered_api', planLabel: null, limitsAvailable: false, limits: [] });
    expect(acc.note).toMatch(/quota in memory/);
  });

  it('reports OAuth credentials in the runtime home as a subscription, without reading the file', () => {
    const home = tmp();
    writeFileSync(join(home, 'oauth_creds.json'), '{"do-not-read":"me"}');
    const acc = describeGeminiAccount({ configHome: home, env: {}, timeoutMs: 1000 });
    expect(acc).toMatchObject({ billingType: 'subscription_included', limitsAvailable: false, limits: [] });
    expect(acc.note).toMatch(/quota in memory/);
  });

  it('reports unknown when the runtime home holds no credentials', () => {
    const acc = describeGeminiAccount({ configHome: tmp(), env: {}, timeoutMs: 1000 });
    expect(acc).toMatchObject({ billingType: 'unknown', limitsAvailable: false, limits: [] });
    expect(acc.note).toMatch(/no credentials/);
  });

  it('is reachable through the adapter', async () => {
    expect(await adapter.describeAccount?.({ env: {}, timeoutMs: 1000 })).toMatchObject({ limitsAvailable: false });
  });
});
