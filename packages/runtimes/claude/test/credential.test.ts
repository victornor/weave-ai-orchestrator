import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CREDENTIAL_FILE, credentialExpiry, readCredential } from '../src/credential.js';

/** A token that must never appear in anything `readCredential` returns. */
const TOKEN = 'sk-ant-oat01-NEVER-LEAK-THIS';

let home: string;

beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ac-cred-')); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const write = (body: unknown): void => writeFileSync(join(home, CREDENTIAL_FILE), typeof body === 'string' ? body : JSON.stringify(body));

const oauth = (expiresAt: number | null): unknown => ({
  claudeAiOauth: {
    accessToken: TOKEN, refreshToken: `${TOKEN}-refresh`,
    ...(expiresAt === null ? {} : { expiresAt }),
    scopes: ['user:inference'], subscriptionType: 'max',
  },
});

describe('readCredential', () => {
  it('reports a present credential with the expiry the file asserts', () => {
    const at = Date.parse('2026-09-08T10:00:00.000Z');
    write(oauth(at));
    expect(readCredential({ configHome: home })).toEqual({ present: true, expiresAt: '2026-09-08T10:00:00.000Z' });
  });

  it('reports an absent credential rather than throwing', () => {
    expect(readCredential({ configHome: home })).toEqual({ present: false, expiresAt: null });
  });

  it('reports a present credential with no expiry when the file cannot be parsed', () => {
    write('{ not json at all');
    expect(readCredential({ configHome: home })).toEqual({ present: true, expiresAt: null });
  });

  it('treats a credential with no expiry as unknown, not expired', () => {
    write(oauth(null));
    expect(readCredential({ configHome: home })).toEqual({ present: true, expiresAt: null });
  });

  it('treats a shape it does not recognise as present with no expiry', () => {
    write({ someOtherProvider: { token: TOKEN } });
    expect(readCredential({ configHome: home })).toEqual({ present: true, expiresAt: null });
  });

  // The type has nowhere to put a token; this pins that the implementation keeps it that way.
  it('never returns the token in any field', () => {
    write(oauth(Date.parse('2026-09-08T10:00:00.000Z')));
    const facts = readCredential({ configHome: home });
    expect(Object.keys(facts).sort()).toEqual(['expiresAt', 'present']);
    expect(JSON.stringify(facts)).not.toContain('sk-ant');
    expect(JSON.stringify(facts)).not.toContain(TOKEN);
  });
});

describe('credentialExpiry', () => {
  it('reads epoch milliseconds as ISO-8601', () => {
    expect(credentialExpiry(JSON.stringify(oauth(1_767_225_600_000)))).toBe(new Date(1_767_225_600_000).toISOString());
  });

  it('rejects a non-numeric, zero or negative expiry', () => {
    for (const bad of ['later', 0, -5]) {
      expect(credentialExpiry(JSON.stringify({ claudeAiOauth: { expiresAt: bad } }))).toBeNull();
    }
  });

  it('returns null for anything unparseable', () => {
    for (const bad of ['', 'null', '[]', '"a string"', '{']) expect(credentialExpiry(bad)).toBeNull();
  });
});
