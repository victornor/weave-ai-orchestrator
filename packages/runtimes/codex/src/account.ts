/**
 * Codex account description (PLAN §16.2). Codex keeps its plan limits in the session rollout file
 * on disk and exposes nothing about them to a non-interactive process, so this reports the billing
 * mode only. It decides from which credential the runtime home holds — never from its contents, so
 * no secret is read, logged or stored.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AccountDescription, AccountProbeInput } from '@weave-ai/runtime-sdk';

const NO_LIMITS = 'codex: the CLI keeps plan limits in its session rollout file and does not expose them to a non-interactive run';

export function describeCodexAccount(input: AccountProbeInput): AccountDescription {
  const base: Omit<AccountDescription, 'billingType'> = { planLabel: null, limitsAvailable: false, limits: [], note: NO_LIMITS };
  if (input.env['OPENAI_API_KEY']) return { ...base, billingType: 'metered_api' };
  if (input.configHome && existsSync(join(input.configHome, 'auth.json'))) return { ...base, billingType: 'subscription_included' };
  return { ...base, billingType: 'unknown', note: 'codex: no credentials found in the workspace runtime home' };
}
