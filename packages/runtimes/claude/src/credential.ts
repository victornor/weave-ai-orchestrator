/**
 * Claude Code credential facts (VS-75): whether a credential file is there and when it expires,
 * read straight from the file. No CLI is spawned and no session is opened — this is what lets the
 * daemon reconcile the one shared credential and show its state without launching anything.
 *
 * Only `claudeAiOauth.expiresAt` is read. The tokens beside it are never returned, never logged and
 * never widened into the result type: `CredentialFacts` has nowhere to put them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CredentialFacts, CredentialProbeInput } from '@weave-ai/runtime-sdk';

/** The credential file inside a Claude config home (`CLAUDE_CONFIG_DIR`). */
export const CREDENTIAL_FILE = '.credentials.json';

/** Where the machine owner's own `claude` keeps its credential. */
export function hostCredentialPath(home: string): string {
  return join(home, '.claude', CREDENTIAL_FILE);
}

/**
 * The expiry a Claude credential asserts about itself, as ISO-8601, or null when it does not say.
 * `claudeAiOauth.expiresAt` is epoch milliseconds. Exported because the reconcile in core compares
 * two credentials by exactly this value and must read both the same way.
 */
export function credentialExpiry(raw: string): string | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const oauth = (parsed as Record<string, unknown>)['claudeAiOauth'];
  if (!oauth || typeof oauth !== 'object') return null;
  const at = (oauth as Record<string, unknown>)['expiresAt'];
  // A long-lived `claude setup-token` credential carries no expiry; that is "unknown", not "expired".
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Never throws: an absent file is `present: false`, an unparseable one is present with no expiry. */
export function readCredential(input: CredentialProbeInput): CredentialFacts {
  let raw: string;
  try {
    raw = readFileSync(join(input.configHome, CREDENTIAL_FILE), 'utf8');
  } catch {
    return { present: false, expiresAt: null };
  }
  return { present: true, expiresAt: credentialExpiry(raw) };
}
