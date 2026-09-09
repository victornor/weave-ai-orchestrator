import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { adapter } from '../src/adapter.js';
import { describeCursorAccount } from '../src/account.js';
import { readCredential } from '../src/credential.js';

const dirs: string[] = [];
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'ac-cursor-home-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('describeCursorAccount', () => {
  it('reports CURSOR_API_KEY as metered', () => {
    const acc = describeCursorAccount({ env: { CURSOR_API_KEY: 'k' }, timeoutMs: 1000 });
    expect(acc).toMatchObject({ billingType: 'metered_api', planLabel: null, limitsAvailable: false, limits: [] });
  });

  it('reports auth.json as a subscription without reading the token', () => {
    const home = tmp();
    writeFileSync(join(home, 'auth.json'), '{"accessToken":"do-not-read"}');
    const acc = describeCursorAccount({ configHome: home, env: {}, timeoutMs: 1000 });
    expect(acc).toMatchObject({ billingType: 'subscription_included', limitsAvailable: false });
    expect(JSON.stringify(acc)).not.toContain('do-not-read');
  });

  it('reports unknown when the runtime home holds no credentials', () => {
    const acc = describeCursorAccount({ configHome: tmp(), env: {}, timeoutMs: 1000 });
    expect(acc).toMatchObject({ billingType: 'unknown', limitsAvailable: false });
    expect(acc.note).toMatch(/no credentials/);
  });

  it('is reachable through the adapter', async () => {
    expect(await adapter.describeAccount?.({ env: {}, timeoutMs: 1000 })).toMatchObject({ limitsAvailable: false });
  });
});

describe('readCredential', () => {
  it('returns present:false when the file is missing', () => {
    expect(readCredential({ configHome: tmp() })).toEqual({ present: false, expiresAt: null });
  });

  it('returns expiry from the JWT exp claim and never a token', () => {
    const home = tmp();
    const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000 }), 'utf8').toString('base64url');
    const token = `eyJhbGciOiJub25lIn0.${payload}.sig`;
    writeFileSync(join(home, 'auth.json'), JSON.stringify({ accessToken: token, refreshToken: 'refresh-secret' }));
    const facts = readCredential({ configHome: home });
    expect(facts.present).toBe(true);
    expect(facts.expiresAt).toBe(new Date(1_800_000_000 * 1000).toISOString());
    expect(JSON.stringify(facts)).not.toContain(token);
    expect(JSON.stringify(facts)).not.toContain('refresh-secret');
  });

  it('returns present with no expiry when the token is not a JWT', () => {
    const home = tmp();
    writeFileSync(join(home, 'auth.json'), '{"accessToken":"not-a-jwt"}');
    expect(readCredential({ configHome: home })).toEqual({ present: true, expiresAt: null });
  });
});
