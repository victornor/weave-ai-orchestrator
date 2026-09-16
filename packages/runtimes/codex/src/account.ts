/**
 * Codex account description (PLAN §16.2). Codex keeps its plan limits in the session rollout file
 * on disk and exposes nothing about them to a non-interactive process, so this reports the billing
 * mode only. Only the authentication mode is returned; credential values never leave this module.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AccountDescription, AccountProbeInput } from '@weave-ai/runtime-sdk';

const NO_LIMITS = 'codex: the CLI keeps plan limits in its session rollout file and does not expose them to a non-interactive run';

export function describeCodexAccount(input: AccountProbeInput): AccountDescription {
  const base: Omit<AccountDescription, 'billingType'> = { planLabel: null, limitsAvailable: false, limits: [], note: NO_LIMITS };
  if (input.env['OPENAI_API_KEY']) return { ...base, billingType: 'metered_api' };
  if (input.configHome) {
    try {
      const auth: unknown = JSON.parse(readFileSync(join(input.configHome, 'auth.json'), 'utf8'));
      if (auth && typeof auth === 'object' && !Array.isArray(auth)) {
        const fields = auth as Record<string, unknown>;
        if (fields['auth_mode'] === 'apikey' || (typeof fields['OPENAI_API_KEY'] === 'string' && fields['OPENAI_API_KEY'])) return { ...base, billingType: 'metered_api' };
        if (fields['auth_mode'] === 'chatgpt' || (fields['tokens'] && typeof fields['tokens'] === 'object')) return { ...base, billingType: 'subscription_included' };
      }
    } catch { /* missing or unreadable credentials remain unknown */ }
  }
  return { ...base, billingType: 'unknown', note: 'codex: no credentials found in the workspace runtime home' };
}
