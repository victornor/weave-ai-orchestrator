/**
 * Gemini account description (PLAN §16.2). Gemini CLI holds its quota in memory for the life of an
 * interactive session and exposes no limit windows to a non-interactive run, so this reports the
 * billing mode only. It decides from which credential the runtime home holds — never from its
 * contents, so no secret is read, logged or stored.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AccountDescription, AccountProbeInput } from '@weave-ai/runtime-sdk';

const NO_LIMITS = 'gemini: the CLI keeps its quota in memory and does not expose limit windows to a non-interactive run';

export function describeGeminiAccount(input: AccountProbeInput): AccountDescription {
  const base: Omit<AccountDescription, 'billingType'> = { planLabel: null, limitsAvailable: false, limits: [], note: NO_LIMITS };
  if (input.env['GEMINI_API_KEY'] || input.env['GOOGLE_API_KEY']) return { ...base, billingType: 'metered_api' };
  if (input.configHome && existsSync(join(input.configHome, 'oauth_creds.json'))) return { ...base, billingType: 'subscription_included' };
  return { ...base, billingType: 'unknown', note: 'gemini: no credentials found in the workspace runtime home' };
}
