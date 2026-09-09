/**
 * Cursor credential facts: whether `auth.json` is present and when the access JWT expires.
 * Spawn-free. Never returns a token (VS-75).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CredentialFacts, CredentialProbeInput } from '@agent-conductor/runtime-sdk';

export const CREDENTIAL_FILE = 'auth.json';

export function jwtExpiry(token: string): string | null {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const parsed: unknown = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const exp = (parsed as Record<string, unknown>)['exp'];
    if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) return null;
    const d = new Date(exp * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

export function credentialExpiry(raw: string): string | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const token = (parsed as Record<string, unknown>)['accessToken'];
  return typeof token === 'string' ? jwtExpiry(token) : null;
}

export function readCredential(input: CredentialProbeInput): CredentialFacts {
  let raw: string;
  try {
    raw = readFileSync(join(input.configHome, CREDENTIAL_FILE), 'utf8');
  } catch {
    return { present: false, expiresAt: null };
  }
  return { present: true, expiresAt: credentialExpiry(raw) };
}
